import { useEffect, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  GitBranch,
  GitCommitHorizontal,
  GitCompareArrows,
  Laptop,
  ListTree,
  RefreshCw
} from 'lucide-react'
import { useGitStore } from '@/stores/useGitStore'
import { useWorktreeStore } from '@/stores/useWorktreeStore'
import { cn } from '@/lib/utils'
import { useLayoutStore, type RightSidebarTab } from '@/stores/useLayoutStore'

interface EnvironmentPanelProps {
  worktreePath: string
}

interface DiffSummary {
  additions: number
  deletions: number
}

function openSidebarTab(tab: RightSidebarTab): void {
  useLayoutStore.getState().setRightSidebarTab(tab)
}

export function EnvironmentPanel({ worktreePath }: EnvironmentPanelProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(true)
  const [localExpanded, setLocalExpanded] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [diffSummary, setDiffSummary] = useState<DiffSummary>({ additions: 0, deletions: 0 })

  const worktreeName = useWorktreeStore((state) => {
    if (!state.selectedWorktreeId) return null
    for (const worktrees of state.worktreesByProject.values()) {
      const worktree = worktrees.find((item) => item.id === state.selectedWorktreeId)
      if (worktree) return worktree.name
    }
    return null
  })
  const statuses = useGitStore((state) => state.fileStatusesByWorktree.get(worktreePath))
  const branchInfo = useGitStore((state) => state.branchInfoByWorktree.get(worktreePath))

  useEffect(() => {
    const gitStore = useGitStore.getState()
    void Promise.all([
      gitStore.loadFileStatuses(worktreePath),
      gitStore.loadBranchInfo(worktreePath)
    ])
  }, [worktreePath])

  useEffect(() => {
    let active = true
    window.gitOps.getDiffStat(worktreePath).then((result) => {
      if (!active || !result.success || !result.files) return
      setDiffSummary({
        additions: result.files.reduce((sum, file) => sum + file.additions, 0),
        deletions: result.files.reduce((sum, file) => sum + file.deletions, 0)
      })
    })
    return () => {
      active = false
    }
  }, [worktreePath, statuses])

  const refresh = async (): Promise<void> => {
    setRefreshing(true)
    try {
      const gitStore = useGitStore.getState()
      await Promise.all([
        gitStore.refreshStatuses(worktreePath),
        gitStore.loadBranchInfo(worktreePath)
      ])
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <section className="shrink-0 border-b border-border bg-sidebar" data-testid="environment-panel">
      <div className="px-2.5 pb-2 pt-2">
        <div className="overflow-hidden rounded-xl border border-border/80 bg-card/55 shadow-sm">
          <div className="flex h-9 items-center gap-2 px-3 text-xs text-muted-foreground">
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-1.5 text-left hover:text-foreground"
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={expanded}
            >
              {expanded ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              <span className="font-medium">Environment</span>
            </button>
            <button
              type="button"
              onClick={() => void refresh()}
              className="rounded p-1 hover:bg-accent hover:text-foreground"
              title="Refresh environment"
              aria-label="Refresh environment"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
            </button>
          </div>

          {expanded && (
            <div className="border-t border-border/70 px-1.5 py-1.5">
              <button
                type="button"
                onClick={() => openSidebarTab('changes')}
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-xs hover:bg-accent/70"
              >
                <ListTree className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="flex-1 text-left">Changes</span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {statuses?.length ?? 0}
                </span>
                {diffSummary.additions > 0 && (
                  <span className="font-mono text-[11px] text-emerald-500">
                    +{diffSummary.additions}
                  </span>
                )}
                {diffSummary.deletions > 0 && (
                  <span className="font-mono text-[11px] text-rose-500">
                    -{diffSummary.deletions}
                  </span>
                )}
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/70" />
              </button>

              <button
                type="button"
                onClick={() => setLocalExpanded((value) => !value)}
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-xs hover:bg-accent/70"
                aria-expanded={localExpanded}
              >
                <Laptop className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="flex-1 truncate text-left">Local</span>
                <span className="max-w-28 truncate text-[11px] text-muted-foreground">
                  {worktreeName}
                </span>
                {localExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/70" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/70" />
                )}
              </button>
              {localExpanded && (
                <div
                  className="mx-2 mb-1 truncate rounded-md bg-muted/45 px-2 py-1.5 font-mono text-[10px] text-muted-foreground"
                  title={worktreePath}
                >
                  {worktreePath}
                </div>
              )}

              <div className="flex h-8 items-center gap-2 rounded-md px-2 text-xs">
                <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-left">
                  {branchInfo?.name ?? 'Loading branch...'}
                </span>
                {branchInfo && (branchInfo.ahead > 0 || branchInfo.behind > 0) && (
                  <span className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
                    {branchInfo.ahead > 0 && (
                      <span className="flex items-center gap-0.5" title={`${branchInfo.ahead} ahead`}>
                        <ArrowUp className="h-2.5 w-2.5" />{branchInfo.ahead}
                      </span>
                    )}
                    {branchInfo.behind > 0 && (
                      <span className="flex items-center gap-0.5" title={`${branchInfo.behind} behind`}>
                        <ArrowDown className="h-2.5 w-2.5" />{branchInfo.behind}
                      </span>
                    )}
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={() => openSidebarTab('changes')}
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-xs hover:bg-accent/70"
              >
                <GitCommitHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="flex-1 text-left">Commit or push</span>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/70" />
              </button>

              <button
                type="button"
                onClick={() => openSidebarTab('diffs')}
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-xs hover:bg-accent/70"
              >
                <GitCompareArrows className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="flex-1 text-left">Compare branch</span>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/70" />
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
