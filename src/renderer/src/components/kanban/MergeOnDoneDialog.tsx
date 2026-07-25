import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react'
import { useKanbanStore } from '@/stores/useKanbanStore'
import { useWorktreeStore } from '@/stores/useWorktreeStore'
import { useSessionStore } from '@/stores/useSessionStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useGitStore } from '@/stores/useGitStore'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { toast } from 'sonner'
import {
  Loader2,
  GitMerge,
  GitCommit,
  Archive,
  GitBranch,
  ChevronDown,
  Check,
  Search
} from 'lucide-react'
import { cn } from '@/lib/utils'

/** Strip origin/ for picker + merge; skip unusable ref names */
function branchNameForMergeTarget(raw: string, featureBranch: string): string | null {
  const n = raw.replace(/^origin\//, '')
  if (n === featureBranch) return null
  if (n === 'HEAD' || n.includes('->')) return null
  return n
}

type Step = 'loading' | 'commit_base' | 'commit' | 'merge' | 'archive'

interface BranchStats {
  filesChanged: number
  insertions: number
  deletions: number
  commitsAhead: number
}

interface ResolvedState {
  featureWorktreeId: string
  featureWorktreePath: string
  featureBranch: string
  baseWorktreeId: string
  baseWorktreePath: string
  baseBranch: string
  /** Kanban project id — refresh active worktrees when changing merge target */
  projectId: string
  /** Shown in merge-target picker: repo branches (from git) + worktrees; search finds all of these */
  candidateBaseBranches: string[]
  /** branch_name values with an active workspace (checkout equals name) — merge without checking out elsewhere */
  mergeableViaDedicatedWorktree: string[]
  /** Default project workspace path — used to check out the target branch when no dedicated worktree exists */
  defaultWorktreeMergeFallbackPath: string | null
  ticketTitle: string
  projectPath: string
  uncommittedStats: { filesChanged: number; insertions: number; deletions: number }
  baseUncommittedStats: { filesChanged: number; insertions: number; deletions: number }
  baseDirty: boolean
  branchStats: BranchStats
}

export function MergeOnDoneDialog() {
  const pendingDoneMove = useKanbanStore((s) => s.pendingDoneMove)
  const completeDoneMove = useKanbanStore((s) => s.completeDoneMove)
  const clearPendingDoneMove = useKanbanStore((s) => s.clearPendingDoneMove)

  const [step, setStep] = useState<Step>('loading')
  const [resolved, setResolved] = useState<ResolvedState | null>(null)
  const [commitMessage, setCommitMessage] = useState('')
  const [baseCommitMessage, setBaseCommitMessage] = useState('')
  const [committingBase, setCommittingBase] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [merging, setMerging] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [mergeBaseOpen, setMergeBaseOpen] = useState(false)
  const [mergeBaseSearch, setMergeBaseSearch] = useState('')

  const filteredMergeBaseOptions = useMemo(() => {
    if (!resolved) return []
    const q = mergeBaseSearch.trim().toLowerCase()
    if (!q) return resolved.candidateBaseBranches
    return resolved.candidateBaseBranches.filter((b) => b.toLowerCase().includes(q))
  }, [resolved, mergeBaseSearch])

  // Initialize when pendingDoneMove changes
  useEffect(() => {
    if (!pendingDoneMove) return

    let cancelled = false
    const pending = pendingDoneMove

    const init = async () => {
      setStep('loading')
      setResolved(null)
      setMergeBaseOpen(false)
      setMergeBaseSearch('')

      try {
        // Look up ticket from store
        const tickets = useKanbanStore.getState().getTicketsForProject(pending.projectId)
        const ticket = tickets.find((t) => t.id === pending.ticketId)

        if (!ticket || !ticket.worktree_id) {
          clearPendingDoneMove()
          return
        }

        // Fetch feature worktree
        const featureWorktree = await window.db.worktree.get(ticket.worktree_id)
        if (!featureWorktree || featureWorktree.status !== 'active') {
          toast.warning('Cannot merge — feature worktree is not active')
          clearPendingDoneMove()
          return
        }

        // Resolve base branch
        const activeWorktrees = await window.db.worktree.getActiveByProject(pending.projectId)
        const defaultWt = activeWorktrees.find((w) => w.is_default && w.status === 'active')
        const resolvedBaseBranch = featureWorktree.base_branch ?? defaultWt?.branch_name

        if (!resolvedBaseBranch) {
          toast.warning('Cannot merge — no base branch resolved')
          clearPendingDoneMove()
          return
        }

        // Prefer a workspace whose checkout is the base branch; otherwise use default workspace (will checkout target at merge time).
        const baseDedicated = activeWorktrees.find(
          (w) => w.branch_name === resolvedBaseBranch && w.status === 'active'
        )
        const defaultWorktreeMergeFallbackPath = defaultWt?.path ?? null

        let baseWorktreeId: string
        let baseWorktreePath: string
        if (baseDedicated) {
          baseWorktreeId = baseDedicated.id
          baseWorktreePath = baseDedicated.path
        } else {
          if (!defaultWt) {
            toast.warning(
              `Cannot merge — no workspace is on ${resolvedBaseBranch}, and the project has no default workspace to use as a fallback.`
            )
            clearPendingDoneMove()
            return
          }
          const defaultDirty = await window.gitOps.hasUncommittedChanges(defaultWt.path)
          if (defaultDirty) {
            toast.warning(
              `Cannot merge into ${resolvedBaseBranch}: either add a workspace checked out to that branch, or commit/stash changes in your default workspace (now ${defaultWt.branch_name}) so the app can check out ${resolvedBaseBranch} there for the merge.`
            )
            clearPendingDoneMove()
            return
          }
          baseWorktreeId = defaultWt.id
          baseWorktreePath = defaultWt.path
        }

        const [hasUncommitted, branchStatResult] = await Promise.all([
          window.gitOps.hasUncommittedChanges(featureWorktree.path),
          window.gitOps.branchDiffShortStat(featureWorktree.path, resolvedBaseBranch)
        ])

        const baseDirty = baseDedicated
          ? await window.gitOps.hasUncommittedChanges(baseDedicated.path)
          : false

        if (cancelled) return

        // Get uncommitted diff stats for both worktrees if needed
        const [featureDiffResult, baseDiffResult] = await Promise.all([
          hasUncommitted ? window.gitOps.getDiffStat(featureWorktree.path) : Promise.resolve(null),
          baseDirty && baseDedicated
            ? window.gitOps.getDiffStat(baseDedicated.path)
            : Promise.resolve(null)
        ])

        let uncommittedStats = { filesChanged: 0, insertions: 0, deletions: 0 }
        if (featureDiffResult?.success && featureDiffResult.files) {
          uncommittedStats = {
            filesChanged: featureDiffResult.files.length,
            insertions: featureDiffResult.files.reduce((sum, f) => sum + f.additions, 0),
            deletions: featureDiffResult.files.reduce((sum, f) => sum + f.deletions, 0)
          }
        }

        let baseUncommittedStats = { filesChanged: 0, insertions: 0, deletions: 0 }
        if (baseDiffResult?.success && baseDiffResult.files) {
          baseUncommittedStats = {
            filesChanged: baseDiffResult.files.length,
            insertions: baseDiffResult.files.reduce((sum, f) => sum + f.additions, 0),
            deletions: baseDiffResult.files.reduce((sum, f) => sum + f.deletions, 0)
          }
        }

        if (cancelled) return

        if (!branchStatResult.success) {
          toast.warning(`Cannot verify merge status: ${branchStatResult.error ?? 'unknown error'}`)
          clearPendingDoneMove()
          return
        }

        const branchStats: BranchStats = {
          filesChanged: branchStatResult.filesChanged,
          insertions: branchStatResult.insertions,
          deletions: branchStatResult.deletions,
          commitsAhead: branchStatResult.commitsAhead
        }

        // If no diffs at all, just move to done
        if (!hasUncommitted && branchStats.commitsAhead === 0) {
          await completeDoneMove()
          return
        }

        // Get project path for archive step
        const project = await window.db.project.get(featureWorktree.project_id)
        if (cancelled) return

        const mergeableViaDedicatedWorktreeList = activeWorktrees
          .filter((w) => w.status === 'active' && w.branch_name !== featureWorktree.branch_name)
          .map((w) => w.branch_name)

        const branchNamesUniq = new Set<string>(mergeableViaDedicatedWorktreeList)

        const repoPath = project?.path ?? baseWorktreePath
        try {
          const gitListResult = await window.gitOps.listBranchesWithStatus(repoPath)
          if (gitListResult.success && gitListResult.branches) {
            for (const b of gitListResult.branches) {
              const n = branchNameForMergeTarget(b.name, featureWorktree.branch_name)
              if (n) branchNamesUniq.add(n)
            }
          }
        } catch {
          // Non-critical — worktree-only list still works
        }

        const candidateBaseBranches = Array.from(branchNamesUniq).sort((a, b) => a.localeCompare(b))

        setResolved({
          featureWorktreeId: featureWorktree.id,
          featureWorktreePath: featureWorktree.path,
          featureBranch: featureWorktree.branch_name,
          baseWorktreeId,
          baseWorktreePath,
          baseBranch: resolvedBaseBranch,
          projectId: featureWorktree.project_id,
          candidateBaseBranches,
          mergeableViaDedicatedWorktree: mergeableViaDedicatedWorktreeList,
          defaultWorktreeMergeFallbackPath,
          ticketTitle: ticket.title,
          projectPath: project?.path ?? baseWorktreePath,
          uncommittedStats,
          baseUncommittedStats,
          baseDirty,
          branchStats
        })
        setCommitMessage(ticket.title)
        setBaseCommitMessage('')
        setStep(baseDirty ? 'commit_base' : hasUncommitted ? 'commit' : 'merge')
      } catch (err) {
        if (!cancelled) {
          toast.error(`Failed to check branch: ${err instanceof Error ? err.message : String(err)}`)
          clearPendingDoneMove()
        }
      }
    }

    init()
    return () => {
      cancelled = true
    }
  }, [pendingDoneMove, completeDoneMove, clearPendingDoneMove])

  const handleCommit = useCallback(async () => {
    if (!resolved || !commitMessage.trim()) return
    setCommitting(true)
    try {
      const stageResult = await window.gitOps.stageAll(resolved.featureWorktreePath)
      if (!stageResult.success) {
        toast.error(`Failed to stage: ${stageResult.error}`)
        return
      }

      const commitResult = await window.gitOps.commit(
        resolved.featureWorktreePath,
        commitMessage.trim()
      )
      if (!commitResult.success) {
        toast.error(`Failed to commit: ${commitResult.error}`)
        return
      }

      toast.success('Changes committed')

      // Re-check branch divergence after commit
      const statResult = await window.gitOps.branchDiffShortStat(
        resolved.featureWorktreePath,
        resolved.baseBranch
      )

      if (!statResult.success) {
        toast.warning(`Cannot verify merge status: ${statResult.error ?? 'unknown error'}`)
        clearPendingDoneMove()
        return
      }

      if (statResult.commitsAhead > 0) {
        setResolved((prev) =>
          prev
            ? {
                ...prev,
                branchStats: {
                  filesChanged: statResult.filesChanged,
                  insertions: statResult.insertions,
                  deletions: statResult.deletions,
                  commitsAhead: statResult.commitsAhead
                }
              }
            : prev
        )
        setStep('merge')
      } else {
        // No divergence after commit — base already has everything
        await completeDoneMove()
      }
    } catch (err) {
      toast.error(`Commit failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setCommitting(false)
    }
  }, [resolved, commitMessage, completeDoneMove, clearPendingDoneMove])

  const handleCommitBase = useCallback(async () => {
    if (!resolved || !baseCommitMessage.trim()) return
    setCommittingBase(true)
    try {
      const stageResult = await window.gitOps.stageAll(resolved.baseWorktreePath)
      if (!stageResult.success) {
        toast.error(`Failed to stage on ${resolved.baseBranch}: ${stageResult.error}`)
        return
      }

      const commitResult = await window.gitOps.commit(
        resolved.baseWorktreePath,
        baseCommitMessage.trim()
      )
      if (!commitResult.success) {
        toast.error(`Failed to commit on ${resolved.baseBranch}: ${commitResult.error}`)
        return
      }

      toast.success(`Changes committed on ${resolved.baseBranch}`)

      // Check if feature branch still has uncommitted changes
      const featureHasUncommitted = await window.gitOps.hasUncommittedChanges(
        resolved.featureWorktreePath
      )

      if (featureHasUncommitted) {
        setStep('commit')
      } else {
        // Re-check branch divergence
        const statResult = await window.gitOps.branchDiffShortStat(
          resolved.featureWorktreePath,
          resolved.baseBranch
        )
        if (!statResult.success) {
          toast.warning(`Cannot verify merge status: ${statResult.error ?? 'unknown error'}`)
          clearPendingDoneMove()
          return
        }

        if (statResult.commitsAhead > 0) {
          setResolved((prev) =>
            prev
              ? {
                  ...prev,
                  branchStats: {
                    filesChanged: statResult.filesChanged,
                    insertions: statResult.insertions,
                    deletions: statResult.deletions,
                    commitsAhead: statResult.commitsAhead
                  }
                }
              : prev
          )
          setStep('merge')
        } else {
          await completeDoneMove()
        }
      }
    } catch (err) {
      toast.error(`Commit failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setCommittingBase(false)
    }
  }, [resolved, baseCommitMessage, completeDoneMove, clearPendingDoneMove])

  const handleFixMergeConflicts = useCallback(async (target: ResolvedState) => {
    const sessionStore = useSessionStore.getState()
    const worktreeStore = useWorktreeStore.getState()
    const settingsStore = useSettingsStore.getState()
    const mode =
      settingsStore.mergeConflictMode === 'always-ask' ? 'build' : settingsStore.mergeConflictMode

    worktreeStore.selectWorktree(target.baseWorktreeId, { preservePinnedBoard: true })

    const result = await sessionStore.createSession(
      target.baseWorktreeId,
      target.projectId,
      undefined,
      mode
    )

    if (!result.success || !result.session) {
      toast.error(result.error ? `Failed to start agent: ${result.error}` : 'Failed to start agent')
      return
    }

    await sessionStore.updateSessionName(
      result.session.id,
      `Merge Conflicts — ${target.baseBranch}`
    )
    sessionStore.setPendingMessage(result.session.id, 'Fix merge conflicts')
    sessionStore.setActiveSession(result.session.id)
  }, [])

  const handleMerge = useCallback(async () => {
    if (!resolved) return
    setMerging(true)
    try {
      const checkoutResult = await window.gitOps.checkoutBranch(
        resolved.baseWorktreePath,
        resolved.baseBranch
      )
      if (!checkoutResult.success) {
        toast.error(checkoutResult.error ?? 'Checkout failed')
        clearPendingDoneMove()
        return
      }

      // Pull latest on base branch first (only if remote exists)
      const remoteResult = await window.gitOps.getRemoteUrl(resolved.baseWorktreePath)
      if (remoteResult.url) {
        const pullResult = await window.gitOps.pull(resolved.baseWorktreePath)
        if (!pullResult.success) {
          toast.warning(`Pull failed on ${resolved.baseBranch} — continuing with local merge`)
        }
      }

      // Merge feature into base (HEAD is now baseBranch after checkout)
      const mergeResult = await window.gitOps.merge(
        resolved.baseWorktreePath,
        resolved.featureBranch
      )

      if (!mergeResult.success) {
        // Leave conflicts in the base worktree so the agent has real conflict markers to resolve.
        if (mergeResult.conflicts && mergeResult.conflicts.length > 0) {
          useGitStore.getState().setHasConflicts(resolved.baseWorktreePath, true)
          void useGitStore.getState().refreshStatuses(resolved.baseWorktreePath)
          toast.error(
            `Merge conflicts in ${mergeResult.conflicts.length} file${mergeResult.conflicts.length !== 1 ? 's' : ''}`,
            {
              duration: 10000,
              action: {
                label: 'Fix with agent',
                onClick: () => {
                  void handleFixMergeConflicts(resolved)
                }
              }
            }
          )
        } else {
          toast.error(`Merge failed: ${mergeResult.error}`)
        }
        clearPendingDoneMove()
        return
      }

      toast.success('Branch merged successfully')
      setStep('archive')
    } catch (err) {
      toast.error(`Merge failed: ${err instanceof Error ? err.message : String(err)}`)
      clearPendingDoneMove()
    } finally {
      setMerging(false)
    }
  }, [resolved, clearPendingDoneMove, handleFixMergeConflicts])

  const selectMergeBaseBranch = useCallback(
    async (branchName: string) => {
      if (!resolved) return
      if (branchName === resolved.baseBranch) {
        setMergeBaseOpen(false)
        setMergeBaseSearch('')
        return
      }

      const activeWorktrees = await window.db.worktree.getActiveByProject(resolved.projectId)
      const baseWt = activeWorktrees.find(
        (w) => w.branch_name === branchName && w.status === 'active'
      )

      let nextBaseWorktreeId: string
      let nextBasePath: string
      if (baseWt) {
        const dirty = await window.gitOps.hasUncommittedChanges(baseWt.path)
        if (dirty) {
          toast.warning(
            `${branchName} has uncommitted changes — commit those on that worktree before choosing it as the merge target.`
          )
          return
        }
        nextBaseWorktreeId = baseWt.id
        nextBasePath = baseWt.path
      } else {
        const fallback = resolved.defaultWorktreeMergeFallbackPath
        if (!fallback) {
          toast.warning(
            `No workspace is checked out to ${branchName} — add one, or set a default workspace in this project.`
          )
          return
        }
        const dirty = await window.gitOps.hasUncommittedChanges(fallback)
        if (dirty) {
          toast.warning(
            'The default workspace has uncommitted changes — commit or stash them so the target branch can be checked out there.'
          )
          return
        }
        const fallbackWt = activeWorktrees.find((w) => w.path === fallback)
        if (!fallbackWt) {
          toast.warning(
            'Cannot resolve the default workspace for this merge target — refresh worktrees and try again.'
          )
          return
        }
        nextBaseWorktreeId = fallbackWt.id
        nextBasePath = fallback
      }

      const branchStatResult = await window.gitOps.branchDiffShortStat(
        resolved.featureWorktreePath,
        branchName
      )
      if (!branchStatResult.success) {
        toast.warning(`Cannot verify merge: ${branchStatResult.error ?? 'unknown error'}`)
        return
      }

      setResolved((prev) =>
        prev
          ? {
              ...prev,
              baseBranch: branchName,
              baseWorktreeId: nextBaseWorktreeId,
              baseWorktreePath: nextBasePath,
              baseDirty: false,
              baseUncommittedStats: { filesChanged: 0, insertions: 0, deletions: 0 },
              branchStats: {
                filesChanged: branchStatResult.filesChanged,
                insertions: branchStatResult.insertions,
                deletions: branchStatResult.deletions,
                commitsAhead: branchStatResult.commitsAhead
              }
            }
          : prev
      )
      setMergeBaseOpen(false)
      setMergeBaseSearch('')
    },
    [resolved]
  )

  const handleArchive = useCallback(async () => {
    if (!resolved) return
    setArchiving(true)
    try {
      const result = await useWorktreeStore
        .getState()
        .archiveWorktree(
          resolved.featureWorktreeId,
          resolved.featureWorktreePath,
          resolved.featureBranch,
          resolved.projectPath
        )

      if (result.success) {
        toast.success('Worktree archived')
      } else {
        toast.error(`Failed to archive: ${result.error}`)
      }
    } catch (err) {
      toast.error(`Archive failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setArchiving(false)
      await completeDoneMove()
    }
  }, [resolved, completeDoneMove])

  const stepTitle: Record<Step, string> = {
    loading: 'Moving to Done...',
    commit_base: 'Uncommitted changes on base',
    commit: 'Uncommitted changes',
    merge: 'Merge branch',
    archive: 'Archive worktree'
  }

  const stepIcon: Record<Step, ReactNode> = {
    loading: <Loader2 className="h-4 w-4 animate-spin" />,
    commit_base: <GitCommit className="h-4 w-4" />,
    commit: <GitCommit className="h-4 w-4" />,
    merge: <GitMerge className="h-4 w-4" />,
    archive: <Archive className="h-4 w-4" />
  }

  return (
    <Dialog
      open={!!pendingDoneMove}
      onOpenChange={(open) => {
        if (!open) {
          // Merge already finished — closing the dialog (Esc / backdrop) should still move the card to Done
          if (step === 'archive') {
            void completeDoneMove()
          } else {
            clearPendingDoneMove()
          }
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            {stepIcon[step]}
            {stepTitle[step]}
          </DialogTitle>
        </DialogHeader>

        {step === 'loading' && (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking branch status...
          </div>
        )}

        {step === 'commit_base' && resolved && (
          <div className="flex flex-col gap-3 py-2">
            <p className="text-xs text-muted-foreground">
              <code className="bg-muted px-1 rounded">{resolved.baseBranch}</code> has uncommitted
              changes: {resolved.baseUncommittedStats.filesChanged} files changed,{' '}
              <span className="text-green-500">+{resolved.baseUncommittedStats.insertions}</span>{' '}
              <span className="text-red-500">-{resolved.baseUncommittedStats.deletions}</span>
            </p>
            <Input
              value={baseCommitMessage}
              onChange={(e) => setBaseCommitMessage(e.target.value)}
              placeholder="Commit message for base branch"
            />
            <div className="flex items-center justify-between">
              <button
                onClick={() => clearPendingDoneMove()}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Keep in Review
              </button>
              <Button
                size="sm"
                onClick={handleCommitBase}
                disabled={!baseCommitMessage.trim() || committingBase}
              >
                {committingBase ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                ) : (
                  <GitCommit className="h-3 w-3 mr-1" />
                )}
                Commit
              </Button>
            </div>
          </div>
        )}

        {step === 'commit' && resolved && (
          <div className="flex flex-col gap-3 py-2">
            <p className="text-xs text-muted-foreground">
              {resolved.uncommittedStats.filesChanged} files changed,{' '}
              <span className="text-green-500">+{resolved.uncommittedStats.insertions}</span>{' '}
              <span className="text-red-500">-{resolved.uncommittedStats.deletions}</span>
            </p>
            <Input
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              placeholder="Commit message"
            />
            <div className="flex items-center justify-between">
              <button
                onClick={() => clearPendingDoneMove()}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Keep in Review
              </button>
              <Button
                size="sm"
                onClick={handleCommit}
                disabled={!commitMessage.trim() || committing}
              >
                {committing ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                ) : (
                  <GitCommit className="h-3 w-3 mr-1" />
                )}
                Commit
              </Button>
            </div>
          </div>
        )}

        {step === 'merge' && resolved && (
          <div className="flex flex-col gap-3 py-2">
            <div className="space-y-1.5">
              <label htmlFor="merge-target-branch" className="text-xs font-medium text-foreground">
                Merge into (base)
              </label>
              <p className="text-[11px] text-muted-foreground leading-snug">
                Branches are listed from your repo. If no workspace is on the target branch, merge
                uses your <span className="font-medium text-foreground/80">default</span> workspace:
                it checks out the target branch there (needs a clean tree), then merges your feature
                branch in.
              </p>
              <Popover
                open={mergeBaseOpen}
                onOpenChange={(open) => {
                  setMergeBaseOpen(open)
                  if (!open) setMergeBaseSearch('')
                }}
              >
                <PopoverTrigger asChild>
                  <button
                    id="merge-target-branch"
                    type="button"
                    className={cn(
                      'flex items-center justify-between w-full px-3 py-2 text-sm border rounded-md',
                      'bg-background hover:bg-accent/50 transition-colors text-left min-w-0'
                    )}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <GitBranch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="truncate font-mono text-xs">{resolved.baseBranch}</span>
                    </span>
                    <ChevronDown
                      className={cn(
                        'h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform',
                        mergeBaseOpen && 'rotate-180'
                      )}
                    />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-[var(--radix-popover-trigger-width)] p-0"
                  align="start"
                >
                  <div className="border-b px-2 py-1.5">
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={mergeBaseSearch}
                        onChange={(e) => setMergeBaseSearch(e.target.value)}
                        placeholder="Search branches…"
                        className="h-8 pl-8 text-sm"
                        autoComplete="off"
                      />
                    </div>
                  </div>
                  {resolved.candidateBaseBranches.length === 0 ? (
                    <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                      No merge targets found — check that the repo has other branches
                    </div>
                  ) : filteredMergeBaseOptions.length === 0 ? (
                    <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                      No matching branches
                    </div>
                  ) : (
                    <div className="max-h-[200px] overflow-y-auto">
                      {filteredMergeBaseOptions.map((name) => {
                        const onDedicated = resolved.mergeableViaDedicatedWorktree.includes(name)
                        const canMerge =
                          onDedicated || resolved.defaultWorktreeMergeFallbackPath != null
                        return (
                          <button
                            key={name}
                            type="button"
                            disabled={!canMerge}
                            title={
                              canMerge
                                ? onDedicated
                                  ? undefined
                                  : `Merge will check out ${name} in the default workspace first`
                                : 'No default workspace in this project — add one or open a workspace on this branch'
                            }
                            className={cn(
                              'flex items-center gap-2 w-full px-3 py-2 text-sm text-left font-mono',
                              'hover:bg-accent transition-colors',
                              name === resolved.baseBranch && 'bg-accent',
                              !canMerge && 'opacity-45 cursor-not-allowed hover:bg-transparent'
                            )}
                            onClick={() => void selectMergeBaseBranch(name)}
                          >
                            <GitBranch className="h-3 w-3 text-muted-foreground shrink-0" />
                            <span className="truncate">{name}</span>
                            <span className="ml-auto flex items-center gap-1.5 shrink-0">
                              {canMerge && !onDedicated && (
                                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                  default
                                </span>
                              )}
                              {!canMerge && (
                                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                  unavailable
                                </span>
                              )}
                              {name === resolved.baseBranch && (
                                <Check className="h-3 w-3 text-primary" />
                              )}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </PopoverContent>
              </Popover>
            </div>
            <p className="text-xs text-muted-foreground">
              Merge <code className="bg-muted px-1 rounded">{resolved.featureBranch}</code> into{' '}
              <code className="bg-muted px-1 rounded">{resolved.baseBranch}</code>
            </p>
            <p className="text-xs text-muted-foreground">
              {resolved.branchStats.filesChanged} files changed,
              <span className="text-green-500"> +{resolved.branchStats.insertions}</span>
              <span className="text-red-500"> -{resolved.branchStats.deletions}</span>,{' '}
              {resolved.branchStats.commitsAhead} commit
              {resolved.branchStats.commitsAhead !== 1 ? 's' : ''} ahead
            </p>
            <div className="flex items-center justify-between">
              <button
                onClick={() => clearPendingDoneMove()}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Keep in Review
              </button>
              <Button size="sm" onClick={handleMerge} disabled={merging}>
                {merging ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                ) : (
                  <GitMerge className="h-3 w-3 mr-1" />
                )}
                Merge
              </Button>
            </div>
          </div>
        )}

        {step === 'archive' && resolved && (
          <div className="flex flex-col gap-3 py-2">
            <p className="text-xs text-muted-foreground">
              Merge successful! Archive the{' '}
              <code className="bg-muted px-1 rounded">{resolved.featureBranch}</code> worktree?
            </p>
            <div className="flex items-center justify-between">
              <Button variant="outline" size="sm" onClick={() => completeDoneMove()}>
                Keep
              </Button>
              <Button size="sm" onClick={handleArchive} disabled={archiving}>
                {archiving ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                ) : (
                  <Archive className="h-3 w-3 mr-1" />
                )}
                Archive
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
