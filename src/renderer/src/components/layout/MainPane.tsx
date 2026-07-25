import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import { SessionTabs, SessionView } from '@/components/sessions'
import { SessionTerminalView } from '@/components/sessions/SessionTerminalView'
import { FileViewer } from '@/components/file-viewer'
import { ImageDiffView } from '@/components/diff'
import { isImageFile } from '@shared/types/file-utils'
import { useWorktreeStore } from '@/stores/useWorktreeStore'
import { useSessionStore, BOARD_TAB_ID } from '@/stores/useSessionStore'
import { useConnectionStore } from '@/stores/useConnectionStore'
import { useFileViewerStore } from '@/stores/useFileViewerStore'
import { useLayoutStore } from '@/stores/useLayoutStore'
import { useKanbanStore } from '@/stores/useKanbanStore'
import { useProjectStore } from '@/stores/useProjectStore'
import { usePinnedStore } from '@/stores/usePinnedStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { KanbanBoard } from '@/components/kanban/KanbanBoard'
import { KanbanIcon } from '@/components/kanban/KanbanIcon'
import { BoardAssistantView } from '@/components/kanban/BoardAssistantView'
import { PRNotificationStack } from '@/components/pr/PRNotificationStack'
import { MainPaneTerminalPanel } from './MainPaneTerminalPanel'
import { SettingsView } from '@/components/settings'
import { ProjectDashboard } from '@/components/projects/ProjectDashboard'
import { WorkspaceFocusView } from './WorkspaceFocusView'
import { PullRequestInbox } from '@/components/pr-inbox/PullRequestInbox'

const SESSION_TERMINAL_VIEW_IDLE_UNMOUNT_MS = 60_000
const MAX_MOUNTED_SESSION_TERMINAL_VIEWS = 2

const MonacoDiffView = lazy(() => import('@/components/diff/MonacoDiffView'))
const WorktreeContextEditor = lazy(() =>
  import('@/components/worktrees/WorktreeContextEditor').then((m) => ({
    default: m.WorktreeContextEditor
  }))
)
interface MainPaneProps {
  children?: React.ReactNode
}

export function MainPane({ children }: MainPaneProps): React.JSX.Element {
  const selectedWorktreeId = useWorktreeStore((state) => state.selectedWorktreeId)
  const selectedConnectionId = useConnectionStore((state) => state.selectedConnectionId)
  const selectedConnectionPath = useConnectionStore((state) =>
    state.selectedConnectionId
      ? state.connections.find((connection) => connection.id === state.selectedConnectionId)?.path ?? null
      : null
  )
  const activeSessionId = useSessionStore((state) => state.activeSessionId)
  const isLoading = useSessionStore((state) => state.isLoading)
  const inlineConnectionSessionId = useSessionStore((state) => state.inlineConnectionSessionId)
  const activeFilePath = useFileViewerStore((state) => state.activeFilePath)
  const activeDiff = useFileViewerStore((state) => state.activeDiff)
  const contextEditorWorktreeId = useFileViewerStore((state) => state.contextEditorWorktreeId)
  const closedTerminalSessionIds = useSessionStore((state) => state.closedTerminalSessionIds)
  const ghosttyOverlaySuppressed = useLayoutStore((state) => state.ghosttyOverlaySuppressed)
  const workspaceView = useLayoutStore((state) => state.workspaceView)
  const workspaceContentView = useLayoutStore((state) => state.workspaceContentView)
  const visualizationMode = useLayoutStore((state) => state.visualizationMode)
  const workspaceMode = useLayoutStore((state) => state.workspaceMode)
  const activePinnedSessionId = useSessionStore((state) => state.activePinnedSessionId)
  const activeBoardAssistantProjectId = useSessionStore((state) => state.activeBoardAssistantProjectId)
  const isBoardViewActive = useKanbanStore((state) => state.isBoardViewActive)
  const isPinnedBoardActive = useKanbanStore((state) => state.isPinnedBoardActive)
  const pinnedStoreLoaded = usePinnedStore((state) => state.loaded)
  const boardMode = useSettingsStore((s) => s.boardMode)
  const terminalPosition = useSettingsStore((s) => s.terminalPosition)
  const settingsOpen = useSettingsStore((s) => s.isOpen)
  const selectedProjectId = useProjectStore((state) => state.selectedProjectId)
  const selectedProjectPath = useProjectStore((state) =>
    state.projects.find((p) => p.id === state.selectedProjectId)?.path ?? ''
  )
  const selectedWorktreePath = useMemo(() => {
    if (!selectedWorktreeId) return null
    for (const worktrees of useWorktreeStore.getState().worktreesByProject.values()) {
      const worktree = worktrees.find((item) => item.id === selectedWorktreeId)
      if (worktree) return worktree.path
    }
    return null
  }, [selectedWorktreeId])

  // Subscribe to session maps so terminal list stays reactive
  const sessionsByWorktree = useSessionStore((state) => state.sessionsByWorktree)
  const sessionsByConnection = useSessionStore((state) => state.sessionsByConnection)

  // Look up the agent_sdk for a given session ID
  const getAgentSdk = useCallback((sid: string | null): string | null => {
    if (!sid) return null
    const state = useSessionStore.getState()
    for (const sessions of state.sessionsByWorktree.values()) {
      const found = sessions.find((s) => s.id === sid)
      if (found) return found.agent_sdk
    }
    for (const sessions of state.sessionsByConnection.values()) {
      const found = sessions.find((s) => s.id === sid)
      if (found) return found.agent_sdk
    }
    return null
  }, [])

  // Collect all terminal-type sessions in the current scope.
  const terminalSessions = useMemo(() => {
    const terminals: string[] = []

    if (selectedWorktreeId) {
      const sessions = sessionsByWorktree.get(selectedWorktreeId) || []
      for (const s of sessions) {
        if (s.agent_sdk === 'terminal') terminals.push(s.id)
      }
    }

    if (selectedConnectionId) {
      const sessions = sessionsByConnection.get(selectedConnectionId) || []
      for (const s of sessions) {
        if (s.agent_sdk === 'terminal') terminals.push(s.id)
      }
    }

    return terminals
  }, [selectedWorktreeId, selectedConnectionId, sessionsByWorktree, sessionsByConnection])

  // Session terminals are expensive because they mount xterm/Ghostty surfaces.
  // Mount them lazily, keep the active one plus one recent hidden view, then
  // unload hidden views after a short idle window. The PTY itself remains alive
  // until the session tab is closed, so switching back still reconnects.
  const [mountedTerminalSessionIds, setMountedTerminalSessionIds] = useState<string[]>([])
  const terminalIdlePruneTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)

  // Prune terminals that were explicitly closed (tab close).
  // Closed terminal tabs must be removed immediately, regardless of the idle cache.
  useEffect(() => {
    if (closedTerminalSessionIds.size === 0) return

    setMountedTerminalSessionIds((current) => {
      const filtered = current.filter((id) => !closedTerminalSessionIds.has(id))
      return filtered.length === current.length ? current : filtered
    })

    // Acknowledge so the signal set doesn't grow forever
    useSessionStore.getState().acknowledgeClosedTerminals(closedTerminalSessionIds)
  }, [closedTerminalSessionIds])

  // Determine which terminal session is currently visible (if any).
  // A terminal is visible when it's the active session AND no diff/file/loading overlay is on top.
  const visibleTerminalId = useMemo(() => {
    if (visualizationMode === 'basic' && workspaceContentView !== 'session') {
      return null
    }

    if (ghosttyOverlaySuppressed) {
      return null
    }

    // Inline connection terminal takes priority
    if (inlineConnectionSessionId && getAgentSdk(inlineConnectionSessionId) === 'terminal') {
      if (!activeDiff && !(activeFilePath && !activeFilePath.startsWith('diff:'))) {
        return inlineConnectionSessionId
      }
    }

    // Regular active session
    if (activeSessionId && getAgentSdk(activeSessionId) === 'terminal') {
      if (!activeDiff && !(activeFilePath && !activeFilePath.startsWith('diff:'))) {
        if (!inlineConnectionSessionId) {
          return activeSessionId
        }
      }
    }

    return null
  }, [
    activeSessionId,
    inlineConnectionSessionId,
    workspaceContentView,
    visualizationMode,
    activeDiff,
    activeFilePath,
    getAgentSdk,
    ghosttyOverlaySuppressed
  ])

  useEffect(() => {
    const liveTerminalIds = new Set(terminalSessions)

    setMountedTerminalSessionIds((current) => {
      const pruned = current.filter((id) => liveTerminalIds.has(id) || id === visibleTerminalId)
      if (!visibleTerminalId) {
        return pruned.length === current.length ? current : pruned
      }

      const next = [
        visibleTerminalId,
        ...pruned.filter((id) => id !== visibleTerminalId)
      ].slice(0, MAX_MOUNTED_SESSION_TERMINAL_VIEWS)

      return next.length === current.length && next.every((id, index) => id === current[index])
        ? current
        : next
    })
  }, [terminalSessions, visibleTerminalId])

  useEffect(() => {
    if (terminalIdlePruneTimerRef.current) {
      window.clearTimeout(terminalIdlePruneTimerRef.current)
      terminalIdlePruneTimerRef.current = null
    }

    terminalIdlePruneTimerRef.current = window.setTimeout(() => {
      setMountedTerminalSessionIds((current) =>
        visibleTerminalId ? current.filter((id) => id === visibleTerminalId) : []
      )
    }, SESSION_TERMINAL_VIEW_IDLE_UNMOUNT_MS)

    return () => {
      if (terminalIdlePruneTimerRef.current) {
        window.clearTimeout(terminalIdlePruneTimerRef.current)
        terminalIdlePruneTimerRef.current = null
      }
    }
  }, [visibleTerminalId])

  const renderedTerminalSessionIds = useMemo(() => {
    if (!visibleTerminalId || mountedTerminalSessionIds.includes(visibleTerminalId)) {
      return mountedTerminalSessionIds
    }
    return [visibleTerminalId, ...mountedTerminalSessionIds].slice(0, MAX_MOUNTED_SESSION_TERMINAL_VIEWS)
  }, [mountedTerminalSessionIds, visibleTerminalId])

  const handleCloseDiff = useCallback(() => {
    const filePath = useFileViewerStore.getState().activeFilePath
    if (filePath?.startsWith('diff:')) {
      useFileViewerStore.getState().closeDiffTab(filePath)
    } else {
      useFileViewerStore.getState().clearActiveDiff()
    }
  }, [])

  // Determine what to show in the main content area
  const renderContent = () => {
    if (children) {
      return children
    }

    if (settingsOpen) {
      return <SettingsView />
    }

    if (workspaceView === 'pull-requests' && !activeFilePath && !activeDiff && !contextEditorWorktreeId) {
      return <PullRequestInbox />
    }

    // Board assistant tab is active — render BoardAssistantView in main pane
    if (activeBoardAssistantProjectId && !activeFilePath && !activeDiff && !contextEditorWorktreeId) {
      return <BoardAssistantView key={activeBoardAssistantProjectId} projectId={activeBoardAssistantProjectId} />
    }

    if (
      visualizationMode === 'basic' &&
      workspaceView === 'projects' &&
      !activeFilePath &&
      !activeDiff &&
      !contextEditorWorktreeId
    ) {
      return <ProjectDashboard />
    }

    if (
      visualizationMode === 'basic' &&
      workspaceContentView === 'overview' &&
      (workspaceView === 'project' || workspaceView === 'connection') &&
      !activeFilePath &&
      !activeDiff &&
      !contextEditorWorktreeId
    ) {
      return <ProjectDashboard />
    }

    // Code and Git explicitly own the main canvas. Keep this before every board
    // branch so a sticky/persisted Board tab cannot cover the selected workspace mode.
    if (
      visualizationMode === 'advanced' &&
      ((selectedWorktreeId &&
        selectedWorktreePath &&
        (workspaceMode === 'code' || workspaceMode === 'git')) ||
        (selectedConnectionId && selectedConnectionPath && workspaceMode === 'code')) &&
      !activeFilePath &&
      !activeDiff &&
      !contextEditorWorktreeId
    ) {
      return (
        <WorkspaceFocusView
          mode={workspaceMode}
          worktreeId={selectedWorktreeId ?? selectedConnectionId!}
          worktreePath={selectedWorktreePath ?? selectedConnectionPath!}
        />
      )
    }

    // Sticky-tab board mode: render board when BOARD_TAB_ID is the active session
    if (boardMode === 'sticky-tab' && activeSessionId === BOARD_TAB_ID && !inlineConnectionSessionId && !activeFilePath && !activeDiff && !contextEditorWorktreeId) {
      // Pinned board takes priority when active
      if (isPinnedBoardActive && pinnedStoreLoaded) {
        return <KanbanBoard isPinnedMode={true} />
      }
      // Worktree mode: show project board
      if (selectedProjectId && !selectedConnectionId) {
        return <KanbanBoard projectId={selectedProjectId} projectPath={selectedProjectPath} />
      }
      // Connection mode: show connection board
      if (selectedConnectionId) {
        return <KanbanBoard connectionId={selectedConnectionId} />
      }
      // No project selected: empty state
      return (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center">
            <KanbanIcon className="h-8 w-8 mx-auto mb-3 opacity-50" />
            <p className="text-sm">Select a project to view its board</p>
          </div>
        </div>
      )
    }

    // Pinned session takes priority over board when active
    if (isBoardViewActive && activePinnedSessionId && !activeFilePath && !activeDiff && !contextEditorWorktreeId) {
      return <SessionView key={activePinnedSessionId} sessionId={activePinnedSessionId} />
    }

    // Pinned projects board view (independent of project/connection selection)
    // Wait for pinned store to load so we don't flash an empty state on startup.
    if (isPinnedBoardActive && pinnedStoreLoaded && !activeFilePath && !activeDiff && !contextEditorWorktreeId) {
      return <KanbanBoard isPinnedMode={true} />
    }

    // Board view — project-level (works with or without worktree selected)
    if (isBoardViewActive && selectedProjectId && !selectedConnectionId && !activeFilePath && !activeDiff && !contextEditorWorktreeId) {
      return <KanbanBoard projectId={selectedProjectId} projectPath={selectedProjectPath} />
    }

    // Board view — connection-level
    if (isBoardViewActive && selectedConnectionId && !activeFilePath && !activeDiff && !contextEditorWorktreeId) {
      return <KanbanBoard connectionId={selectedConnectionId} />
    }

    // Board view — no project selected yet (empty state)
    if (isBoardViewActive && !activeFilePath && !activeDiff && !contextEditorWorktreeId) {
      return (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center">
            <KanbanIcon className="h-8 w-8 mx-auto mb-3 opacity-50" />
            <p className="text-sm">Select a project to view its board</p>
          </div>
        </div>
      )
    }

    // Project dashboard - primary project/worktree surface
    if (!selectedWorktreeId && !selectedConnectionId && !activeFilePath && !activeDiff && !contextEditorWorktreeId) {
      if (visualizationMode === 'basic') return <ProjectDashboard />
      return (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center">
            <p className="text-lg font-medium">Welcome to Octob</p>
            <p className="text-sm mt-2">Select a project or worktree to get started.</p>
          </div>
        </div>
      )
    }

    // Loading sessions (including auto-start)
    if (isLoading) {
      return (
        <div className="flex-1 flex items-center justify-center" data-testid="session-loading">
          <div className="text-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mx-auto" />
            <p className="text-sm text-muted-foreground mt-2">Loading sessions...</p>
          </div>
        </div>
      )
    }

    // Diff viewer is active
    if (activeDiff) {
      // Image files get their own viewer (binary diffs don't work in text editors)
      if (isImageFile(activeDiff.filePath)) {
        return (
          <ImageDiffView
            worktreePath={activeDiff.worktreePath}
            filePath={activeDiff.filePath}
            fileName={activeDiff.fileName}
            staged={activeDiff.staged}
            isUntracked={activeDiff.isUntracked}
            isNewFile={activeDiff.isNewFile}
            compareBranch={activeDiff.compareBranch}
            onClose={handleCloseDiff}
          />
        )
      }
      // All text diffs (including new/untracked files) use Monaco DiffEditor.
      // For new files the original side is empty, so Monaco shows the full file
      // as additions with proper syntax highlighting for all languages.
      return (
        <Suspense
          fallback={
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          }
        >
          <MonacoDiffView
            key={`${activeDiff.filePath}|${activeDiff.compareBranch ?? ''}|${activeDiff.staged}|${activeDiff.prReviewWorktreeId ?? ''}`}
            worktreePath={activeDiff.worktreePath}
            filePath={activeDiff.filePath}
            fileName={activeDiff.fileName}
            staged={activeDiff.staged}
            isUntracked={activeDiff.isUntracked}
            isNewFile={activeDiff.isNewFile}
            compareBranch={activeDiff.compareBranch}
            scrollToLine={activeDiff.scrollToLine}
            scrollTrigger={activeDiff.scrollTrigger}
            prReviewWorktreeId={activeDiff.prReviewWorktreeId}
            onClose={handleCloseDiff}
          />
        </Suspense>
      )
    }

    // Context editor is active
    if (contextEditorWorktreeId && activeFilePath?.startsWith('context:')) {
      return (
        <Suspense
          fallback={
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          }
        >
          <WorktreeContextEditor worktreeId={contextEditorWorktreeId} />
        </Suspense>
      )
    }

    // File viewer tab is active - render FileViewer (skip diff tab keys)
    if (activeFilePath && !activeFilePath.startsWith('diff:')) {
      return <FileViewer key={activeFilePath} filePath={activeFilePath} />
    }

    // Inline connection session view (sticky tab clicked in worktree mode)
    if (inlineConnectionSessionId) {
      // Terminal sessions are handled by the always-mounted section below
      if (getAgentSdk(inlineConnectionSessionId) === 'terminal') {
        return null
      }
      return <SessionView key={inlineConnectionSessionId} sessionId={inlineConnectionSessionId} />
    }

    // Worktree or connection selected but no session - show create session prompt
    if (!activeSessionId) {
      return (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center">
            <p className="text-lg font-medium">No active session</p>
            <p className="text-sm mt-2">Click the + button above to create a new session.</p>
          </div>
        </div>
      )
    }

    // Session is active - dispatch based on agent SDK
    // Terminal sessions are handled by the always-mounted section below
    if (getAgentSdk(activeSessionId) === 'terminal') {
      return null
    }
    return <SessionView key={activeSessionId} sessionId={activeSessionId} />
  }

  return (
    <main
      className="relative flex-1 flex flex-col min-w-0 bg-background overflow-hidden"
      data-testid="main-pane"
    >
      <PRNotificationStack />
      {!settingsOpen && workspaceView !== 'pull-requests' && (selectedWorktreeId || selectedConnectionId) && <SessionTabs />}
      <div className="flex-1 flex flex-col min-h-0">
        {renderContent()}
        {renderedTerminalSessionIds.map((sessionId) => {
          const isActive = !settingsOpen && visibleTerminalId === sessionId
          return (
            <div key={sessionId} className={isActive ? 'flex-1 flex flex-col min-h-0' : 'hidden'}>
              <SessionTerminalView sessionId={sessionId} isVisible={isActive} />
            </div>
          )
        })}
      </div>
      {!settingsOpen && terminalPosition === 'bottom' && <MainPaneTerminalPanel />}
    </main>
  )
}
