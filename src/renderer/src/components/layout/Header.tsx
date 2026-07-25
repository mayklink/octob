import React, { useCallback, useEffect, useState, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { isMac } from '@/lib/platform'
import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  History,
  Settings,
  Server,
  AlertTriangle,
  Loader2,
  GitPullRequest,
  GitMerge,
  Archive,
  ChevronDown,
  Coffee,
  FileSearch,
  X,
  ExternalLink,
  Copy,
  Hammer,
  Map,
  Check,
  LayoutGrid,
  MessageSquare,
  Code2,
  GitBranch,
  MoreHorizontal
} from 'lucide-react'
import { KanbanIcon } from '@/components/kanban/KanbanIcon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverTrigger, PopoverContent, PopoverAnchor } from '@/components/ui/popover'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator
} from '@/components/ui/context-menu'
import { cn } from '@/lib/utils'
import { useLayoutStore } from '@/stores/useLayoutStore'
import { useSessionHistoryStore } from '@/stores/useSessionHistoryStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import {
  REVIEW_PROMPT_LABELS,
  reviewPromptPresetIdForBuiltin,
  type ReviewPromptType
} from '@/constants/reviewPrompts'
import { useProjectStore } from '@/stores/useProjectStore'
import { useWorktreeStore } from '@/stores/useWorktreeStore'
import { useConnectionStore } from '@/stores/useConnectionStore'
import { useSessionStore } from '@/stores/useSessionStore'
import { useGitStore } from '@/stores/useGitStore'
import { useWorktreeStatusStore } from '@/stores/useWorktreeStatusStore'
import { useVimModeStore } from '@/stores/useVimModeStore'
import { useKanbanStore } from '@/stores/useKanbanStore'
import { useTipStore } from '@/stores/useTipStore'
import { Tip } from '@/components/ui/Tip'
import { useFileViewerStore } from '@/stores/useFileViewerStore'
import { useLifecycleActions } from '@/hooks/useLifecycleActions'
import { usePinAndActivateSession } from '@/hooks/usePinAndActivateSession'
import { OctobMark } from '@/components/brand/OctoBMark'

type ConflictFixFlow =
  | {
      phase: 'starting'
      worktreePath: string
    }
  | {
      phase: 'running'
      worktreePath: string
      sessionId: string
      seenBusy: boolean
    }
  | {
      phase: 'refreshing'
      worktreePath: string
    }

function isConflictFixActiveStatus(status: string | null): boolean {
  return (
    status === 'working' ||
    status === 'planning' ||
    status === 'answering' ||
    status === 'permission'
  )
}

export function Header(): React.JSX.Element {
  const { t } = useTranslation()
  const {
    leftSidebarCollapsed,
    rightSidebarCollapsed,
    workspaceMode,
    toggleLeftSidebar,
    toggleRightSidebar,
    workspaceView,
    setWorkspaceView,
    setWorkspaceContentView,
    setRightSidebarCollapsed,
    setRightSidebarTab,
    setWorkspaceMode,
    visualizationMode,
    setVisualizationMode
  } =
    useLayoutStore()
  const { openPanel: openSessionHistory } = useSessionHistoryStore()
  const openSettings = useSettingsStore((s) => s.openSettings)
  const selectedProjectId = useProjectStore((s) => s.selectedProjectId)
  const projects = useProjectStore((s) => s.projects)
  const { selectedWorktreeId, worktreesByProject } = useWorktreeStore()
  const selectedWorktreePath = useMemo(() => {
    if (!selectedWorktreeId) return null
    for (const worktrees of worktreesByProject.values()) {
      const wt = worktrees.find((w) => w.id === selectedWorktreeId)
      if (wt) return wt.path
    }
    return null
  }, [selectedWorktreeId, worktreesByProject])
  const createSession = useSessionStore((s) => s.createSession)
  const updateSessionName = useSessionStore((s) => s.updateSessionName)
  const setPendingMessage = useSessionStore((s) => s.setPendingMessage)
  const setActiveSession = useSessionStore((s) => s.setActiveSession)

  // Lifecycle actions hook — PR/Review/Merge/Archive logic
  const lifecycle = useLifecycleActions(selectedWorktreeId)
  const { pinAndActivate, lifecycleLoading } = usePinAndActivateSession()

  const vimMode = useVimModeStore((s) => s.mode)
  const vimModeEnabled = useSettingsStore((s) => s.vimModeEnabled)
  const mergeConflictMode = useSettingsStore((s) => s.mergeConflictMode)
  const boardMode = useSettingsStore((s) => s.boardMode)
  const reviewPromptPresetId = useSettingsStore((s) => s.reviewPromptPresetId)
  const codeReviewPromptTemplates = useSettingsStore((s) => s.codeReviewPromptTemplates ?? [])
  const updateSetting = useSettingsStore((s) => s.updateSetting)
  const keepAwakeEnabled = useSettingsStore((s) => s.keepAwakeEnabled)
  const streamingCount = useWorktreeStatusStore((state) =>
    Object.values(state.sessionStatuses).filter(
      (entry) => entry && (entry.status === 'working' || entry.status === 'planning')
    ).length
  )
  const showVimHints = vimModeEnabled && vimMode === 'normal'
  const isBoardViewActive = useKanbanStore((s) => s.isBoardViewActive)
  const toggleBoardView = useKanbanStore((s) => s.toggleBoardView)
  const kanbanIconSeen = useTipStore((s) => s.isTipSeen('kanban-icon'))
  const [conflictFixFlow, setConflictFixFlow] = useState<ConflictFixFlow | null>(null)

  // Track first-time kanban exit for the kanban-reenter tip
  const [justExitedKanban, setJustExitedKanban] = useState(false)
  const prevBoardActive = useRef(isBoardViewActive)
  useEffect(() => {
    if (prevBoardActive.current && !isBoardViewActive) {
      setJustExitedKanban(true)
    }
    prevBoardActive.current = isBoardViewActive
  }, [isBoardViewActive])

  const hasProjects = projects.length > 0

  const selectedProject = projects.find((p) => p.id === selectedProjectId)
  const selectedWorktree = (() => {
    if (!selectedWorktreeId) return null
    for (const worktrees of worktreesByProject.values()) {
      const wt = worktrees.find((w) => w.id === selectedWorktreeId)
      if (wt) return wt
    }
    return null
  })()

  // Connection mode detection
  const selectedConnectionId = useConnectionStore((s) => s.selectedConnectionId)
  const selectedConnection = useConnectionStore((s) =>
    s.selectedConnectionId ? s.connections.find((c) => c.id === s.selectedConnectionId) : null
  )
  const isConnectionMode = !!selectedConnectionId && !selectedWorktreeId

  const handleVisualizationModeChange = useCallback(
    (mode: 'basic' | 'advanced') => {
      setVisualizationMode(mode)
      if (mode === 'advanced') return

      if (selectedConnectionId) {
        setWorkspaceView('connection')
        setWorkspaceContentView('overview')
      } else if (selectedProjectId) {
        setWorkspaceView('project')
        setWorkspaceContentView(selectedWorktreeId ? 'session' : 'overview')
      } else {
        setWorkspaceView('projects')
        setWorkspaceContentView('overview')
      }
    },
    [
      selectedConnectionId,
      selectedProjectId,
      selectedWorktreeId,
      setVisualizationMode,
      setWorkspaceContentView,
      setWorkspaceView
    ]
  )

  const hasConflicts = useGitStore(
    (state) =>
      (selectedWorktree?.path ? state.conflictsByWorktree[selectedWorktree.path] : false) ?? false
  )

  // Keep isOperating in Header (used for button disable state)
  const isOperating = useGitStore((state) => state.isPushing || state.isPulling)

  // Destructure lifecycle state for template use
  const {
    attachedPR, hasAttachedPR, prLiveState, isGitHub,
    isMergingPR, isArchiving: isArchivingWorktree, branchInfo, remoteBranches,
    prTargetBranch, reviewTargetBranch, isCleanTree
  } = lifecycle

  const conflictFixSessionStatus = useWorktreeStatusStore((state) =>
    conflictFixFlow?.phase === 'running'
      ? (state.sessionStatuses[conflictFixFlow.sessionId]?.status ?? null)
      : null
  )

  // Clear conflict fix flow as soon as conflicts are resolved
  useEffect(() => {
    if (!hasConflicts && conflictFixFlow) {
      setConflictFixFlow(null)
    }
  }, [hasConflicts, conflictFixFlow])

  useEffect(() => {
    if (!conflictFixFlow || conflictFixFlow.phase !== 'running') return

    const isBusy = isConflictFixActiveStatus(conflictFixSessionStatus)

    if (isBusy && !conflictFixFlow.seenBusy) {
      setConflictFixFlow((prev) =>
        prev && prev.phase === 'running' ? { ...prev, seenBusy: true } : prev
      )
      return
    }

    const shouldFinalize =
      (conflictFixFlow.seenBusy && !isBusy) ||
      (!conflictFixFlow.seenBusy && conflictFixSessionStatus === 'completed')

    if (!shouldFinalize) return

    let cancelled = false
    const finishConflictRun = async (): Promise<void> => {
      setConflictFixFlow((prev) =>
        prev && prev.phase === 'running'
          ? { phase: 'refreshing', worktreePath: prev.worktreePath }
          : prev
      )

      try {
        await useGitStore.getState().refreshStatuses(conflictFixFlow.worktreePath)
      } finally {
        if (!cancelled) {
          setConflictFixFlow((prev) =>
            prev?.worktreePath === conflictFixFlow.worktreePath ? null : prev
          )
        }
      }
    }

    void finishConflictRun()

    return () => {
      cancelled = true
    }
  }, [conflictFixFlow, conflictFixSessionStatus])

  // Branch target pickers (review / PR base) — searchable popovers
  const [reviewBranchPickerOpen, setReviewBranchPickerOpen] = useState(false)
  const [reviewBranchSearch, setReviewBranchSearch] = useState('')
  const [prBranchPickerOpen, setPrBranchPickerOpen] = useState(false)
  const [prBranchSearch, setPrBranchSearch] = useState('')
  const reviewBranchSearchRef = useRef<HTMLInputElement>(null)
  const prBranchSearchRef = useRef<HTMLInputElement>(null)

  const filteredReviewBranches = useMemo(() => {
    const q = reviewBranchSearch.trim().toLowerCase()
    if (!q) return remoteBranches
    return remoteBranches.filter((b) => b.name.toLowerCase().includes(q))
  }, [remoteBranches, reviewBranchSearch])

  const filteredPrBranches = useMemo(() => {
    const q = prBranchSearch.trim().toLowerCase()
    if (!q) return remoteBranches
    return remoteBranches.filter((b) => b.name.toLowerCase().includes(q))
  }, [remoteBranches, prBranchSearch])

  useEffect(() => {
    if (!reviewBranchPickerOpen) return
    const t = window.setTimeout(() => reviewBranchSearchRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [reviewBranchPickerOpen])

  useEffect(() => {
    if (!prBranchPickerOpen) return
    const t = window.setTimeout(() => prBranchSearchRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [prBranchPickerOpen])

  // PR picker popover state (UI-specific to Header)
  const [prPickerOpen, setPrPickerOpen] = useState(false)
  const [prList, setPrList] = useState<
    Array<{ number: number; title: string; author: string; headRefName: string }>
  >([])
  const [prListLoading, setPrListLoading] = useState(false)

  // Fetch PR list + live state when picker opens
  useEffect(() => {
    if (!prPickerOpen) return
    setPrListLoading(true)

    const fetchPRs = lifecycle.loadPRList().then((list) => {
      setPrList(list)
    })

    const fetchState = lifecycle.hasAttachedPR
      ? lifecycle.loadPRState()
      : Promise.resolve()

    Promise.all([fetchPRs, fetchState]).finally(() => setPrListLoading(false))
  }, [prPickerOpen, lifecycle.hasAttachedPR])

  // Thin wrappers for actions that also manage UI-local state (prPickerOpen)
  const handleSelectPR = (pr: { number: number }) => {
    lifecycle.attachPR(pr.number)
    setPrPickerOpen(false)
  }

  const handleDetachPR = () => {
    lifecycle.detachPR()
    setPrPickerOpen(false)
  }

  const handleFixConflicts = useCallback(async (modeOverride?: 'build' | 'plan') => {
    if (!selectedWorktreeId || !selectedProjectId || !selectedWorktree?.path) return

    const resolvedMode = modeOverride ?? (mergeConflictMode === 'always-ask' ? 'build' : mergeConflictMode)

    setConflictFixFlow({
      phase: 'starting',
      worktreePath: selectedWorktree.path
    })

    const { success, session } = await createSession(selectedWorktreeId, selectedProjectId, undefined, resolvedMode)
    if (!success || !session) {
      setConflictFixFlow(null)
      return
    }

    const branchName = selectedWorktree?.branch_name || 'unknown'
    await updateSessionName(session.id, `Merge Conflicts — ${branchName}`)
    setPendingMessage(session.id, 'Fix merge conflicts')
    setActiveSession(session.id)

    setConflictFixFlow({
      phase: 'running',
      worktreePath: selectedWorktree.path,
      sessionId: session.id,
      seenBusy: false
    })
  }, [mergeConflictMode, selectedWorktreeId, selectedProjectId, selectedWorktree, createSession, updateSessionName, setPendingMessage, setActiveSession])

  const isFixConflictsLoading =
    !!selectedWorktree?.path &&
    !!conflictFixFlow &&
    conflictFixFlow.worktreePath === selectedWorktree.path

  const showFixConflictsButton = hasConflicts || isFixConflictsLoading

  const activeWorkspaceMode = isBoardViewActive ? 'board' : workspaceMode

  // A connection is a valid workspace too. It can browse the combined directory,
  // chat in connection-scoped sessions, and show its board. Git stays worktree-only
  // because a connection can contain multiple repositories.
  const workspaceModes = [
    ['chat', MessageSquare, 'Chat'],
    ['code', Code2, 'Code'],
    ['git', GitBranch, 'Git'],
    ['board', KanbanIcon, 'Board']
  ] as const

  useEffect(() => {
    if (isConnectionMode && workspaceMode === 'git') {
      setWorkspaceMode('chat')
    }
  }, [isConnectionMode, workspaceMode, setWorkspaceMode])

  const selectWorkspaceMode = (mode: 'chat' | 'code' | 'git' | 'board'): void => {
    setWorkspaceView(selectedConnectionId ? 'connection' : selectedProjectId ? 'project' : 'projects')
    setWorkspaceContentView(mode === 'chat' ? 'session' : 'overview')
    setWorkspaceMode(mode)
    if (mode === 'board') {
      useFileViewerStore.getState().clearActiveViews()
      if (!isBoardViewActive) toggleBoardView()
      setRightSidebarCollapsed(true)
      return
    }

    if (isBoardViewActive) toggleBoardView()
    if (mode === 'chat') {
      useFileViewerStore.getState().clearActiveViews()
      setRightSidebarCollapsed(true)
      return
    }

    // Code and Git own the main canvas. The sidebar remains reserved for
    // optional contextual information opened explicitly by the user.
    useFileViewerStore.getState().clearActiveViews()
    setRightSidebarTab(mode === 'git' ? 'changes' : 'files')
    setRightSidebarCollapsed(true)
  }

  return (
    <header
      className="h-13 border-b bg-background/95 backdrop-blur flex items-center justify-between px-3 flex-shrink-0 select-none"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      data-testid="header"
    >
      {/* Spacer for macOS traffic lights */}
      {isMac() && <div className="w-16 flex-shrink-0" />}
      <div className="flex items-stretch gap-1 flex-1 min-w-0 self-stretch">
        {visualizationMode === 'advanced' ? (
          <>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleLeftSidebar}
              title={leftSidebarCollapsed ? 'Show projects sidebar' : 'Hide projects sidebar'}
              data-testid="left-sidebar-toggle"
              className="h-8 w-8 shrink-0 self-center"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              {leftSidebarCollapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </Button>
            <OctobMark className="h-5 w-5 shrink-0 self-center" />
            {isConnectionMode && selectedConnection ? (
              <span className="self-center truncate text-sm font-medium" data-testid="header-connection-info">
                {selectedConnection.name}
                <span className="text-primary font-normal">
                  {' '}({selectedConnection.members.map((member) => member.project_name).join(' + ')})
                </span>
              </span>
            ) : selectedProject ? (
              <span className="self-center truncate text-sm font-medium" data-testid="header-project-info">
                {selectedProject.name}
                {selectedWorktree?.branch_name && selectedWorktree.name !== '(no-worktree)' && (
                  <span className="text-primary font-normal"> ({selectedWorktree.branch_name})</span>
                )}
              </span>
            ) : (
              <span className="self-center text-sm font-medium" data-testid="header-brand-fallback">
                Octob
              </span>
            )}
          </>
        ) : (
          <>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setWorkspaceView('projects')
            setWorkspaceContentView('overview')
            useFileViewerStore.getState().clearActiveViews()
            useKanbanStore.setState({ isBoardViewActive: false, isPinnedBoardActive: false })
          }}
          className={cn(
            'h-full rounded-none border-b-2 gap-2 px-3 text-sm font-semibold',
            workspaceView === 'projects'
              ? 'border-primary bg-accent/45 text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
          title="Projects"
          data-testid="top-projects-nav"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <OctobMark className="h-5 w-5 shrink-0" />
          Projects
        </Button>
        {selectedProject && (
          <div
            className={cn(
              'flex h-full max-w-72 min-w-0 items-center rounded-none border-b-2 text-sm font-semibold',
              workspaceView === 'project'
                ? 'border-primary bg-accent/45 text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
            title={selectedProject.path}
            data-testid="top-project-tab"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <button
              type="button"
              onClick={() => {
                setWorkspaceView('project')
                setWorkspaceContentView('overview')
                useConnectionStore.getState().selectConnection(null)
                useProjectStore.getState().selectProject(selectedProject.id)
                useWorktreeStore.getState().selectWorktree(null)
                useFileViewerStore.getState().clearActiveViews()
                useKanbanStore.setState({ isBoardViewActive: false, isPinnedBoardActive: false })
              }}
              className="flex h-full min-w-0 items-center gap-2 px-3"
            >
              <span className="truncate">{selectedProject.name}</span>
              {selectedWorktree?.branch_name && selectedWorktree.name !== '(no-worktree)' && (
                <span className="truncate text-primary font-normal">
                  {selectedWorktree.branch_name}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                useProjectStore.getState().selectProject(null)
                useWorktreeStore.getState().selectWorktree(null)
                useFileViewerStore.getState().clearActiveViews()
                useKanbanStore.setState({ isBoardViewActive: false, isPinnedBoardActive: false })
                if (workspaceView === 'project') setWorkspaceView('projects')
                setWorkspaceContentView('overview')
              }}
              className="mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Close tab"
              aria-label="Close project tab"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        {isConnectionMode && selectedConnection ? (
          <div
            className={cn(
              'flex h-full max-w-80 min-w-0 items-center rounded-none border-b-2 text-sm font-semibold',
              workspaceView === 'connection'
                ? 'border-primary bg-accent/45 text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
            title={selectedConnection.path}
            data-testid="top-connection-tab"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <button
              type="button"
              onClick={() => {
                setWorkspaceView('connection')
                setWorkspaceContentView('overview')
                useConnectionStore.getState().selectConnection(selectedConnection.id)
                useFileViewerStore.getState().clearActiveViews()
                useKanbanStore.setState({ isBoardViewActive: true, isPinnedBoardActive: false })
              }}
              className="flex h-full min-w-0 items-center gap-2 px-3"
            >
              <span className="truncate">
                {selectedConnection.custom_name || selectedConnection.name}
              </span>
              <span className="truncate text-primary font-normal">
                {selectedConnection.members.map((m) => m.project_name).join(' + ')}
              </span>
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                useConnectionStore.getState().selectConnection(null)
                useFileViewerStore.getState().clearActiveViews()
                useKanbanStore.setState({ isBoardViewActive: false, isPinnedBoardActive: false })
                if (workspaceView === 'connection') setWorkspaceView('projects')
                setWorkspaceContentView('overview')
              }}
              className="mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Close tab"
              aria-label="Close connection tab"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}
          </>
        )}
        {keepAwakeEnabled && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className={cn('shrink-0', streamingCount > 0 ? 'text-amber-500' : 'text-muted-foreground')}
                data-testid="keep-awake-indicator"
              >
                <Coffee className="h-4 w-4" />
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={8}>
              Prevents your computer from sleeping while a session is running
            </TooltipContent>
          </Tooltip>
        )}
        {vimModeEnabled && (
          <span
            className={cn(
              'text-[10px] font-mono px-1.5 py-0.5 rounded border select-none',
              vimMode === 'normal'
                ? 'text-muted-foreground bg-muted/50 border-border/50'
                : 'text-primary bg-primary/10 border-primary/30'
            )}
            data-testid="vim-mode-pill"
          >
            {vimMode === 'normal' ? 'NORMAL' : 'INSERT'}
          </span>
        )}
      </div>
      {!isConnectionMode && showFixConflictsButton && (
        <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {mergeConflictMode === 'always-ask' ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-7 text-xs font-semibold"
                  disabled={isFixConflictsLoading}
                  data-testid="fix-conflicts-button"
                >
                  {isFixConflictsLoading ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  ) : (
                    <AlertTriangle className="h-3.5 w-3.5 mr-1" />
                  )}
                  {isFixConflictsLoading ? 'Fixing conflicts...' : 'Fix conflicts'}
                  {!isFixConflictsLoading && <ChevronDown className="h-3 w-3 ml-1" />}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleFixConflicts('build')}>
                  <Hammer className="h-4 w-4 mr-2" />
                  Fix in Build mode
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleFixConflicts('plan')}>
                  <Map className="h-4 w-4 mr-2" />
                  Fix in Plan mode
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button
              size="sm"
              variant="destructive"
              className="h-7 text-xs font-semibold"
              onClick={() => handleFixConflicts()}
              disabled={isFixConflictsLoading}
              data-testid="fix-conflicts-button"
            >
              {isFixConflictsLoading ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5 mr-1" />
              )}
              {isFixConflictsLoading ? 'Fixing conflicts...' : 'Fix conflicts'}
            </Button>
          )}
        </div>
      )}
      <div className="flex-1" />
      {visualizationMode === 'advanced' && (selectedWorktree || selectedConnection) && (
        <nav
          className="mr-2 flex items-center gap-0.5 rounded-lg border bg-muted/35 p-0.5"
          aria-label="Workspace mode"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {workspaceModes.map(([mode, Icon, label]) => {
            const disabled = isConnectionMode && mode === 'git'
            return (
              <button
                key={mode}
                type="button"
                onClick={() => selectWorkspaceMode(mode)}
                disabled={disabled}
                title={disabled ? 'Select an individual worktree to use Git' : undefined}
                className={cn(
                  'flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors',
                  disabled
                    ? 'cursor-not-allowed text-muted-foreground/40'
                    : activeWorkspaceMode === mode
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                )}
                aria-current={activeWorkspaceMode === mode ? 'page' : undefined}
                data-testid={`workspace-mode-${mode}`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="hidden xl:inline">{label}</span>
              </button>
            )
          })}
        </nav>
      )}
      <div
        className="flex items-center gap-2"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <Button
          variant={workspaceView === 'pull-requests' ? 'secondary' : 'ghost'}
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={() => {
            if (workspaceView === 'pull-requests') {
              selectWorkspaceMode(workspaceMode)
              return
            }
            setWorkspaceView('pull-requests')
            useFileViewerStore.getState().clearActiveViews()
            useKanbanStore.setState({ isBoardViewActive: false, isPinnedBoardActive: false })
            setRightSidebarCollapsed(true)
          }}
          title="Pull request inbox"
          data-testid="pull-request-inbox-toggle"
        >
          <GitPullRequest className="h-3.5 w-3.5" />
          <span className="hidden xl:inline">Pull requests</span>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              title="Choose visualization mode"
              data-testid="visualization-mode-trigger"
            >
              {visualizationMode === 'basic' ? (
                <LayoutGrid className="h-3.5 w-3.5" />
              ) : (
                <PanelLeftOpen className="h-3.5 w-3.5" />
              )}
              {visualizationMode === 'basic' ? 'Basic' : 'Advanced'}
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>Visualization mode</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => handleVisualizationModeChange('basic')}>
              <LayoutGrid className="mr-2 h-4 w-4" />
              <div className="flex flex-1 flex-col">
                <span>Basic</span>
                <span className="text-xs text-muted-foreground">Project cards and quick overview</span>
              </div>
              {visualizationMode === 'basic' && <Check className="ml-2 h-4 w-4" />}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleVisualizationModeChange('advanced')}>
              <PanelLeftOpen className="mr-2 h-4 w-4" />
              <div className="flex flex-1 flex-col">
                <span>Advanced</span>
                <span className="text-xs text-muted-foreground">Classic sidebar and session workflow</span>
              </div>
              {visualizationMode === 'advanced' && <Check className="ml-2 h-4 w-4" />}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {!isConnectionMode &&
          isGitHub &&
          hasAttachedPR &&
          prLiveState?.state === 'MERGED' &&
          !lifecycle.isDefault && (
            <Button
              size="sm"
              variant="destructive"
              className="h-7 text-xs"
              onClick={() => lifecycle.archiveWorktree()}
              disabled={isArchivingWorktree}
              title="Archive worktree"
              data-testid="pr-archive-button"
            >
              {isArchivingWorktree ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <Archive className="h-3.5 w-3.5 mr-1" />
              )}
              {isArchivingWorktree ? (
                'Archiving...'
              ) : showVimHints ? (
                <span>
                  <span className="text-primary font-bold">A</span>rchive
                </span>
              ) : (
                'Archive'
              )}
            </Button>
          )}
        {!isConnectionMode &&
          isGitHub &&
          hasAttachedPR &&
          prLiveState?.state !== 'MERGED' &&
          prLiveState?.state !== 'CLOSED' &&
          isCleanTree && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs bg-emerald-600/10 border-emerald-600/30 text-emerald-500 hover:bg-emerald-600/20"
              onClick={() => lifecycle.mergePR()}
              disabled={isMergingPR}
              title="Merge Pull Request"
              data-testid="pr-merge-button"
            >
              {isMergingPR ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <GitMerge className="h-3.5 w-3.5 mr-1" />
              )}
              {isMergingPR ? (
                'Merging...'
              ) : showVimHints ? (
                <span>
                  <span className="text-primary font-bold">M</span>erge PR
                </span>
              ) : (
                'Merge PR'
              )}
            </Button>
          )}
        {!isConnectionMode && selectedWorktree && (
          <>
            <div className="flex items-center">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs rounded-r-none border-r-0"
                onClick={() => pinAndActivate(() => lifecycle.createCodeReview())}
                disabled={isOperating || lifecycleLoading}
                title="Review branch changes with AI"
                data-testid="review-button"
              >
                {lifecycleLoading ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                ) : (
                  <FileSearch className="h-3.5 w-3.5 mr-1" />
                )}
                {showVimHints ? (
                  <span>
                    <span className="text-primary font-bold">R</span>eview
                  </span>
                ) : (
                  'Review'
                )}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-1 rounded-l-none"
                    disabled={isOperating || lifecycleLoading}
                    data-testid="review-prompt-type-trigger"
                  >
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-[min(24rem,70vh)] overflow-y-auto">
                  <DropdownMenuLabel className="text-[11px] text-muted-foreground font-normal uppercase tracking-wide">
                    {t('settings.codeReviewPrompts.builtinGroup')}
                  </DropdownMenuLabel>
                  {(Object.keys(REVIEW_PROMPT_LABELS) as ReviewPromptType[]).map((type) => {
                    const presetId = reviewPromptPresetIdForBuiltin(type)
                    return (
                      <DropdownMenuItem
                        key={type}
                        onClick={() => {
                          updateSetting('reviewPromptPresetId', presetId)
                          pinAndActivate(() => lifecycle.createCodeReview())
                        }}
                        data-testid={`review-prompt-${type}`}
                      >
                        {reviewPromptPresetId === presetId && (
                          <Check className="h-3.5 w-3.5 mr-2" />
                        )}
                        {reviewPromptPresetId !== presetId && (
                          <span className="w-3.5 mr-2" />
                        )}
                        {REVIEW_PROMPT_LABELS[type]}
                      </DropdownMenuItem>
                    )
                  })}
                  {codeReviewPromptTemplates.length > 0 ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="text-[11px] text-muted-foreground font-normal uppercase tracking-wide">
                        {t('settings.codeReviewPrompts.customGroup')}
                      </DropdownMenuLabel>
                      {codeReviewPromptTemplates.map((tpl) => (
                        <DropdownMenuItem
                          key={tpl.id}
                          onClick={() => {
                            updateSetting('reviewPromptPresetId', tpl.id)
                            pinAndActivate(() => lifecycle.createCodeReview())
                          }}
                          data-testid={`review-prompt-custom-${tpl.id}`}
                        >
                          {reviewPromptPresetId === tpl.id && (
                            <Check className="h-3.5 w-3.5 mr-2" />
                          )}
                          {reviewPromptPresetId !== tpl.id && (
                            <span className="w-3.5 mr-2" />
                          )}
                          {tpl.name.trim() || t('settings.codeReviewPrompts.unnamed')}
                        </DropdownMenuItem>
                      ))}
                    </>
                  ) : null}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => openSettings('code-review-prompts')}
                    data-testid="review-prompt-edit-templates"
                  >
                    <span className="w-3.5 mr-2" />
                    {t('settings.codeReviewPrompts.manageLink')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <Popover
              open={reviewBranchPickerOpen}
              onOpenChange={(open) => {
                setReviewBranchPickerOpen(open)
                if (!open) setReviewBranchSearch('')
              }}
            >
              <PopoverTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-xs text-muted-foreground px-2 h-7"
                  data-testid="review-target-branch-trigger"
                >
                  vs {reviewTargetBranch || branchInfo?.tracking || 'origin/main'}
                  <ChevronDown className="h-3 w-3 ml-1" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="w-72 p-0"
                onOpenAutoFocus={(e) => {
                  e.preventDefault()
                  reviewBranchSearchRef.current?.focus()
                }}
              >
                <div className="p-2 border-b border-border">
                  <Input
                    ref={reviewBranchSearchRef}
                    type="search"
                    value={reviewBranchSearch}
                    onChange={(e) => setReviewBranchSearch(e.target.value)}
                    placeholder={t('layout.branchPickerSearchPlaceholder')}
                    className="h-8 text-xs"
                    data-testid="review-target-branch-search"
                  />
                </div>
                <div className="max-h-60 overflow-y-auto p-1">
                  {remoteBranches.length === 0 ? (
                    <div className="px-2 py-3 text-xs text-muted-foreground text-center">
                      No remote branches
                    </div>
                  ) : filteredReviewBranches.length === 0 ? (
                    <div className="px-2 py-3 text-xs text-muted-foreground text-center">
                      {t('layout.branchPickerNoMatches')}
                    </div>
                  ) : (
                    filteredReviewBranches.map((branch) => (
                      <button
                        key={branch.name}
                        type="button"
                        className={cn(
                          'w-full text-left px-2 py-1.5 text-xs rounded-sm',
                          'hover:bg-accent transition-colors',
                          (reviewTargetBranch || branchInfo?.tracking || 'origin/main') ===
                            branch.name && 'bg-accent/60'
                        )}
                        onClick={() => {
                          lifecycle.setReviewTargetBranch(branch.name)
                          setReviewBranchPickerOpen(false)
                        }}
                        data-testid={`review-target-branch-${branch.name}`}
                      >
                        {branch.name}
                      </button>
                    ))
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </>
        )}
        {/* PR Badge with Popover Picker — shown when a PR is attached */}
        {!isConnectionMode && isGitHub && hasAttachedPR && (
          <ContextMenu>
            <Popover open={prPickerOpen} onOpenChange={setPrPickerOpen}>
              <ContextMenuTrigger asChild>
                <PopoverTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    title={`PR #${attachedPR!.number} (right-click for options)`}
                    data-testid="pr-badge"
                  >
                    <GitPullRequest className="h-3.5 w-3.5 mr-1" />
                    PR #{attachedPR!.number}
                    {prLiveState?.state === 'MERGED' && (
                      <span className="text-muted-foreground ml-1">· merged</span>
                    )}
                    {prLiveState?.state === 'CLOSED' && (
                      <span className="text-muted-foreground ml-1">· closed</span>
                    )}
                  </Button>
                </PopoverTrigger>
              </ContextMenuTrigger>
              <PopoverContent align="end" className="w-80 p-0">
                {/* Attached PR header */}
                <div className="px-3 py-2 border-b">
                  <div className="text-xs font-medium text-muted-foreground">
                    Attached: #{attachedPR!.number}
                  </div>
                  {prLiveState?.title && (
                    <div className="text-sm truncate">
                      {prLiveState.title}
                      {prLiveState.state && (
                        <span className="text-muted-foreground ml-1 text-xs">
                          ({prLiveState.state.toLowerCase()})
                        </span>
                      )}
                    </div>
                  )}
                </div>
                {/* PR list */}
                <div className="max-h-48 overflow-y-auto">
                  {prListLoading ? (
                    <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin inline mr-1" />
                      Loading PRs...
                    </div>
                  ) : prList.length === 0 ? (
                    <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                      No open PRs found
                    </div>
                  ) : (
                    prList.map((pr) => (
                      <button
                        key={pr.number}
                        className={cn(
                          'w-full text-left px-3 py-2 text-sm hover:bg-accent cursor-pointer',
                          'flex items-center gap-2',
                          pr.number === attachedPR!.number && 'bg-accent/50'
                        )}
                        onClick={() => handleSelectPR(pr)}
                        data-testid={`pr-picker-item-${pr.number}`}
                      >
                        <span className={cn(
                          'text-xs font-mono shrink-0',
                          pr.number === attachedPR!.number && 'text-primary font-bold'
                        )}>
                          {pr.number === attachedPR!.number ? '●' : ' '} #{pr.number}
                        </span>
                        <span className="truncate">{pr.title}</span>
                      </button>
                    ))
                  )}
                </div>
                {/* Detach action */}
                <div className="border-t">
                  <button
                    className="w-full text-left px-3 py-2 text-sm text-destructive hover:bg-destructive/10 cursor-pointer flex items-center gap-1"
                    onClick={handleDetachPR}
                    data-testid="pr-detach-button"
                  >
                    <X className="h-3.5 w-3.5" />
                    Detach PR
                  </button>
                </div>
              </PopoverContent>
            </Popover>
            <ContextMenuContent>
              <ContextMenuItem onClick={lifecycle.openPRInBrowser}>
                <ExternalLink className="h-4 w-4 mr-2" />
                Open PR in Browser
              </ContextMenuItem>
              <ContextMenuItem onClick={lifecycle.copyPRUrl}>
                <Copy className="h-4 w-4 mr-2" />
                Copy PR URL
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                onClick={handleDetachPR}
                className="text-destructive focus:text-destructive focus:bg-destructive/10"
              >
                <X className="h-4 w-4 mr-2" />
                Detach PR
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        )}
        {/* Create PR button — shown when no PR attached */}
        {!isConnectionMode && isGitHub && !hasAttachedPR && (
          <Popover open={prPickerOpen} onOpenChange={setPrPickerOpen}>
            <PopoverAnchor asChild>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => {
                  if (selectedWorktreeId && selectedWorktreePath) {
                    useGitStore.getState().setCreatePRModalOpen(true, {
                      worktreeId: selectedWorktreeId,
                      worktreePath: selectedWorktreePath,
                    })
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setPrPickerOpen(true)
                }}
                disabled={isOperating || lifecycleLoading}
                title="Create Pull Request (right-click to attach existing)"
                data-testid="pr-button"
              >
                {lifecycleLoading ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                ) : (
                  <GitPullRequest className="h-3.5 w-3.5 mr-1" />
                )}
                {showVimHints ? (
                  <span>
                    <span className="text-primary font-bold">P</span>R
                  </span>
                ) : (
                  'PR'
                )}
              </Button>
            </PopoverAnchor>
            <PopoverContent align="end" className="w-80 p-0">
              <div className="px-3 py-2 border-b">
                <div className="text-xs font-medium text-muted-foreground">
                  Attach existing PR
                </div>
              </div>
              <div className="max-h-48 overflow-y-auto">
                {prListLoading ? (
                  <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin inline mr-1" />
                    Loading PRs...
                  </div>
                ) : prList.length === 0 ? (
                  <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                    No open PRs found
                  </div>
                ) : (
                  prList.map((pr) => (
                    <button
                      key={pr.number}
                      className={cn(
                        'w-full text-left px-3 py-2 text-sm hover:bg-accent cursor-pointer',
                        'flex items-center gap-2'
                      )}
                      onClick={() => handleSelectPR(pr)}
                      data-testid={`pr-picker-item-${pr.number}`}
                    >
                      <span className="text-xs font-mono shrink-0">
                        #{pr.number}
                      </span>
                      <span className="truncate">{pr.title}</span>
                    </button>
                  ))
                )}
              </div>
            </PopoverContent>
            <Popover
              modal={false}
              open={prBranchPickerOpen}
              onOpenChange={(open) => {
                setPrBranchPickerOpen(open)
                if (!open) setPrBranchSearch('')
              }}
            >
              <PopoverTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-xs text-muted-foreground px-2 h-7"
                  data-testid="pr-target-branch-trigger"
                >
                  → {prTargetBranch || branchInfo?.tracking || 'origin/main'}
                  <ChevronDown className="h-3 w-3 ml-1" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="w-72 p-0"
                onOpenAutoFocus={(e) => {
                  e.preventDefault()
                  prBranchSearchRef.current?.focus()
                }}
              >
                <div className="p-2 border-b border-border">
                  <Input
                    ref={prBranchSearchRef}
                    type="search"
                    value={prBranchSearch}
                    onChange={(e) => setPrBranchSearch(e.target.value)}
                    placeholder={t('layout.branchPickerSearchPlaceholder')}
                    className="h-8 text-xs"
                    data-testid="pr-target-branch-search"
                  />
                </div>
                <div className="max-h-60 overflow-y-auto p-1">
                  {remoteBranches.length === 0 ? (
                    <div className="px-2 py-3 text-xs text-muted-foreground text-center">
                      No remote branches
                    </div>
                  ) : filteredPrBranches.length === 0 ? (
                    <div className="px-2 py-3 text-xs text-muted-foreground text-center">
                      {t('layout.branchPickerNoMatches')}
                    </div>
                  ) : (
                    filteredPrBranches.map((branch) => (
                      <button
                        key={branch.name}
                        type="button"
                        className={cn(
                          'w-full text-left px-2 py-1.5 text-xs rounded-sm',
                          'hover:bg-accent transition-colors',
                          (prTargetBranch || branchInfo?.tracking || 'origin/main') === branch.name &&
                            'bg-accent/60'
                        )}
                        onClick={() => {
                          lifecycle.setPrTargetBranch(branch.name)
                          setPrBranchPickerOpen(false)
                        }}
                        data-testid={`pr-target-branch-${branch.name}`}
                      >
                        {branch.name}
                      </button>
                    ))
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </Popover>
        )}
        {boardMode === 'toggle' && visualizationMode !== 'advanced' && (
          <Tip
            tipId={kanbanIconSeen ? 'kanban-reenter' : 'kanban-icon'}
            enabled={kanbanIconSeen ? justExitedKanban : hasProjects}
          >
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                const fileStore = useFileViewerStore.getState()
                if (!isBoardViewActive) {
                  fileStore.clearActiveViews()
                  toggleBoardView()
                } else if (fileStore.hasActiveOverlay()) {
                  fileStore.clearActiveViews()
                } else {
                  toggleBoardView()
                }
              }}
              title={isBoardViewActive ? 'Close Board' : 'Open Board'}
              data-testid="kanban-board-toggle"
              className={cn(
                isBoardViewActive && 'bg-accent text-accent-foreground'
              )}
            >
              <KanbanIcon className="h-4 w-4" />
            </Button>
          </Tip>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              title="More actions"
              data-testid="header-more-actions"
              className="h-8 w-8"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={openSessionHistory} data-testid="session-history-toggle">
              <History className="mr-2 h-4 w-4" />
              Session history
              <span className="ml-auto text-[10px] text-muted-foreground">⌘K</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openSettings('mcp')} data-testid="mcp-settings-toggle">
              <Server className="mr-2 h-4 w-4" />
              MCP servers
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => openSettings()} data-testid="settings-toggle">
              <Settings className="mr-2 h-4 w-4" />
              Settings
              <span className="ml-auto text-[10px] text-muted-foreground">⌘,</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          onClick={toggleRightSidebar}
          variant="ghost"
          size="icon"
          title={rightSidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          data-testid="right-sidebar-toggle"
        >
          {rightSidebarCollapsed ? (
            <PanelRightOpen className="h-4 w-4" />
          ) : (
            <PanelRightClose className="h-4 w-4" />
          )}
        </Button>
      </div>
    </header>
  )
}
