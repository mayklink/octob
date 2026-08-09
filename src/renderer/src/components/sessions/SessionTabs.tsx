import {
  memo,
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  type KeyboardEvent
} from 'react'
import {
  Plus,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  FileCode,
  FileText,
  GitCompareArrows,
  Loader2,
  AlertCircle,
  Check,
  TerminalSquare,
  FileJson,
  Server,
  Settings2
} from 'lucide-react'
import { useSessionStore } from '@/stores/useSessionStore'
import {
  useFileViewerStore,
  type FileViewerTab,
  type DiffTab,
  type ContextTab
} from '@/stores/useFileViewerStore'
import { useWorktreeStore } from '@/stores/useWorktreeStore'
import { useConnectionStore } from '@/stores/useConnectionStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useWorktreeStatusStore } from '@/stores/useWorktreeStatusStore'
import { useVimModeStore } from '@/stores/useVimModeStore'
import { useHintStore } from '@/stores/useHintStore'
import { cn, parseColorQuad } from '@/lib/utils'
import { ProviderIcon } from '@/components/ui/provider-icon'
import { toast } from '@/lib/toast'
import { assignSessionHints } from '@/lib/hint-utils'
import { HintBadge } from '@/components/ui/HintBadge'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { Tip } from '@/components/ui/Tip'
import { useTipStore } from '@/stores/useTipStore'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import type { AgentSdk } from '@/stores/useSettingsStore'
import { useTranslation } from 'react-i18next'

interface SessionTabProps {
  sessionId: string
  name: string
  isActive: boolean
  agentSdk: 'opencode' | 'claude-code' | 'codex' | 'mistral-vibe' | 'cursor-cli' | 'antigravity' | 'terminal'
  onClick: () => void
  onClose: (e: React.MouseEvent) => void
  onMiddleClick: (e: React.MouseEvent) => void
  onRename: (newName: string) => void
  onDragStart: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onDragEnd: () => void
  isDragging: boolean
  isDragOver: boolean
  worktreeId: string | null
  onCloseOthers?: () => void
  onCloseToRight?: () => void
  hintCode?: string
}

const SessionTab = memo(function SessionTab({
  sessionId,
  name,
  isActive,
  agentSdk,
  onClick,
  onClose,
  onMiddleClick,
  onRename,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isDragging,
  isDragOver,
  worktreeId: _worktreeId,
  onCloseOthers,
  onCloseToRight,
  hintCode
}: SessionTabProps): React.JSX.Element {
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState(name)
  const inputRef = useRef<HTMLInputElement>(null)

  const vimMode = useVimModeStore((s) => s.mode)
  const vimModeEnabled = useSettingsStore((s) => s.vimModeEnabled)
  const hintMode = useHintStore((s) => s.mode)
  const hintPendingChar = useHintStore((s) => s.pendingChar)
  const hintActionMode = useHintStore((s) => s.actionMode)

  const sessionStatus = useWorktreeStatusStore(
    (state) => state.sessionStatuses[sessionId]?.status ?? null
  )

  // Focus and select input text when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setEditName(name)
    setIsEditing(true)
  }

  const handleSave = () => {
    const trimmed = editName.trim()
    if (trimmed && trimmed !== name) {
      onRename(trimmed)
    }
    setIsEditing(false)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSave()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setEditName(name)
      setIsEditing(false)
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          data-testid={`session-tab-${sessionId}`}
          draggable={!isEditing}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onDragEnd={onDragEnd}
          onClick={isEditing ? undefined : onClick}
          onDoubleClick={handleDoubleClick}
          onMouseDown={(e) => {
            // Middle click to close
            if (e.button === 1) {
              onMiddleClick(e)
            }
          }}
          className={cn(
            'group relative flex items-center gap-1 px-3 py-1.5 text-sm cursor-pointer select-none',
            'border-r border-border transition-colors min-w-[100px] max-w-[200px]',
            isActive
              ? 'bg-background text-foreground'
              : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground',
            isDragging && 'opacity-50',
            isDragOver && 'bg-accent/50'
          )}
        >
          {agentSdk === 'terminal' ? (
            <TerminalSquare
              className="h-3 w-3 text-emerald-500 flex-shrink-0"
              data-testid={`tab-terminal-${sessionId}`}
            />
          ) : (
            <>
              {(sessionStatus === 'working' || sessionStatus === 'planning') && (
                <Loader2
                  className={cn(
                    'h-3 w-3 animate-spin flex-shrink-0',
                    sessionStatus === 'planning' ? 'text-blue-400' : 'text-blue-500'
                  )}
                  data-testid={`tab-spinner-${sessionId}`}
                />
              )}
              {(sessionStatus === 'answering' || sessionStatus === 'permission') && (
                <AlertCircle
                  className="h-3 w-3 text-amber-500 flex-shrink-0"
                  data-testid={`tab-${sessionStatus === 'permission' ? 'permission' : 'answering'}-${sessionId}`}
                />
              )}
              {sessionStatus === 'completed' && (
                <Check
                  className="h-3 w-3 text-green-500 flex-shrink-0"
                  data-testid={`tab-completed-${sessionId}`}
                />
              )}
              {sessionStatus === 'unread' && !isActive && (
                <span
                  className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0"
                  data-testid={`tab-unread-${sessionId}`}
                />
              )}
            </>
          )}
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={handleSave}
              onKeyDown={handleKeyDown}
              className="flex-1 min-w-0 bg-transparent border border-primary/50 rounded px-1 py-0 text-sm outline-none"
              data-testid={`rename-input-${sessionId}`}
            />
          ) : (
            <span className="truncate flex-1">{name || 'Untitled'}</span>
          )}
          {hintCode && vimModeEnabled && vimMode === 'normal' && (
            <HintBadge
              code={hintCode}
              mode={hintMode}
              pendingChar={hintPendingChar}
              actionMode={hintActionMode}
            />
          )}
          <button
            onClick={onClose}
            className={cn(
              'p-0.5 rounded hover:bg-accent transition-opacity',
              isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            )}
            data-testid={`close-tab-${sessionId}`}
          >
            <X className="h-3 w-3" />
          </button>
          {isActive && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={(e) => onClose(e as unknown as React.MouseEvent)}>
          Close
          <ContextMenuShortcut>&#8984;W</ContextMenuShortcut>
        </ContextMenuItem>
        {onCloseOthers && (
          <ContextMenuItem onSelect={onCloseOthers}>Close Others</ContextMenuItem>
        )}
        {onCloseToRight && (
          <ContextMenuItem onSelect={onCloseToRight}>Close Others to the Right</ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
})

interface FileTabProps {
  filePath: string
  name: string
  isActive: boolean
  onClick: () => void
  onClose: (e: React.MouseEvent) => void
  onCloseOthers: () => void
  onCloseToRight: () => void
  relativePath: string
}

function FileTab({
  filePath,
  name,
  isActive,
  onClick,
  onClose,
  onCloseOthers,
  onCloseToRight,
  relativePath
}: FileTabProps): React.JSX.Element {
  const isDirty = useFileViewerStore((s) => s.dirtyFiles.has(filePath))

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          data-testid={`file-tab-${name}`}
          onClick={onClick}
          onMouseDown={(e) => {
            if (e.button === 1) {
              e.preventDefault()
              onClose(e)
            }
          }}
          className={cn(
            'group relative flex items-center gap-1.5 px-3 py-1.5 text-sm cursor-pointer select-none',
            'border-r border-border transition-colors min-w-[100px] max-w-[200px]',
            isActive
              ? 'bg-background text-foreground'
              : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
          )}
          title={filePath}
        >
          <FileCode className="h-3.5 w-3.5 flex-shrink-0 text-blue-400" />
          <span className="truncate flex-1">{name}</span>
          {isDirty ? (
            <>
              <span
                className="w-2 h-2 rounded-full bg-current group-hover:hidden"
                data-testid={`dirty-indicator-${name}`}
              />
              <button
                onClick={onClose}
                className="hidden group-hover:block p-0.5 rounded hover:bg-accent"
                data-testid={`close-file-tab-${name}`}
              >
                <X className="h-3 w-3" />
              </button>
            </>
          ) : (
            <button
              onClick={onClose}
              className={cn(
                'p-0.5 rounded hover:bg-accent transition-opacity',
                isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              )}
              data-testid={`close-file-tab-${name}`}
            >
              <X className="h-3 w-3" />
            </button>
          )}
          {isActive && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={(e) => onClose(e as unknown as React.MouseEvent)}>
          Close
          <ContextMenuShortcut>&#8984;W</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={onCloseOthers}>Close Others</ContextMenuItem>
        <ContextMenuItem onSelect={onCloseToRight}>Close Others to the Right</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => copyToClipboard(relativePath)}>
          Copy Relative Path
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => copyToClipboard(filePath)}>
          Copy Absolute Path
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text)
  toast.success('Copied to clipboard')
}

interface DiffTabItemProps {
  tabKey: string
  tab: DiffTab
  isActive: boolean
  onActivate: () => void
  onClose: (e: React.MouseEvent) => void
  onCloseOthers: () => void
  onCloseToRight: () => void
}

function DiffTabItem({
  tabKey,
  tab,
  isActive,
  onActivate,
  onClose,
  onCloseOthers,
  onCloseToRight
}: DiffTabItemProps): React.JSX.Element {
  const absolutePath = `${tab.worktreePath}/${tab.filePath}`

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          data-testid={`diff-tab-${tab.fileName}`}
          onClick={onActivate}
          onMouseDown={(e) => {
            if (e.button === 1) {
              e.preventDefault()
              onClose(e)
            }
          }}
          className={cn(
            'group relative flex items-center gap-1.5 px-3 py-1.5 text-sm cursor-pointer select-none',
            'border-r border-border transition-colors min-w-[100px] max-w-[200px]',
            isActive
              ? 'bg-background text-foreground'
              : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
          )}
          title={`${tab.filePath} (${tab.staged ? 'staged' : 'unstaged'})`}
        >
          <GitCompareArrows className="h-3.5 w-3.5 flex-shrink-0 text-orange-400" />
          <span className="truncate flex-1">{tab.fileName}</span>
          {tab.staged && <span className="text-[10px] text-green-500 font-medium shrink-0">S</span>}
          <button
            onClick={onClose}
            className={cn(
              'p-0.5 rounded hover:bg-accent transition-opacity',
              isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            )}
            data-testid={`close-diff-tab-${tabKey}`}
          >
            <X className="h-3 w-3" />
          </button>
          {isActive && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={(e) => onClose(e as unknown as React.MouseEvent)}>
          Close
          <ContextMenuShortcut>&#8984;W</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={onCloseOthers}>Close Others</ContextMenuItem>
        <ContextMenuItem onSelect={onCloseToRight}>Close Others to the Right</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => copyToClipboard(tab.filePath)}>
          Copy Relative Path
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => copyToClipboard(absolutePath)}>
          Copy Absolute Path
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

// Sticky connection session tab — simplified and non-draggable
interface ConnectionSessionTabProps {
  sessionId: string
  name: string
  isActive: boolean
  onClick: () => void
  onClose: (event: React.MouseEvent) => void
  connectionColor: string | null
  connectionName: string
}

const ConnectionSessionTab = memo(function ConnectionSessionTab({
  sessionId,
  name,
  isActive,
  onClick,
  onClose,
  connectionColor,
  connectionName
}: ConnectionSessionTabProps): React.JSX.Element {
  const sessionStatus = useWorktreeStatusStore(
    (state) => state.sessionStatuses[sessionId]?.status ?? null
  )

  const [inactiveBg, activeBg, inactiveText, activeText] = parseColorQuad(connectionColor)

  return (
    <div
      data-testid={`connection-session-tab-${sessionId}`}
      role="tab"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onClick()
      }}
      title={`${connectionName} — ${name || 'Untitled'}`}
      className={cn(
        'group relative flex items-center gap-1.5 px-3 py-1.5 text-sm cursor-pointer select-none',
        'border-r border-border/50 transition-colors min-w-[100px] max-w-[200px]'
      )}
      style={{
        backgroundColor: isActive ? activeBg : inactiveBg,
        color: isActive ? activeText : inactiveText
      }}
    >
      {/* Status indicators */}
      {(sessionStatus === 'working' || sessionStatus === 'planning') && (
        <Loader2
          className="h-3 w-3 animate-spin flex-shrink-0"
          style={{ color: isActive ? activeText : undefined }}
        />
      )}
      {(sessionStatus === 'answering' || sessionStatus === 'permission') && (
        <AlertCircle
          className="h-3 w-3 flex-shrink-0"
          style={{ color: isActive ? activeText : undefined }}
        />
      )}
      {sessionStatus === 'completed' && (
        <Check
          className="h-3 w-3 flex-shrink-0"
          style={{ color: isActive ? activeText : undefined }}
        />
      )}
      {sessionStatus === 'unread' && !isActive && (
        <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
      )}

      <span className="truncate flex-1">{name || 'Untitled'}</span>
      <button
        type="button"
        onClick={onClose}
        className={cn(
          'p-0.5 rounded hover:bg-accent/60 transition-opacity',
          isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        )}
        title="Close tab"
        aria-label={`Close ${name || 'Untitled'}`}
        data-testid={`close-tab-${sessionId}`}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
})

export function SessionTabs(): React.JSX.Element | null {
  const { t } = useTranslation()
  const selectedWorktreeId = useWorktreeStore((state) => state.selectedWorktreeId)
  const selectedConnectionId = useConnectionStore((state) => state.selectedConnectionId)
  const connections = useConnectionStore((state) => state.connections)
  const sessionsByWorktree = useSessionStore((state) => state.sessionsByWorktree)
  const sessionsByConnection = useSessionStore((state) => state.sessionsByConnection)
  const tabOrderByWorktree = useSessionStore((state) => state.tabOrderByWorktree)
  const tabOrderByConnection = useSessionStore((state) => state.tabOrderByConnection)
  const activeSessionId = useSessionStore((state) => state.activeSessionId)
  const createSession = useSessionStore((state) => state.createSession)
  const createConnectionSession = useSessionStore((state) => state.createConnectionSession)
  const availableAgentSdks = useSettingsStore((state) => state.availableAgentSdks)
  const defaultAgentSdk = useSettingsStore((state) => state.defaultAgentSdk)
  const mcpServers = useSettingsStore((state) => state.mcpServers)
  const projectMcpServerIds = useSettingsStore((state) => state.projectMcpServerIds)
  const updateSetting = useSettingsStore((state) => state.updateSetting)
  const openSettings = useSettingsStore((state) => state.openSettings)
  const closeSession = useSessionStore((state) => state.closeSession)
  const setActiveSession = useSessionStore((state) => state.setActiveSession)
  const updateSessionName = useSessionStore((state) => state.updateSessionName)
  const closeOtherSessions = useSessionStore((state) => state.closeOtherSessions)
  const closeSessionsToRight = useSessionStore((state) => state.closeSessionsToRight)
  const closeOtherConnectionSessions = useSessionStore(
    (state) => state.closeOtherConnectionSessions
  )
  const closeConnectionSessionsToRight = useSessionStore(
    (state) => state.closeConnectionSessionsToRight
  )

  const openFiles = useFileViewerStore((state) => state.openFiles)
  const activeFilePath = useFileViewerStore((state) => state.activeFilePath)
  const activeDiff = useFileViewerStore((state) => state.activeDiff)
  const setActiveFile = useFileViewerStore((state) => state.setActiveFile)
  const requestCloseFile = useFileViewerStore((state) => state.requestCloseFile)
  const closeDiffTab = useFileViewerStore((state) => state.closeDiffTab)
  const activateDiffTab = useFileViewerStore((state) => state.activateDiffTab)
  const closeOtherFiles = useFileViewerStore((state) => state.closeOtherFiles)
  const closeFilesToRight = useFileViewerStore((state) => state.closeFilesToRight)
  const clearActiveViews = useFileViewerStore((state) => state.clearActiveViews)

  const selectedWorktree = useWorktreeStore((state) => {
    if (!selectedWorktreeId) return null
    for (const worktrees of state.worktreesByProject.values()) {
      const worktree = worktrees.find((item) => item.id === selectedWorktreeId)
      if (worktree) return worktree
    }
    return null
  })

  const isConnectionMode = Boolean(selectedConnectionId && !selectedWorktreeId)
  const sessions = isConnectionMode
    ? sessionsByConnection.get(selectedConnectionId!) ?? []
    : selectedWorktreeId
      ? sessionsByWorktree.get(selectedWorktreeId) ?? []
      : []
  const order = isConnectionMode
    ? tabOrderByConnection.get(selectedConnectionId!) ?? []
    : selectedWorktreeId
      ? tabOrderByWorktree.get(selectedWorktreeId) ?? []
      : []
  const sessionsById = new Map(sessions.map((session) => [session.id, session]))
  const orderedSessions = [
    ...order.map((id) => sessionsById.get(id)).filter((session) => session !== undefined),
    ...sessions.filter((session) => !order.includes(session.id))
  ]
  const connection = connections.find((item) => item.id === selectedConnectionId)
  const mcpProjectIds = selectedWorktree
    ? [selectedWorktree.project_id]
    : [...new Set((connection?.members ?? []).map((member) => member.project_id))]
  const hasOverlay = activeFilePath !== null || activeDiff !== null

  const activateSession = (sessionId: string): void => {
    clearActiveViews()
    setActiveSession(sessionId)
  }

  const handleCreateSession = async (sdk: AgentSdk): Promise<void> => {
    if (isConnectionMode && selectedConnectionId) {
      const result = await createConnectionSession(selectedConnectionId, sdk)
      if (!result.success) toast.error(result.error || 'Failed to create session')
    } else {
      if (!selectedWorktreeId || !selectedWorktree) return
      const result = await createSession(selectedWorktreeId, selectedWorktree.project_id, sdk)
      if (!result.success) toast.error(result.error || 'Failed to create session')
    }

    if (sdk !== 'terminal') {
      useTipStore.getState().markTipAsSeen('provider-right-click')
      if (sdk !== defaultAgentSdk) {
        useTipStore.getState().setNonDefaultProviderChosen(true)
      }
    }
  }

  const availableProviders: Array<{ sdk: AgentSdk; label: string }> = [
    ...(availableAgentSdks?.opencode ? [{ sdk: 'opencode' as const, label: 'OpenCode' }] : []),
    ...(availableAgentSdks?.claude ? [{ sdk: 'claude-code' as const, label: 'Claude Code' }] : []),
    ...(availableAgentSdks?.codex ? [{ sdk: 'codex' as const, label: 'Codex' }] : []),
    ...(availableAgentSdks?.mistralVibe ? [{ sdk: 'mistral-vibe' as const, label: 'Mistral Vibe' }] : []),
    ...(availableAgentSdks?.cursorCli ? [{ sdk: 'cursor-cli' as const, label: 'Cursor CLI' }] : []),
    ...(availableAgentSdks?.antigravity ? [{ sdk: 'antigravity' as const, label: 'Antigravity' }] : [])
  ]
  const availableMcpServers = mcpServers.filter((server) => server.enabled)
  const isMcpSelected = (serverId: string): boolean =>
    mcpProjectIds.length > 0 &&
    mcpProjectIds.every((projectId) => {
      const selected = projectMcpServerIds[projectId]
      return selected === undefined || selected.includes(serverId)
    })
  const enabledMcpCount = availableMcpServers.filter((server) => isMcpSelected(server.id)).length

  const setMcpSelected = (serverId: string, selected: boolean): void => {
    const next = { ...projectMcpServerIds }
    const inheritedIds = availableMcpServers.map((server) => server.id)

    for (const projectId of mcpProjectIds) {
      const current = new Set(next[projectId] ?? inheritedIds)
      if (selected) current.add(serverId)
      else current.delete(serverId)
      next[projectId] = [...current]
    }

    updateSetting('projectMcpServerIds', next)
  }

  if (!selectedWorktreeId && !selectedConnectionId && openFiles.size === 0) return null

  return (
    <div className="flex h-9 shrink-0 items-stretch border-b bg-muted/30" role="tablist">
      <Tip tipId="provider-right-click" enabled={availableProviders.length > 1}>
        <div className="shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center border-r text-muted-foreground hover:bg-accent hover:text-foreground"
                title="Create new session"
                aria-label="Create new session"
                data-testid="create-session"
              >
                <Plus className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {availableProviders.map(({ sdk, label }) => (
                <DropdownMenuItem key={sdk} onSelect={() => void handleCreateSession(sdk)}>
                  New {label} Session
                </DropdownMenuItem>
              ))}
              {availableProviders.length > 0 && <DropdownMenuSeparator />}
              <DropdownMenuItem onSelect={() => void handleCreateSession('terminal')}>
                <TerminalSquare className="mr-2 h-4 w-4 text-emerald-500" />
                New Terminal
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </Tip>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="relative flex h-9 w-9 shrink-0 items-center justify-center border-r text-muted-foreground hover:bg-accent hover:text-foreground"
            title={t('settings.mcp.sessionTools')}
            aria-label={t('settings.mcp.sessionTools')}
            data-testid="session-mcp-menu"
          >
            <Server className="h-4 w-4" />
            {enabledMcpCount > 0 && (
              <span className="absolute right-0.5 top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground">
                {enabledMcpCount}
              </span>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel>{t('settings.mcp.sessionTools')}</DropdownMenuLabel>
          <p className="px-2 pb-2 text-xs text-muted-foreground">
            {t('settings.mcp.sessionToolsHint')}
          </p>
          {availableMcpServers.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">
              {t('settings.mcp.noMcpServers')}
            </p>
          ) : (
            availableMcpServers.map((server) => (
              <DropdownMenuCheckboxItem
                key={server.id}
                checked={isMcpSelected(server.id)}
                disabled={mcpProjectIds.length === 0}
                onSelect={(event) => event.preventDefault()}
                onCheckedChange={(checked) => setMcpSelected(server.id, checked === true)}
              >
                <span className="truncate">{server.name.trim() || t('settings.mcp.unnamedServer')}</span>
              </DropdownMenuCheckboxItem>
            ))
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => openSettings('mcp')}>
            <Settings2 className="mr-2 h-4 w-4" />
            {t('settings.mcp.addAndManage')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="flex min-w-0 flex-1 overflow-x-auto">
        {orderedSessions.map((session, index) =>
          isConnectionMode && connection ? (
            <ConnectionSessionTab
              key={session.id}
              sessionId={session.id}
              name={session.name || `Session ${index + 1}`}
              isActive={!hasOverlay && activeSessionId === session.id}
              onClick={() => activateSession(session.id)}
              onClose={(event) => {
                event.stopPropagation()
                void closeSession(session.id)
              }}
              connectionColor={connection.color}
              connectionName={connection.custom_name || connection.name}
            />
          ) : (
            <SessionTab
              key={session.id}
              sessionId={session.id}
              name={session.name || `Session ${index + 1}`}
              agentSdk={session.agent_sdk || 'opencode'}
              isActive={!hasOverlay && activeSessionId === session.id}
              onClick={() => activateSession(session.id)}
              onClose={(event) => {
                event.stopPropagation()
                void closeSession(session.id)
              }}
              onMiddleClick={() => void closeSession(session.id)}
              onRename={(name) => void updateSessionName(session.id, name)}
              onDragStart={() => undefined}
              onDragOver={() => undefined}
              onDrop={() => undefined}
              onDragEnd={() => undefined}
              isDragging={false}
              isDragOver={false}
              worktreeId={selectedWorktreeId}
              onCloseOthers={() => {
                if (selectedWorktreeId) void closeOtherSessions(selectedWorktreeId, session.id)
                else if (selectedConnectionId) {
                  void closeOtherConnectionSessions(selectedConnectionId, session.id)
                }
              }}
              onCloseToRight={() => {
                if (selectedWorktreeId) void closeSessionsToRight(selectedWorktreeId, session.id)
                else if (selectedConnectionId) {
                  void closeConnectionSessionsToRight(selectedConnectionId, session.id)
                }
              }}
            />
          )
        )}

        {Array.from(openFiles.entries()).map(([key, tab], index, allTabs) => {
          if (tab.type === 'file') {
            const relativePath = selectedWorktree?.path && tab.path.startsWith(selectedWorktree.path)
              ? tab.path.slice(selectedWorktree.path.length + 1)
              : tab.path
            return (
              <FileTab
                key={key}
                filePath={tab.path}
                name={tab.name}
                relativePath={relativePath}
                isActive={activeFilePath === key}
                onClick={() => setActiveFile(key)}
                onClose={(event) => {
                  event.stopPropagation()
                  requestCloseFile(key)
                }}
                onCloseOthers={() => closeOtherFiles(key)}
                onCloseToRight={() => closeFilesToRight(key)}
              />
            )
          }
          if (tab.type === 'diff') {
            return (
              <DiffTabItem
                key={key}
                tabKey={key}
                tab={tab}
                isActive={activeFilePath === key}
                onActivate={() => activateDiffTab(key)}
                onClose={(event) => {
                  event.stopPropagation()
                  closeDiffTab(key)
                }}
                onCloseOthers={() => closeOtherFiles(key)}
                onCloseToRight={() => closeFilesToRight(key)}
              />
            )
          }
          return (
            <button
              key={key}
              type="button"
              onClick={() => useFileViewerStore.getState().activateContextEditor(tab.worktreeId)}
              className={cn(
                'flex min-w-[120px] max-w-[200px] items-center gap-1.5 border-r px-3 text-sm',
                activeFilePath === key ? 'bg-background' : 'text-muted-foreground hover:bg-muted'
              )}
            >
              <FileJson className="h-3.5 w-3.5" />
              <span className="truncate">Context</span>
              <span className="sr-only">{index + 1} of {allTabs.length}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
