import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import {
  Archive,
  ArrowRight,
  Bot,
  CheckSquare,
  ListChecks,
  Loader2,
  Pencil,
  Send,
  Sparkles,
  Trash2,
  X
} from 'lucide-react'
import { ModelSelector } from '@/components/sessions/ModelSelector'
import { AssistantCanvas } from '@/components/sessions/AssistantCanvas'
import { UserBubble } from '@/components/sessions/UserBubble'
import { QuestionPrompt } from '@/components/sessions/QuestionPrompt'
import { PermissionPrompt } from '@/components/sessions/PermissionPrompt'
import { CommandApprovalPrompt } from '@/components/sessions/CommandApprovalPrompt'
import { MarkdownRenderer } from '@/components/sessions/MarkdownRenderer'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Textarea } from '@/components/ui/textarea'
import { useSessionStream } from '@/hooks/useSessionStream'
import {
  BOARD_ACTION_BLOCK_RE,
  parseBoardTicketActionSet,
  type ParsedBoardTicketAction
} from '@/lib/board-assistant-actions'
import { parseBoardAssistantDraftSet } from '@/lib/board-assistant-drafts'
import { coerceOpenCodeRenderableString } from '@/lib/opencode-transcript'
import { toast } from '@/lib/toast'
import { useBoardChatStore, type BoardChatMessage, type BoardChatMode, type BoardChatScope, type TicketDraft, stripBoardAssistantScaffolding, stripBoardDraftBlocks, resolveBoardChatAgentSdk, resolveBoardChatDefaultModel } from '@/stores/useBoardChatStore'
import { useCommandApprovalStore } from '@/stores/useCommandApprovalStore'
import { useConnectionStore } from '@/stores/useConnectionStore'
import { useKanbanStore } from '@/stores/useKanbanStore'
import { usePermissionStore } from '@/stores/usePermissionStore'
import { useProjectStore } from '@/stores/useProjectStore'
import { useQuestionStore, type QuestionAnswer } from '@/stores/useQuestionStore'
import { useSessionStore, BOARD_TAB_ID } from '@/stores/useSessionStore'
import { useSettingsStore, type SelectedModel } from '@/stores/useSettingsStore'
import { useWorktreeStore } from '@/stores/useWorktreeStore'
import { useFileViewerStore } from '@/stores/useFileViewerStore'
import type { McpServerConfig } from '@shared/types/mcp'
import type { StreamingPart } from '@/components/sessions/SessionView'
import type { QuestionRequest } from '@/stores/useQuestionStore'
import type { CommandApprovalRequest } from '@/stores/useCommandApprovalStore'
import type { KanbanTicket, KanbanTicketColumn, KanbanTicketUpdate } from '../../../main/db/types'

interface BoardAssistantViewProps {
  projectId: string
}

const EMPTY_KANBAN_TICKETS: KanbanTicket[] = []

const BOARD_ASSISTANT_DEVELOPER_RULES = [
  'You are Octob Board Assistant.',
  'Help the user understand, refine, validate, diagram, and create local kanban tickets for the current board scope.',
  'You can discuss existing tickets, compare them with the repository code, identify missing detail, suggest implementation order, and propose new local tickets.',
  'When the user asks whether a task makes sense according to the code, inspect the repository from the current working directory before answering. Cite concrete files, modules, or commands you used when useful.',
  'Treat the board context as live product context: ticket IDs, columns, descriptions, modes, sessions, worktrees, and dependencies are meaningful.',
  'Do not claim tickets are created. The UI will create them only after explicit confirmation.',
  'You can propose changes to existing tickets, but you must never imply they were applied. The UI applies proposed changes only after explicit user approval.',
  'If the user wants to create tasks but the request is vague, ask concise clarifying questions until you have enough information.',
  'Once you have enough information, propose draft tasks instead of creating them directly.',
  'When you are ready to propose tickets, append exactly one fenced code block tagged board-ticket-drafts.',
  'For project boards, the JSON schema is {"drafts":[{"draftKey":"string","title":"string","description":"string|null","projectId":"string","dependsOn":["draftKey"],"warnings":["string"]}]}.',
  'For other board scopes, the JSON schema is {"drafts":[{"title":"string","description":"string|null","warnings":["string"]}]}.',
  'When revising drafts, output a full replacement draft set in that code block.',
  'When the user asks you to alter existing tasks, append exactly one fenced code block tagged board-ticket-actions.',
  'The action JSON schema is {"actions":[{"actionKey":"string","type":"create|update|move|archive","ticketId":"string|null","projectId":"string|null","title":"string","description":"string|null","column":"todo|in_progress|review|done","mode":"build|plan|super-plan|null","dependsOnTicketIds":["ticketId"],"reason":"string"}]}.',
  'For update actions, include only the fields that should change. For move actions, include ticketId and column. For archive actions, include ticketId. For create actions, include projectId, title, description, optional mode, and optional dependsOnTicketIds.',
  'Keep actionKey values unique and stable within the proposal. Explain the changes in normal text before the hidden JSON block.',
  'Keep titles short, specific, and implementation-ready.',
  'When the user asks for diagrams, prefer Mermaid when they want a text diagram in chat. Use fenced code blocks tagged mermaid.',
  'Mermaid diagrams must be valid, concise, and directly reflect the current board/code analysis.',
  'When the user asks for an editable visual diagram, Excalidraw, canvas, whiteboard, or sketch, use an enabled Excalidraw MCP server if one is configured and available to the selected agent.',
  'If Excalidraw MCP is not configured, help the user configure it via an octob-mcp-draft block and ask only for missing command/url/auth details.',
  'If the user asks to configure/cadastrar an MCP, assist conversationally using the selected CLI agent.',
  'For MCP setup, ask for all required information: provider, transport, authentication mode, tokens/env vars when needed, project scope when relevant, and safety options like read-only.',
  'Do not save MCP settings yourself and do not claim they are saved.',
  'When MCP information is complete, append exactly one fenced code block tagged octob-mcp-draft.',
  'The MCP block must contain strict JSON shaped like {"name":"string","enabled":true,"transport":"stdio|http|sse","command":"string","args":"string","env":[{"name":"KEY","value":"VALUE"}],"url":"string","headers":[{"name":"Header","value":"Value"}]}.',
  'For Supabase remote MCP, prefer https://mcp.supabase.com/mcp with read_only=true and project_ref when available.',
  'For Notion remote MCP, prefer https://mcp.notion.com/mcp with OAuth unless the user explicitly chooses token/manual mode.',
  'For Excalidraw MCP, do not invent package names, URLs, commands, or credentials. If the exact MCP server command or URL is unknown, ask the user for it or provide a draft with blank fields that the user can complete.'
].join('\n')

function buildScopeKey(scope: BoardChatScope | null): string {
  if (!scope) return 'none'
  if (scope.kind === 'project') return `project:${scope.projectId}`
  if (scope.kind === 'connection') return `connection:${scope.connectionId}`
  return 'pinned'
}

function sanitizeBoardMessageContent(message: BoardChatMessage): string {
  const withoutScaffolding = stripBoardAssistantScaffolding(message.content)
  if (message.role === 'assistant') {
    const withoutDrafts = stripBoardDraftBlocks(withoutScaffolding)
      .replace(BOARD_ACTION_BLOCK_RE, '')
      .replace(MCP_DRAFT_BLOCK_RE, '')
      .trim()
    const parsedDrafts = parseBoardAssistantDraftSet(message.content)
    const parsedActions = parseBoardTicketActionSet(message.content)
    const parsedMcpDraft = parseMcpDraftFromMessage(message)
    return (
      withoutDrafts ||
      (parsedDrafts ? 'Revisei as informações e preparei os rascunhos abaixo.' : '') ||
      (parsedActions ? 'Revisei as informações e preparei as alterações abaixo.' : '') ||
      (parsedMcpDraft ? 'Revisei as informações e preparei o rascunho de MCP abaixo.' : '')
    )
  }
  return withoutScaffolding
}

function sanitizeStreamingParts(parts: StreamingPart[] | undefined, role: BoardChatMessage['role']): StreamingPart[] | undefined {
  if (!parts?.length) return parts

  return parts.map((part) => {
    if (part.type !== 'text') return part
    const baseText = part.text ?? ''
    const nextText =
      role === 'assistant'
        ? stripBoardDraftBlocks(stripBoardAssistantScaffolding(baseText))
            .replace(BOARD_ACTION_BLOCK_RE, '')
            .replace(MCP_DRAFT_BLOCK_RE, '')
            .trim()
        : stripBoardAssistantScaffolding(baseText)
    return { ...part, text: nextText }
  })
}

function getStatusLabel(status: ReturnType<typeof useBoardChatStore.getState>['status']): string {
  switch (status) {
    case 'starting':
      return 'Iniciando'
    case 'thinking':
      return 'Pensando'
    case 'awaiting_confirmation':
      return 'Rascunhos prontos'
    case 'error':
      return 'Precisa de atenção'
    default:
      return 'Pronto'
  }
}

function getAgentSdkLabel(
  agentSdk: 'opencode' | 'claude-code' | 'codex' | 'mistral-vibe' | 'cursor-cli' | 'antigravity'
): string {
  switch (agentSdk) {
    case 'claude-code':
      return 'Claude Code'
    case 'codex':
      return 'Codex'
    case 'mistral-vibe':
      return 'Mistral Vibe'
    case 'cursor-cli':
      return 'Cursor CLI'
    case 'antigravity':
      return 'Google Antigravity'
    default:
      return 'OpenCode'
  }
}

function truncateDescription(description: string | null | undefined): string | null {
  if (!description) return null
  return description.length > 240 ? `${description.slice(0, 237)}...` : description
}

function summarizeConfiguredMcpServers(): Array<{
  name: string
  enabled: boolean
  transport: string
  hasCommand: boolean
  hasUrl: boolean
}> {
  return useSettingsStore.getState().mcpServers.map((server) => ({
    name: server.name,
    enabled: server.enabled,
    transport: server.transport,
    hasCommand: server.command.trim().length > 0,
    hasUrl: server.url.trim().length > 0
  }))
}

async function resolveProjectRuntime(projectId: string): Promise<{ worktreeId: string; path: string } | null> {
  const worktreeStore = useWorktreeStore.getState()
  const selectedWorktreeId = worktreeStore.selectedWorktreeId
  const projectWorktrees = worktreeStore.getWorktreesForProject(projectId)
  const selectedProjectWorktree = projectWorktrees.find((worktree) => worktree.id === selectedWorktreeId)
  const chosenWorktree =
    selectedProjectWorktree ??
    worktreeStore.getDefaultWorktree(projectId) ??
    projectWorktrees[0] ??
    null

  if (chosenWorktree?.path) {
    return { worktreeId: chosenWorktree.id, path: chosenWorktree.path }
  }

  const fallbackWorktrees = await window.db.worktree.getActiveByProject(projectId)
  const fallback = fallbackWorktrees.find((worktree) => worktree.is_default) ?? fallbackWorktrees[0] ?? null

  return fallback?.path ? { worktreeId: fallback.id, path: fallback.path } : null
}

function buildBoardPrompt(
  input: string,
  scope: BoardChatScope,
  targetProjectId: string,
  assistantMode: BoardChatMode
): string {
  const projectStore = useProjectStore.getState()
  const kanbanStore = useKanbanStore.getState()
  const targetProject = projectStore.projects.find((project) => project.id === targetProjectId)
  const allProjects = projectStore.projects.map((project) => ({
    id: project.id,
    name: project.name,
    path: project.path,
    description: project.description
  }))
  const scopedProjectIds =
    [targetProjectId]
  const allVisibleTickets = scopedProjectIds
    .flatMap((projectId) => kanbanStore.getTicketsForProject(projectId))
    .filter((ticket) => !ticket.archived_at)
  const visibleTickets = allVisibleTickets
    .map((ticket) => ({
      id: ticket.id,
      title: ticket.title,
      description: truncateDescription(ticket.description),
      column: ticket.column,
      mode: ticket.mode,
      planReady: ticket.plan_ready,
      worktreeId: ticket.worktree_id,
      currentSessionId: ticket.current_session_id,
      githubPrNumber: ticket.github_pr_number,
      githubPrUrl: ticket.github_pr_url
    }))
    .slice(0, 120)

  const visibleTicketIds = new Set(allVisibleTickets.map((ticket) => ticket.id))
  const dependencies = Array.from(kanbanStore.dependencyMap.entries())
    .filter(([dependentId]) => visibleTicketIds.has(dependentId))
    .flatMap(([dependentId, blockerIds]) =>
      Array.from(blockerIds)
        .filter((blockerId) => visibleTicketIds.has(blockerId))
        .map((blockerId) => ({
          dependentId,
          blockerId
        }))
    )

  const ticketCountsByColumn = allVisibleTickets.reduce<Record<string, number>>((acc, ticket) => {
    acc[ticket.column] = (acc[ticket.column] ?? 0) + 1
    return acc
  }, {})

  const context = {
    scope:
      scope.kind === 'project'
        ? { kind: 'project', projectName: scope.projectName }
        : scope.kind === 'connection'
          ? { kind: 'connection', connectionName: scope.connectionName }
          : { kind: 'pinned' },
    targetProject: targetProject
      ? {
          id: targetProject.id,
          name: targetProject.name,
          path: targetProject.path,
          description: targetProject.description
      }
      : { id: targetProjectId },
    availableProjects: allProjects,
    assistantMode,
    existingTickets: visibleTickets,
    ticketCountsByColumn,
    dependencies,
    configuredMcpServers: summarizeConfiguredMcpServers(),
    diagramCapabilities: {
      mermaid: 'Use fenced ```mermaid blocks for text diagrams in chat.',
      excalidrawMcp: 'Use an enabled Excalidraw MCP server when available; otherwise propose an octob-mcp-draft configuration.'
    }
  }

  return [
    '<board-assistant-rules>',
    BOARD_ASSISTANT_DEVELOPER_RULES,
    ...(scope.kind === 'project'
      ? [
          `Every proposed draft must use projectId=${targetProjectId}.`,
          'Every proposed draft must include a unique draftKey.',
          'Use dependsOn to reference other drafts by their draftKey when there is a dependency.'
        ]
      : []),
    '</board-assistant-rules>',
    '<board-assistant-context>',
    JSON.stringify(context, null, 2),
    '</board-assistant-context>',
    '',
    'User request:',
    input
  ].join('\n')
}

interface ParsedMcpDraftResult {
  messageId: string
  draft: McpServerConfig
}

const MCP_DRAFT_BLOCK_CAPTURE_RE = /```octob-mcp-draft\s*([\s\S]*?)```/i
const MCP_DRAFT_BLOCK_RE = /```octob-mcp-draft[\s\S]*?```/gi

function createId(): string {
  return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)
}

function formatMcpKeyValues(rows: McpServerConfig['env']): string {
  return rows.map((row) => `${row.name}=${row.value}`).join('\n')
}

function parseMcpKeyValues(value: string): McpServerConfig['env'] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const equalsIndex = line.indexOf('=')
      if (equalsIndex === -1) return { name: line, value: '' }
      return { name: line.slice(0, equalsIndex).trim(), value: line.slice(equalsIndex + 1) }
    })
    .filter((row) => row.name.length > 0)
}

async function saveMcpServerFromAssistant(server: McpServerConfig): Promise<string> {
  const settings = useSettingsStore.getState()
  const currentServers = settings.mcpServers
  const serverName = server.name.trim().toLowerCase()
  const serverUrl = server.url.trim().toLowerCase()
  const existingIndex = currentServers.findIndex((current) => {
    const currentName = current.name.trim().toLowerCase()
    const currentUrl = current.url.trim().toLowerCase()
    return currentName === serverName || (serverUrl.length > 0 && currentUrl === serverUrl)
  })

  if (existingIndex === -1) {
    await settings.updateSetting('mcpServers', [...currentServers, server])
    return `MCP do ${server.name} cadastrado e habilitado. Ele será enviado apenas para novas sessões/tarefas compatíveis.`
  }

  const nextServers = currentServers.map((current, index) =>
    index === existingIndex ? { ...server, id: current.id, enabled: true } : current
  )
  await settings.updateSetting('mcpServers', nextServers)
  return `MCP do ${server.name} atualizado e habilitado. Ele será enviado apenas para novas sessões/tarefas compatíveis.`
}

function normalizeMcpDraft(value: unknown): McpServerConfig | null {
  if (!value || typeof value !== 'object') return null
  const typed = value as Partial<McpServerConfig>
  const transport =
    typed.transport === 'stdio' || typed.transport === 'http' || typed.transport === 'sse'
      ? typed.transport
      : 'http'

  return {
    id: createId(),
    enabled: typed.enabled !== false,
    name: typeof typed.name === 'string' ? typed.name : '',
    transport,
    command: typeof typed.command === 'string' ? typed.command : '',
    args: typeof typed.args === 'string' ? typed.args : '',
    env: Array.isArray(typed.env) ? typed.env : [],
    url: typeof typed.url === 'string' ? typed.url : '',
    headers: Array.isArray(typed.headers) ? typed.headers : []
  }
}

function parseMcpDraftFromMessage(message: BoardChatMessage): ParsedMcpDraftResult | null {
  if (message.role !== 'assistant') return null
  const match = message.content.match(MCP_DRAFT_BLOCK_CAPTURE_RE)
  if (!match?.[1]) return null

  try {
    const parsed = JSON.parse(match[1]) as unknown
    const draft = normalizeMcpDraft(parsed)
    if (!draft) return null
    return { messageId: message.id, draft }
  } catch {
    return null
  }
}

async function ensureRuntimeSession(scope: BoardChatScope, targetProjectId: string): Promise<{
  sessionId: string
  opencodeSessionId: string
  runtimePath: string
} | null> {
  const currentState = useBoardChatStore.getState()
  if (currentState.sessionId && currentState.opencodeSessionId && currentState.runtimePath) {
    return {
      sessionId: currentState.sessionId,
      opencodeSessionId: currentState.opencodeSessionId,
      runtimePath: currentState.runtimePath
    }
  }

  const settings = useSettingsStore.getState()
  const agentSdk = currentState.selectedAgentSdkOverride ?? resolveBoardChatAgentSdk(settings.defaultAgentSdk)
  const selectedModel = currentState.selectedModelOverride ?? resolveBoardChatDefaultModel(settings, agentSdk)

  let runtimePath: string | null = null
  let worktreeId: string | null = null
  let connectionId: string | null = null

  if (scope.kind === 'project') {
    const runtime = await resolveProjectRuntime(scope.projectId)
    if (!runtime) return null
    runtimePath = runtime.path
    worktreeId = runtime.worktreeId
  } else if (scope.kind === 'connection') {
    const connection = useConnectionStore
      .getState()
      .connections.find((candidate) => candidate.id === scope.connectionId)
    if (!connection?.path) return null
    runtimePath = connection.path
    connectionId = connection.id
  } else {
    return null
  }

  // Reuse the session already created by the session store (from createBoardAssistantSession)
  // rather than creating a duplicate. Only create if none exists.
  const { useSessionStore } = await import('@/stores/useSessionStore')
  const existingStoreSession = useSessionStore.getState().boardAssistantByProject.get(targetProjectId)

  let session: { id: string }
  const isReused = Boolean(existingStoreSession)
  if (existingStoreSession) {
    session = existingStoreSession
    // Update the existing session with the model/SDK settings
    await window.db.session.update(session.id, {
      agent_sdk: agentSdk,
      ...(selectedModel
        ? {
            model_provider_id: selectedModel.providerID,
            model_id: selectedModel.modelID,
            model_variant: selectedModel.variant ?? null
          }
        : {})
    })
  } else {
    session = await window.db.session.create({
      worktree_id: worktreeId,
      connection_id: connectionId,
      project_id: targetProjectId,
      name: 'Board Assistant',
      session_type: 'board-assistant',
      agent_sdk: agentSdk,
      mode: 'build',
      ...(selectedModel
        ? {
            model_provider_id: selectedModel.providerID,
            model_id: selectedModel.modelID,
            model_variant: selectedModel.variant ?? null
          }
        : {})
    })
  }

  const connectResult = await window.opencodeOps.connect(runtimePath, session.id)
  if (!connectResult.success || !connectResult.sessionId) {
    // Only delete the session if we just created it. Reused sessions
    // should be kept so the user doesn't lose the record and messages.
    if (!isReused) {
      await window.db.session.delete(session.id).catch(() => {})
    }
    // Re-sync store so the stale entry is removed and the tab disappears
    const { useSessionStore } = await import('@/stores/useSessionStore')
    await useSessionStore.getState().loadBoardAssistantSession(targetProjectId)
    return null
  }

  await window.db.session.update(session.id, {
    opencode_session_id: connectResult.sessionId
  })

  useBoardChatStore.getState().setRuntimeSession({
    sessionId: session.id,
    opencodeSessionId: connectResult.sessionId,
    runtimePath
  })

  return {
    sessionId: session.id,
    opencodeSessionId: connectResult.sessionId,
    runtimePath
  }
}

async function cleanupBoardChatRuntime(): Promise<void> {
  const state = useBoardChatStore.getState()
  const sessionId = state.sessionId
  const opencodeSessionId = state.opencodeSessionId
  const runtimePath = state.runtimePath

  // If the store has already been reset (e.g. closeBoardAssistantSession
  // already cleaned up), skip runtime teardown but still reset the store
  // in case partial state remains.
  if (!sessionId && !opencodeSessionId && !runtimePath) {
    useBoardChatStore.getState().resetState()
    return
  }

  if (sessionId) {
    useQuestionStore.getState().clearSession(sessionId)
    usePermissionStore.getState().clearSession(sessionId)
    useCommandApprovalStore.getState().clearSession(sessionId)
  }

  if (runtimePath && opencodeSessionId) {
    try {
      await window.opencodeOps.abort(runtimePath, opencodeSessionId)
    } catch {
      // Best effort cleanup.
    }

    try {
      await window.opencodeOps.disconnect(runtimePath, opencodeSessionId)
    } catch {
      // Best effort cleanup.
    }
  }

  // Always reset the chat store after full cleanup so callers don't
  // need to remember to call resetState() separately.
  useBoardChatStore.getState().resetState()
}

function BoardChatHeader({
  scope,
  selectedTargetProjectId,
  status,
  selectedModel,
  agentSdk,
  availableAgentSdks,
  modelResetVisible,
  onSelectAgentSdk,
  onSelectModel,
  onResetModel,
  onSelectTargetProject,
  onClear,
  onClose
}: {
  scope: BoardChatScope
  selectedTargetProjectId: string | null
  status: ReturnType<typeof useBoardChatStore.getState>['status']
  selectedModel: SelectedModel | null
  agentSdk: 'opencode' | 'claude-code' | 'codex' | 'mistral-vibe' | 'cursor-cli' | 'antigravity'
  availableAgentSdks: Array<'opencode' | 'claude-code' | 'codex' | 'mistral-vibe' | 'cursor-cli' | 'antigravity'>
  modelResetVisible: boolean
  onSelectAgentSdk: (agentSdk: 'opencode' | 'claude-code' | 'codex' | 'mistral-vibe' | 'cursor-cli' | 'antigravity') => void
  onSelectModel: (model: SelectedModel) => void
  onResetModel: () => void
  onSelectTargetProject: (projectId: string) => void
  onClear: () => void
  onClose: () => void
}): React.JSX.Element {
  const selectedTargetProject =
    scope.kind === 'connection'
      ? scope.availableProjects.find((project) => project.id === selectedTargetProjectId)
      : null

  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/70 px-4 py-3">
      <div className="min-w-0 space-y-2">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/12 text-primary">
            <Bot className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              Board Assistant
            </p>
            <p className="text-xs text-muted-foreground">{getStatusLabel(status)}</p>
          </div>
        </div>

        {scope.kind === 'project' && (
          <div className="inline-flex rounded-full border border-border/70 bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground">
            {scope.projectName}
          </div>
        )}

        {scope.kind === 'connection' && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-full border border-border/70 bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground">
              {scope.connectionName}
            </div>
            <select
              value={selectedTargetProjectId ?? ''}
              onChange={(event) => onSelectTargetProject(event.target.value)}
              className="h-8 rounded-full border border-border/70 bg-background px-3 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
            >
              {scope.availableProjects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            {selectedTargetProject && (
              <span className="text-xs text-muted-foreground">
                Criando para {selectedTargetProject.name}
              </span>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1 rounded-full border border-border/70 bg-muted/40 px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-muted/70"
              >
                <span>{getAgentSdkLabel(agentSdk)}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-40">
              {availableAgentSdks.map((sdkOption) => (
                <DropdownMenuItem
                  key={sdkOption}
                  onClick={() => onSelectAgentSdk(sdkOption)}
                  className="cursor-pointer"
                >
                  {getAgentSdkLabel(sdkOption)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <ModelSelector
            value={selectedModel}
            onChange={onSelectModel}
            agentSdkOverride={agentSdk}
            disableTitleTooltip={true}
            hideProviderPrefix={true}
          />
          {modelResetVisible && (
            <button
              type="button"
              onClick={onResetModel}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Usar padrão
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1">
        <Button type="button" variant="ghost" size="icon" onClick={onClear} aria-label="Limpar chat">
          <Trash2 className="h-4 w-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Fechar assistente" title="Fechar assistente">
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

function BoardChatDraftProposalCard({
  draft,
  onToggle
}: {
  draft: TicketDraft
  onToggle: (draftId: string) => void
}): React.JSX.Element {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/80 p-3 shadow-sm">
      <div className="flex items-start gap-3">
        <Checkbox
          checked={draft.selected || Boolean(draft.createdAt)}
          onCheckedChange={() => onToggle(draft.id)}
          className="mt-1"
          disabled={Boolean(draft.createdAt)}
        />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-foreground">{draft.title}</p>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
              {draft.projectName}
            </span>
            {draft.createdAt && (
              <span className="rounded-full border border-border/70 bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                Criada
              </span>
            )}
          </div>
          {draft.description && (
            <div className="text-sm text-muted-foreground">
              <MarkdownRenderer content={draft.description} />
            </div>
          )}
          {draft.resolvedDependsOnTitles.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium uppercase tracking-[0.14em]">Depends on</span>
              {draft.resolvedDependsOnTitles.map((dependency) => (
                <span
                  key={`${draft.id}-${dependency}`}
                  className="rounded-full border border-border/70 bg-muted/30 px-2 py-0.5"
                >
                  {dependency}
                </span>
              ))}
            </div>
          )}
          {draft.warnings.length > 0 && (
            <div className="space-y-1 rounded-xl border border-border/70 bg-muted/30 px-3 py-2">
              {draft.warnings.map((warning) => (
                <p key={warning} className="text-xs text-muted-foreground">
                  {warning}
                </p>
              ))}
            </div>
          )}
          {draft.validationIssues.length > 0 && (
            <div className="space-y-1 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2">
              {draft.validationIssues.map((issue) => (
                <p key={issue} className="text-xs text-destructive">
                  {issue}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function getColumnLabel(column: KanbanTicketColumn | undefined): string {
  switch (column) {
    case 'todo':
      return 'To Do'
    case 'in_progress':
      return 'In Progress'
    case 'review':
      return 'Review'
    case 'done':
      return 'Done'
    default:
      return 'Sem coluna'
  }
}

function getActionIcon(type: ParsedBoardTicketAction['type']): React.JSX.Element {
  switch (type) {
    case 'create':
      return <Sparkles className="h-4 w-4" />
    case 'update':
      return <Pencil className="h-4 w-4" />
    case 'move':
      return <ArrowRight className="h-4 w-4" />
    case 'archive':
      return <Archive className="h-4 w-4" />
  }
}

function getActionLabel(action: ParsedBoardTicketAction): string {
  switch (action.type) {
    case 'create':
      return `Criar task "${action.title ?? 'sem titulo'}"`
    case 'update':
      return `Editar task ${action.ticketId ?? ''}`
    case 'move':
      return `Mover task ${action.ticketId ?? ''} para ${getColumnLabel(action.column)}`
    case 'archive':
      return `Arquivar task ${action.ticketId ?? ''}`
  }
}

function BoardTicketActionProposalCard({
  action,
  ticket,
  onToggle
}: {
  action: ParsedBoardTicketAction
  ticket: KanbanTicket | null
  onToggle: (actionId: string) => void
}): React.JSX.Element {
  const existingTitle = ticket?.title ?? action.ticketId ?? 'Nova task'

  return (
    <div className="rounded-2xl border border-border/70 bg-background/80 p-3 shadow-sm">
      <div className="flex items-start gap-3">
        <Checkbox
          checked={action.selected || Boolean(action.appliedAt)}
          onCheckedChange={() => onToggle(action.id)}
          className="mt-1"
          disabled={Boolean(action.appliedAt)}
        />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary">
              {getActionIcon(action.type)}
            </span>
            <p className="text-sm font-semibold text-foreground">{getActionLabel(action)}</p>
            {action.appliedAt && (
              <span className="rounded-full border border-border/70 bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                Aplicada
              </span>
            )}
          </div>

          {action.type !== 'create' && (
            <p className="text-xs text-muted-foreground">
              Atual: <span className="font-medium text-foreground">{existingTitle}</span>
            </p>
          )}

          {action.title !== undefined && (
            <p className="text-xs text-muted-foreground">
              Título: <span className="font-medium text-foreground">{action.title}</span>
            </p>
          )}
          {action.description !== undefined && (
            <div className="rounded-xl border border-border/70 bg-muted/25 px-3 py-2 text-sm text-muted-foreground">
              {action.description ? <MarkdownRenderer content={action.description} /> : 'Sem descrição'}
            </div>
          )}
          {action.mode !== undefined && (
            <p className="text-xs text-muted-foreground">
              Modo: <span className="font-medium text-foreground">{action.mode ?? 'limpar'}</span>
            </p>
          )}
          {action.dependsOnTicketIds.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Depende de: {action.dependsOnTicketIds.join(', ')}
            </p>
          )}
          {action.reason && (
            <p className="text-xs text-muted-foreground">{action.reason}</p>
          )}
          {action.validationIssues.length > 0 && (
            <div className="space-y-1 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2">
              {action.validationIssues.map((issue) => (
                <p key={issue} className="text-xs text-destructive">
                  {issue}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function BoardChatMessageList({
  messages,
  drafts,
  draftSourceMessageId,
  ticketActions,
  actionSourceMessageId,
  ticketsById,
  streamingMessage,
  activeQuestion,
  activePermission,
  activeApproval,
  sessionId,
  onToggleDraft,
  onToggleAction,
  onCreateAll,
  onCreateSelected,
  onApplyActions,
  onRevise,
  onCancelDrafts,
  onCancelActions,
  hasInvalidDrafts,
  hasInvalidActions,
  onQuestionReply,
  onQuestionReject,
  onPermissionReply,
  onCommandApprovalReply
}: {
  messages: BoardChatMessage[]
  drafts: TicketDraft[]
  draftSourceMessageId: string | null
  ticketActions: ParsedBoardTicketAction[]
  actionSourceMessageId: string | null
  ticketsById: Map<string, KanbanTicket>
  streamingMessage: BoardChatMessage | null
  activeQuestion: QuestionRequest | null
  activePermission: PermissionRequest | null
  activeApproval: CommandApprovalRequest | null
  sessionId: string | null
  onToggleDraft: (draftId: string) => void
  onToggleAction: (actionId: string) => void
  onCreateAll: () => void
  onCreateSelected: () => void
  onApplyActions: () => void
  onRevise: () => void
  onCancelDrafts: () => void
  onCancelActions: () => void
  hasInvalidDrafts: boolean
  hasInvalidActions: boolean
  onQuestionReply: (requestId: string, answers: QuestionAnswer[]) => void
  onQuestionReject: (requestId: string) => void
  onPermissionReply: (requestId: string, reply: 'once' | 'always' | 'reject', message?: string) => void
  onCommandApprovalReply: (
    requestId: string,
    approved: boolean,
    remember?: 'allow' | 'block',
    pattern?: string,
    patterns?: string[]
  ) => void
}): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const selectedCount = drafts.filter((draft) => draft.selected).length
  const creatableSelectedCount = drafts.filter((draft) => draft.selected && !draft.createdAt).length
  const selectedActionCount = ticketActions.filter((action) => action.selected).length
  const actionableSelectedCount = ticketActions.filter((action) => action.selected && !action.appliedAt).length
  const dependencyCount = drafts.reduce((count, draft) => count + draft.dependsOn.length, 0)
  const invalidDraftCount = drafts.filter((draft) => draft.validationIssues.length > 0).length
  const invalidActionCount = ticketActions.filter((action) => action.validationIssues.length > 0).length

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    element.scrollTop = element.scrollHeight
  }, [messages, drafts, draftSourceMessageId, ticketActions, actionSourceMessageId, streamingMessage, activeQuestion, activePermission, activeApproval])

  return (
    <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
      {messages.map((message) => {
        if (message.role === 'system') {
          return (
            <div
              key={message.id}
              className="rounded-2xl border border-border/70 bg-muted/35 px-3 py-2 text-xs text-muted-foreground"
            >
              {coerceOpenCodeRenderableString(message.content)}
            </div>
          )
        }

        const parsedDrafts = message.role === 'assistant' ? parseBoardAssistantDraftSet(message.content) : null
        const parsedActions = message.role === 'assistant' ? parseBoardTicketActionSet(message.content) : null
        const sanitizedContent = sanitizeBoardMessageContent(message)
        const sanitizedParts = sanitizeStreamingParts(message.parts, message.role)

        return (
          <div key={message.id} className="space-y-3">
            {message.role === 'user' ? (
              <UserBubble content={sanitizedContent} timestamp={message.timestamp} />
            ) : (
              <AssistantCanvas
                content={sanitizedContent}
                timestamp={message.timestamp}
                parts={sanitizedParts}
              />
            )}

            {message.id === draftSourceMessageId && drafts.length > 0 && parsedDrafts && (
              <div className="space-y-3 rounded-3xl border border-border/70 bg-muted/20 p-3">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  <Sparkles className="h-3.5 w-3.5" />
                  Rascunhos de tasks
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{drafts.length} rascunho{drafts.length === 1 ? '' : 's'}</span>
                  <span>{dependencyCount} dependência{dependencyCount === 1 ? '' : 's'}</span>
                  {invalidDraftCount > 0 && (
                    <span className="text-destructive">
                      {invalidDraftCount} inválido{invalidDraftCount === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
                <div className="space-y-2">
                  {drafts.map((draft) => (
                    <BoardChatDraftProposalCard key={draft.id} draft={draft} onToggle={onToggleDraft} />
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2 border-t border-border/70 pt-3">
                  <Button type="button" size="sm" onClick={onCreateAll} disabled={hasInvalidDrafts}>
                    Criar tasks
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={onCreateSelected}
                    disabled={hasInvalidDrafts || creatableSelectedCount === 0}
                  >
                    <CheckSquare className="h-4 w-4" />
                    Criar selecionadas
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={onRevise}>
                    Revisar com IA
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={onCancelDrafts}>
                    Cancelar
                  </Button>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {hasInvalidDrafts
                      ? 'Corrija os rascunhos inválidos primeiro'
                      : `${creatableSelectedCount}/${selectedCount} prontas para criar`}
                  </span>
                </div>
              </div>
            )}

            {message.id === actionSourceMessageId && ticketActions.length > 0 && parsedActions && (
              <div className="space-y-3 rounded-3xl border border-border/70 bg-muted/20 p-3">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  <ListChecks className="h-3.5 w-3.5" />
                  Alterações propostas
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{ticketActions.length} alteração{ticketActions.length === 1 ? '' : 'es'}</span>
                  {invalidActionCount > 0 && (
                    <span className="text-destructive">
                      {invalidActionCount} inválida{invalidActionCount === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
                <div className="space-y-2">
                  {ticketActions.map((action) => (
                    <BoardTicketActionProposalCard
                      key={action.id}
                      action={action}
                      ticket={action.ticketId ? ticketsById.get(action.ticketId) ?? null : null}
                      onToggle={onToggleAction}
                    />
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2 border-t border-border/70 pt-3">
                  <Button
                    type="button"
                    size="sm"
                    onClick={onApplyActions}
                    disabled={hasInvalidActions || actionableSelectedCount === 0}
                  >
                    Aplicar selecionadas
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={onRevise}>
                    Revisar com IA
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={onCancelActions}>
                    Cancelar
                  </Button>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {hasInvalidActions
                      ? 'Corrija as alterações inválidas primeiro'
                      : `${actionableSelectedCount}/${selectedActionCount} prontas para aplicar`}
                  </span>
                </div>
              </div>
            )}
          </div>
        )
      })}

      {streamingMessage && (
        <AssistantCanvas
          content={sanitizeBoardMessageContent(streamingMessage)}
          timestamp={streamingMessage.timestamp}
          parts={sanitizeStreamingParts(streamingMessage.parts, streamingMessage.role)}
          isStreaming={true}
        />
      )}

      {activePermission && (
        <PermissionPrompt request={activePermission} onReply={onPermissionReply} />
      )}

      {activeApproval && (
        <CommandApprovalPrompt
          request={activeApproval}
          sessionId={sessionId ?? undefined}
          onReply={onCommandApprovalReply}
        />
      )}

      {activeQuestion && (
        <QuestionPrompt
          request={activeQuestion}
          onReply={onQuestionReply}
          onReject={onQuestionReject}
        />
      )}
    </div>
  )
}

function McpDraftCard({
  draft,
  onChange,
  onSave,
  onCancel
}: {
  draft: McpServerConfig
  onChange: (draft: McpServerConfig) => void
  onSave: () => void
  onCancel: () => void
}): React.JSX.Element {
  return (
    <div className="border-t border-border/70 bg-muted/20 px-4 py-3">
      <div className="space-y-3 rounded-2xl border border-border/70 bg-background/80 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Rascunho de MCP</p>
            <p className="text-xs text-muted-foreground">
              Revise antes de gravar. Ele só será usado por sessões/tarefas se estiver habilitado.
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox
              checked={draft.enabled}
              onCheckedChange={(checked) => onChange({ ...draft, enabled: checked })}
            />
            Habilitado
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-xs font-medium text-muted-foreground">
            Nome
            <input
              value={draft.name}
              onChange={(event) => onChange({ ...draft, name: event.target.value })}
              className="h-8 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground"
            />
          </label>
          <label className="space-y-1 text-xs font-medium text-muted-foreground">
            Transporte
            <select
              value={draft.transport}
              onChange={(event) =>
                onChange({ ...draft, transport: event.target.value as McpServerConfig['transport'] })
              }
              className="h-8 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground"
            >
              <option value="http">HTTP</option>
              <option value="sse">SSE</option>
              <option value="stdio">stdio</option>
            </select>
          </label>
        </div>

        {draft.transport === 'stdio' ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs font-medium text-muted-foreground">
                Comando
                <input
                  value={draft.command}
                  onChange={(event) => onChange({ ...draft, command: event.target.value })}
                  className="h-8 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground"
                />
              </label>
              <label className="space-y-1 text-xs font-medium text-muted-foreground">
                Argumentos
                <input
                  value={draft.args}
                  onChange={(event) => onChange({ ...draft, args: event.target.value })}
                  className="h-8 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground"
                />
              </label>
            </div>
            <label className="space-y-1 text-xs font-medium text-muted-foreground">
              Variáveis
              <Textarea
                value={formatMcpKeyValues(draft.env)}
                onChange={(event) => onChange({ ...draft, env: parseMcpKeyValues(event.target.value) })}
                className="min-h-[68px] font-mono text-xs"
              />
            </label>
          </div>
        ) : (
          <label className="space-y-1 text-xs font-medium text-muted-foreground">
            URL
            <input
              value={draft.url}
              onChange={(event) => onChange({ ...draft, url: event.target.value })}
              className="h-8 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground"
            />
          </label>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="button" size="sm" onClick={onSave}>
            Gravar MCP
          </Button>
        </div>
      </div>
    </div>
  )
}

function BoardChatComposer({
  value,
  disabled,
  sending,
  canSend,
  textareaRef,
  onChange,
  onSend
}: {
  value: string
  disabled: boolean
  sending: boolean
  canSend: boolean
  textareaRef: RefObject<HTMLTextAreaElement | null>
  onChange: (value: string) => void
  onSend: () => void
}): React.JSX.Element {
  return (
    <div className="border-t border-border/70 px-4 py-3">
      <div className="rounded-3xl border border-border/70 bg-muted/20 p-2 shadow-sm">
        <Textarea
          ref={textareaRef}
          value={value}
          disabled={disabled}
          placeholder={
            disabled
              ? 'Selecione um projeto de destino para começar.'
              : 'Can create local tickets. Ask for breakdowns, revisions, or smaller tasks.'
          }
          className="min-h-[84px] resize-none border-0 bg-transparent p-2 shadow-none focus-visible:ring-0"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              onSend()
            }
          }}
        />
        <div className="flex items-center justify-between gap-3 px-2 pb-1">
          <span className="text-xs text-muted-foreground">Enter to send. Shift+Enter for a new line.</span>
          <Button type="button" size="sm" onClick={onSend} disabled={!canSend}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send
          </Button>
        </div>
      </div>
    </div>
  )
}

export function BoardAssistantView({ projectId }: BoardAssistantViewProps): React.JSX.Element | null {
  const projects = useProjectStore((state) => state.projects)
  const project = projects.find((p) => p.id === projectId)
  const worktree = useWorktreeStore((state) => {
    // find default worktree for project to get path
    for (const worktrees of state.worktreesByProject.values()) {
      const found = worktrees.find((w) => w.project_id === projectId && w.status === 'active')
      if (found) return found
    }
    return null
  })

  const scope = useMemo<BoardChatScope | null>(() => {
    if (!project) return null
    return {
      kind: 'project' as const,
      projectId: project.id,
      projectName: project.name,
      projectPath: worktree?.path ?? project.path
    }
  }, [project, worktree])

  const storedScope = useBoardChatStore((state) => state.scope)
  const messages = useBoardChatStore((state) => state.messages)
  const drafts = useBoardChatStore((state) => state.drafts)
  const draftSourceMessageId = useBoardChatStore((state) => state.draftSourceMessageId)
  const status = useBoardChatStore((state) => state.status)
  const selectedTargetProjectId = useBoardChatStore((state) => state.selectedTargetProjectId)
  const error = useBoardChatStore((state) => state.error)
  const sessionId = useBoardChatStore((state) => state.sessionId)
  const opencodeSessionId = useBoardChatStore((state) => state.opencodeSessionId)
  const runtimePath = useBoardChatStore((state) => state.runtimePath)
  const assistantMode = useBoardChatStore((state) => state.assistantMode)
  const selectedAgentSdkOverride = useBoardChatStore((state) => state.selectedAgentSdkOverride)
  const selectedModelOverride = useBoardChatStore((state) => state.selectedModelOverride)
  const composerValue = useBoardChatStore((state) => state.composerValue)

  const setTranscriptMessages = useBoardChatStore((state) => state.setTranscriptMessages)
  const addLocalUserMessage = useBoardChatStore((state) => state.addLocalUserMessage)
  const addLocalSystemMessage = useBoardChatStore((state) => state.addLocalSystemMessage)
  const setDrafts = useBoardChatStore((state) => state.setDrafts)
  const clearDrafts = useBoardChatStore((state) => state.clearDrafts)
  const markDraftsCreated = useBoardChatStore((state) => state.markDraftsCreated)
  const toggleDraftSelected = useBoardChatStore((state) => state.toggleDraftSelected)
  const setStatus = useBoardChatStore((state) => state.setStatus)
  const setSelectedTargetProjectId = useBoardChatStore((state) => state.setSelectedTargetProjectId)
  const setSelectedAgentSdkOverride = useBoardChatStore((state) => state.setSelectedAgentSdkOverride)
  const setSelectedModelOverride = useBoardChatStore((state) => state.setSelectedModelOverride)
  const setError = useBoardChatStore((state) => state.setError)
  const updateOpencodeSessionId = useBoardChatStore((state) => state.updateOpencodeSessionId)
  const setComposerValue = useBoardChatStore((state) => state.setComposerValue)
  const resetState = useBoardChatStore((state) => state.resetState)
  const activateScope = useBoardChatStore((state) => state.activateScope)

  const composerFocusRef = useRef<HTMLTextAreaElement | null>(null)
  const [mcpDraft, setMcpDraft] = useState<McpServerConfig | null>(null)
  const [ticketActions, setTicketActions] = useState<ParsedBoardTicketAction[]>([])
  const [actionSourceMessageId, setActionSourceMessageId] = useState<string | null>(null)
  const availableAgentSdks = useSettingsStore((state) => state.availableAgentSdks)
  const defaultBoardAgentSdk = useSettingsStore((state) => resolveBoardChatAgentSdk(state.defaultAgentSdk))
  const effectiveAgentSdk = selectedAgentSdkOverride ?? defaultBoardAgentSdk
  const resolvedDefaultModel = useSettingsStore((state) => resolveBoardChatDefaultModel(state, effectiveAgentSdk))
  const effectiveSelectedModel = selectedModelOverride ?? resolvedDefaultModel
  const agentSdkOptions = useMemo(() => {
    const options: Array<'opencode' | 'claude-code' | 'codex' | 'mistral-vibe' | 'cursor-cli' | 'antigravity'> = []
    if (!availableAgentSdks) return [effectiveAgentSdk]
    if (availableAgentSdks.opencode) options.push('opencode')
    if (availableAgentSdks.claude) options.push('claude-code')
    if (availableAgentSdks.codex) options.push('codex')
    if (availableAgentSdks.mistralVibe) options.push('mistral-vibe')
    if (availableAgentSdks.cursorCli) options.push('cursor-cli')
    if (availableAgentSdks.antigravity) options.push('antigravity')
    return options.length > 0 ? options : [effectiveAgentSdk]
  }, [availableAgentSdks, effectiveAgentSdk])
  const handleMaterializedSessionId = useCallback((nextOpencodeSessionId: string) => {
    updateOpencodeSessionId(nextOpencodeSessionId)
    if (sessionId) {
      void window.db.session.update(sessionId, {
        opencode_session_id: nextOpencodeSessionId
      }).catch(() => {})
    }
  }, [sessionId, updateOpencodeSessionId])

  useEffect(() => {
    let cancelled = false

    const syncScope = async (): Promise<void> => {
      const scopeKey = buildScopeKey(scope)
      const previousScopeKey = buildScopeKey(useBoardChatStore.getState().scope)
      const shouldAnnounceScope = previousScopeKey !== scopeKey && scope && scope.kind !== 'pinned'

      activateScope(scope, {
        preserveOpen: true,
        scope,
        assistantMode: useBoardChatStore.getState().assistantMode,
        selectedTargetProjectId:
          scope?.kind === 'project'
            ? scope.projectId
            : scope?.kind === 'connection'
              ? scope.availableProjects[0]?.id ?? null
              : null
      })

      if (cancelled) return

      const state = useBoardChatStore.getState()
      if (state.sessionId && state.opencodeSessionId && state.runtimePath && scopeKey !== 'none') {
        try {
          await window.opencodeOps.reconnect(
            state.runtimePath,
            state.opencodeSessionId,
            state.sessionId
          )
        } catch {
          // useSessionStream will handle reconnection failures
        }
      }

      if (shouldAnnounceScope) {
        addLocalSystemMessage(
          scope.kind === 'project'
            ? `Assistant scope set to ${scope.projectName}.`
            : scope.kind === 'connection'
              ? `Assistant scope set to ${scope.connectionName}.`
              : 'Assistant scope set to pinned projects.'
        )
      }
    }

    void syncScope()

    return () => {
      cancelled = true
    }
  }, [activateScope, addLocalSystemMessage, scope])

  // NOTE: We intentionally do NOT clean up the runtime on unmount.
  // The board assistant is a persistent tab — the runtime and chat state
  // must survive across tab switches, just like normal sessions.
  // Runtime cleanup happens only when:
  // - The user explicitly closes the board assistant tab (closeBoardAssistantSession)
  // - The scope changes to a different project (scope sync above)
  // - The user clicks "Clear" (handleClear)

  const { messages: transcriptMessages, streamingParts, streamingContent, isStreaming } = useSessionStream({
    sessionId: sessionId ?? '',
    worktreePath: runtimePath ?? '',
    opencodeSessionId: opencodeSessionId ?? '',
    enabled: Boolean(sessionId && opencodeSessionId && runtimePath),
    onMaterializedSessionId: handleMaterializedSessionId
  })

  useEffect(() => {
    if (!sessionId || !opencodeSessionId || !runtimePath) return
    // useSessionStream starts with an empty array before getMessages() loads.
    // Syncing that empty array would wipe all existing transcript messages from
    // the store (mergeTranscriptMessages only keeps 'local'-kind messages when
    // the transcript array is empty). Skip the sync until real data arrives.
    if (transcriptMessages.length === 0 && useBoardChatStore.getState().messages.length > 0) return
    setTranscriptMessages(transcriptMessages)
  }, [opencodeSessionId, runtimePath, sessionId, setTranscriptMessages, transcriptMessages])

  const latestDraftResult = useMemo(() => {
    const strictProjectId = scope?.kind === 'project' ? scope.projectId : undefined
    const fallbackProjectId =
      scope?.kind === 'project'
        ? scope.projectId
        : selectedTargetProjectId

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]
      if (message.role !== 'assistant') continue
      const parsed = parseBoardAssistantDraftSet(message.content, {
        fallbackProjectId,
        strictProjectId,
        requireExplicitDraftKeys: scope?.kind === 'project'
      })
      if (parsed) {
        return {
          messageId: message.id,
          drafts: parsed.drafts
        }
      }
    }
    return null
  }, [messages, scope, selectedTargetProjectId])

  const latestMcpDraftResult = useMemo(() => {
    for (const message of [...messages].reverse()) {
      const parsed = parseMcpDraftFromMessage(message)
      if (parsed) return parsed
    }
    return null
  }, [messages])

  const latestActionResult = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]
      if (message.role !== 'assistant') continue
      const parsed = parseBoardTicketActionSet(message.content)
      if (parsed) {
        return {
          messageId: message.id,
          actions: parsed.actions
        }
      }
    }
    return null
  }, [messages])

  useEffect(() => {
    if (!latestDraftResult || !scope) return
    if (draftSourceMessageId === latestDraftResult.messageId) return

    const targetProjectId =
      scope.kind === 'project'
        ? scope.projectId
        : scope.kind === 'connection'
          ? selectedTargetProjectId
          : null

    if (!targetProjectId) return

    const titleByDraftKey = new Map(
      latestDraftResult.drafts.map((draft) => [draft.draftKey, draft.title])
    )

    setDrafts(
      latestDraftResult.drafts.map((draft) => ({
        id: `${latestDraftResult.messageId}:${draft.draftKey}:${scope.kind === 'project' ? targetProjectId : (draft.projectId || targetProjectId)}`,
        draftKey: draft.draftKey,
        title: draft.title,
        description: draft.description,
        dependsOn: draft.dependsOn,
        resolvedDependsOnTitles: draft.dependsOn.map(
          (dependency) => titleByDraftKey.get(dependency) ?? dependency
        ),
        warnings: draft.warnings,
        validationIssues: draft.validationIssues,
        projectId: scope.kind === 'project' ? targetProjectId : (draft.projectId || targetProjectId),
        projectName:
          projects.find((project) =>
            project.id === (scope.kind === 'project' ? targetProjectId : (draft.projectId || targetProjectId))
          )?.name ??
          'Unknown project',
        selected: true,
        createdAt: null
      })),
      latestDraftResult.messageId
    )
  }, [draftSourceMessageId, latestDraftResult, projects, scope, selectedTargetProjectId, setDrafts])

  useEffect(() => {
    if (!latestActionResult) return
    if (actionSourceMessageId === latestActionResult.messageId) return

    setTicketActions(latestActionResult.actions)
    setActionSourceMessageId(latestActionResult.messageId)
  }, [actionSourceMessageId, latestActionResult])

  useEffect(() => {
    if (!latestMcpDraftResult) return
    setMcpDraft(latestMcpDraftResult.draft)
  }, [latestMcpDraftResult])

  useEffect(() => {
    if (error) {
      setStatus('error')
      return
    }

    if (isStreaming) {
      setStatus('thinking')
      return
    }

    if (drafts.length > 0 || ticketActions.length > 0) {
      setStatus('awaiting_confirmation')
      return
    }

    setStatus('idle')
  }, [drafts.length, error, isStreaming, setStatus, ticketActions.length])

  const activeQuestion = useQuestionStore((state) =>
    sessionId ? state.getActiveQuestion(sessionId) : null
  )
  const activePermission = usePermissionStore((state) =>
    sessionId ? state.getActivePermission(sessionId) : null
  )
  const activeApproval = useCommandApprovalStore((state) =>
    sessionId ? state.getActiveApproval(sessionId) : null
  )

  const streamingMessage = useMemo<BoardChatMessage | null>(() => {
    if (!isStreaming && streamingParts.length === 0 && !streamingContent) return null
    return {
      id: 'board-chat-streaming',
      role: 'assistant',
      content: streamingContent,
      timestamp: new Date().toISOString(),
      parts: streamingParts,
      kind: 'local'
    }
  }, [isStreaming, streamingContent, streamingParts])

  const canInteract = scope !== null && scope.kind !== 'pinned'
  const hasInvalidDrafts = drafts.some((draft) => draft.validationIssues.length > 0)
  const targetProjectTickets = useKanbanStore((state) =>
    selectedTargetProjectId
      ? state.tickets.get(selectedTargetProjectId) ?? EMPTY_KANBAN_TICKETS
      : EMPTY_KANBAN_TICKETS
  )
  const ticketsById = useMemo(() => {
    const map = new Map<string, KanbanTicket>()
    for (const ticket of targetProjectTickets) {
      map.set(ticket.id, ticket)
    }
    return map
  }, [targetProjectTickets])
  const hasInvalidActions = ticketActions.some((action) => action.validationIssues.length > 0)
  const canSend =
    canInteract &&
    Boolean((scope?.kind === 'project' ? scope.projectId : selectedTargetProjectId) && composerValue.trim()) &&
    status !== 'starting' &&
    status !== 'thinking'

  const navigateToBoard = useCallback(() => {
    useFileViewerStore.getState().clearActiveViews()

    const sessionStore = useSessionStore.getState()
    sessionStore.setActivePinnedSession(null)
    sessionStore.clearBoardAssistantFocus()

    if (useSettingsStore.getState().boardMode === 'sticky-tab') {
      sessionStore.setActiveSession(BOARD_TAB_ID)
      return
    }

    const kanbanStore = useKanbanStore.getState()
    if (!kanbanStore.isBoardViewActive) {
      kanbanStore.toggleBoardView()
    }
  }, [])

  const handleDiscardConversation = useCallback(
    async (options?: {
      preserveOpen?: boolean
      nextAssistantMode?: BoardChatMode
      nextTargetProjectId?: string | null
      nextSelectedAgentSdkOverride?: 'opencode' | 'claude-code' | 'codex' | 'mistral-vibe' | 'cursor-cli' | 'antigravity' | null
      nextSelectedModelOverride?: SelectedModel | null
    }) => {
      const stateBeforeCleanup = useBoardChatStore.getState()
      const activeScope = stateBeforeCleanup.scope
      const nextAssistantMode = options?.nextAssistantMode ?? stateBeforeCleanup.assistantMode
      await cleanupBoardChatRuntime()

      resetState({
        preserveOpen: options?.preserveOpen ?? false,
        scope: activeScope,
        assistantMode: nextAssistantMode,
        selectedTargetProjectId:
          options?.nextTargetProjectId ??
          (activeScope?.kind === 'project'
            ? activeScope.projectId
            : activeScope?.kind === 'connection'
              ? activeScope.availableProjects[0]?.id ?? null
              : null),
        selectedAgentSdkOverride:
          options?.nextSelectedAgentSdkOverride ??
          useBoardChatStore.getState().selectedAgentSdkOverride,
        selectedModelOverride:
          options?.nextSelectedModelOverride ??
          useBoardChatStore.getState().selectedModelOverride
      })
    },
    [resetState]
  )

  const handleSend = useCallback(async () => {
    if (!scope || scope.kind === 'pinned') return

    const input = composerValue.trim()
    if (!input) return

    const targetProjectId =
      scope.kind === 'project' ? scope.projectId : selectedTargetProjectId

    if (!targetProjectId) {
      setError('Selecione um projeto de destino antes de iniciar o assistente.')
      addLocalSystemMessage('Selecione um projeto de destino antes de iniciar o assistente.')
      return
    }

    try {
      setError(null)
      addLocalUserMessage(input)
      setComposerValue('')

      setStatus(sessionId ? 'thinking' : 'starting')
      const runtime = await ensureRuntimeSession(scope, targetProjectId)
      if (!runtime) {
        throw new Error('Não foi possível iniciar o assistente para este quadro.')
      }

      const prompt = buildBoardPrompt(input, scope, targetProjectId, assistantMode)
      const result = await window.opencodeOps.prompt(runtime.runtimePath, runtime.opencodeSessionId, prompt)
      if (!result.success) {
        throw new Error(result.error || 'The assistant could not send your message.')
      }
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : 'Falha ao enviar mensagem para o assistente.'
      setError(message)
      setStatus('error')
      addLocalSystemMessage(message)
      toast.error(message)
    }
  }, [addLocalSystemMessage, addLocalUserMessage, assistantMode, composerValue, scope, selectedTargetProjectId, sessionId, setComposerValue, setError, setStatus])

  const handleSaveMcpDraft = useCallback(async () => {
    if (!mcpDraft) return
    try {
      const message = await saveMcpServerFromAssistant(mcpDraft)
      setMcpDraft(null)
      addLocalSystemMessage(message)
      toast.success('MCP gravado.')
    } catch {
      toast.error('Falha ao gravar MCP.')
    }
  }, [addLocalSystemMessage, mcpDraft])

  const handleCreateDrafts = useCallback(async (onlySelected: boolean) => {
    const draftsToCreate = drafts.filter(
      (draft) => !draft.createdAt && (!onlySelected || draft.selected)
    )
    if (draftsToCreate.length === 0) {
      return
    }

    try {
      const invalidDrafts = draftsToCreate.filter((draft) => draft.validationIssues.length > 0)
      if (invalidDrafts.length > 0) {
        throw new Error('Corrija os rascunhos inválidos antes de criar as tasks.')
      }

      const draftKeysInBatch = new Set(draftsToCreate.map((draft) => draft.draftKey))
      const result = await window.kanban.ticket.createBatch({
        drafts: draftsToCreate.map((draft) => ({
          draft_key: draft.draftKey,
          project_id: draft.projectId,
          title: draft.title,
          description: draft.description,
          column: 'todo',
          depends_on: draft.dependsOn.filter((key) => draftKeysInBatch.has(key))
        }))
      })

      await useKanbanStore.getState().loadTickets(draftsToCreate[0].projectId)
      await useKanbanStore.getState().loadDependencies(draftsToCreate[0].projectId)

      markDraftsCreated(draftsToCreate.map((draft) => draft.id))
      addLocalSystemMessage(
        `Criei ${result.tickets.length} task${result.tickets.length === 1 ? '' : 's'} e ${result.dependencies.length} dependência${result.dependencies.length === 1 ? '' : 's'} em ${draftsToCreate[0].projectName}.`
      )
      navigateToBoard()
      toast.success(
        `Criei ${result.tickets.length} task${result.tickets.length === 1 ? '' : 's'}.`
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao criar uma ou mais tasks.'
      toast.error(message)
    }
  }, [addLocalSystemMessage, drafts, markDraftsCreated, navigateToBoard])

  const handleToggleAction = useCallback((actionId: string) => {
    setTicketActions((current) =>
      current.map((action) =>
        action.id === actionId && !action.appliedAt
          ? { ...action, selected: !action.selected }
          : action
      )
    )
  }, [])

  const handleApplyTicketActions = useCallback(async () => {
    const selectedActions = ticketActions.filter((action) => action.selected && !action.appliedAt)
    if (selectedActions.length === 0) return

    try {
      const invalidActions = selectedActions.filter((action) => action.validationIssues.length > 0)
      if (invalidActions.length > 0) {
        throw new Error('Corrija as alterações inválidas antes de aplicar.')
      }

      const kanban = useKanbanStore.getState()
      const createdTicketsByActionKey = new Map<string, KanbanTicket>()

      for (const action of selectedActions) {
        if (action.type === 'create') {
          if (!action.projectId || !action.title) {
            throw new Error('Uma ação de criação está incompleta.')
          }

          const createdTicket = await kanban.createTicket(action.projectId, {
            project_id: action.projectId,
            title: action.title,
            description: action.description ?? null,
            column: action.column ?? 'todo',
            mode: action.mode ?? 'build'
          })
          createdTicketsByActionKey.set(action.actionKey, createdTicket)

          for (const blockerId of action.dependsOnTicketIds) {
            await window.kanban.dependency.add(createdTicket.id, blockerId)
          }
          continue
        }

        if (!action.ticketId) {
          throw new Error('Uma ação não informa qual task deve alterar.')
        }

        const ticket =
          ticketsById.get(action.ticketId) ??
          await window.kanban.ticket.get(action.ticketId)

        if (!ticket) {
          throw new Error(`Task não encontrada: ${action.ticketId}`)
        }

        if (action.type === 'update') {
          const update: KanbanTicketUpdate = {}
          if (action.title !== undefined) update.title = action.title
          if (action.description !== undefined) update.description = action.description
          if (action.mode !== undefined) update.mode = action.mode
          await kanban.updateTicket(ticket.id, ticket.project_id, update)
          continue
        }

        if (action.type === 'move') {
          if (!action.column) {
            throw new Error(`Ação de mover sem coluna: ${action.actionKey}`)
          }
          const projectTickets = useKanbanStore.getState().tickets.get(ticket.project_id) ?? []
          const nextSortOrder =
            Math.max(
              0,
              ...projectTickets
                .filter((candidate) => candidate.column === action.column)
                .map((candidate) => candidate.sort_order)
            ) + 1
          await kanban.moveTicket(ticket.id, ticket.project_id, action.column, nextSortOrder)
          continue
        }

        if (action.type === 'archive') {
          await kanban.archiveTicket(ticket.id, ticket.project_id)
        }
      }

      const touchedProjectIds = new Set(
        selectedActions
          .map((action) => action.projectId)
          .filter((projectId): projectId is string => Boolean(projectId))
      )
      for (const action of selectedActions) {
        if (action.ticketId) {
          const ticket = ticketsById.get(action.ticketId) ?? await window.kanban.ticket.get(action.ticketId)
          if (ticket?.project_id) touchedProjectIds.add(ticket.project_id)
        }
      }
      for (const ticket of createdTicketsByActionKey.values()) {
        touchedProjectIds.add(ticket.project_id)
      }
      for (const touchedProjectId of touchedProjectIds) {
        await kanban.loadTickets(touchedProjectId)
        await kanban.loadDependencies(touchedProjectId)
      }

      const appliedAt = new Date().toISOString()
      setTicketActions((current) =>
        current.map((action) =>
          selectedActions.some((selected) => selected.id === action.id)
            ? { ...action, appliedAt, selected: true }
            : action
        )
      )
      addLocalSystemMessage(
        `Apliquei ${selectedActions.length} alteração${selectedActions.length === 1 ? '' : 'es'} no board.`
      )
      navigateToBoard()
      toast.success(`Apliquei ${selectedActions.length} alteração${selectedActions.length === 1 ? '' : 'es'}.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao aplicar alterações.'
      toast.error(message)
    }
  }, [addLocalSystemMessage, navigateToBoard, ticketActions, ticketsById])

  const handleCancelActions = useCallback(() => {
    setTicketActions([])
    setActionSourceMessageId(null)
    addLocalSystemMessage('Alterações propostas descartadas.')
  }, [addLocalSystemMessage])

  const handleClear = useCallback(async () => {
    await handleDiscardConversation({ preserveOpen: true })
    if (storedScope && storedScope.kind !== 'pinned') {
      addLocalSystemMessage('Conversation cleared.')
    }
  }, [addLocalSystemMessage, handleDiscardConversation, storedScope])

  const handleSelectModel = useCallback(async (model: SelectedModel) => {
    setSelectedModelOverride(model)
    await handleDiscardConversation({
      preserveOpen: true,
      nextSelectedModelOverride: model
    })
    addLocalSystemMessage(`Board assistant model changed to ${model.providerID}/${model.modelID}.`)
  }, [addLocalSystemMessage, handleDiscardConversation, setSelectedModelOverride])

  const handleResetModel = useCallback(async () => {
    setSelectedModelOverride(null)
    await handleDiscardConversation({
      preserveOpen: true,
      nextSelectedModelOverride: null
    })
    addLocalSystemMessage('Board assistant model reset to the app default.')
  }, [addLocalSystemMessage, handleDiscardConversation, setSelectedModelOverride])

  const handleSelectAgentSdk = useCallback(async (nextAgentSdk: 'opencode' | 'claude-code' | 'codex' | 'mistral-vibe' | 'cursor-cli' | 'antigravity') => {
    const nextOverride = nextAgentSdk === defaultBoardAgentSdk ? null : nextAgentSdk
    setSelectedAgentSdkOverride(nextOverride)
    setSelectedModelOverride(null)
    await handleDiscardConversation({
      preserveOpen: true,
      nextSelectedAgentSdkOverride: nextOverride,
      nextSelectedModelOverride: null
    })
    addLocalSystemMessage(`Board assistant provider changed to ${getAgentSdkLabel(nextAgentSdk)}.`)
  }, [addLocalSystemMessage, defaultBoardAgentSdk, handleDiscardConversation, setSelectedAgentSdkOverride, setSelectedModelOverride])

  const handleRevise = useCallback(() => {
    setComposerValue('Revise os rascunhos atuais. Mantenha as tasks pequenas, específicas e prontas para implementação.')
    composerFocusRef.current?.focus()
  }, [setComposerValue])

  const handleCancelDrafts = useCallback(() => {
    clearDrafts()
    addLocalSystemMessage('Rascunhos descartados.')
  }, [addLocalSystemMessage, clearDrafts])

  const handleSelectTargetProject = useCallback(async (nextProjectId: string) => {
    await setSelectedTargetProjectId(nextProjectId)
    await handleDiscardConversation({ preserveOpen: true, nextTargetProjectId: nextProjectId })
    const projectName = projects.find((project) => project.id === nextProjectId)?.name ?? 'the selected project'
    addLocalSystemMessage(`Target project changed to ${projectName}.`)
  }, [addLocalSystemMessage, handleDiscardConversation, projects, setSelectedTargetProjectId])

  const handleQuestionReply = useCallback(
    async (requestId: string, answers: QuestionAnswer[]) => {
      try {
        await window.opencodeOps.questionReply(requestId, answers, runtimePath || undefined)
        if (sessionId) {
          useQuestionStore.getState().removeQuestion(sessionId, requestId)
        }
      } catch {
        toast.error('Failed to answer assistant question.')
      }
    },
    [runtimePath, sessionId]
  )

  const handleQuestionReject = useCallback(
    async (requestId: string) => {
      try {
        await window.opencodeOps.questionReject(requestId, runtimePath || undefined)
        if (sessionId) {
          useQuestionStore.getState().removeQuestion(sessionId, requestId)
        }
      } catch {
        toast.error('Failed to dismiss assistant question.')
      }
    },
    [runtimePath, sessionId]
  )

  const handlePermissionReply = useCallback(
    async (requestId: string, reply: 'once' | 'always' | 'reject', message?: string) => {
      try {
        await window.opencodeOps.permissionReply(requestId, reply, runtimePath || undefined, message)
        if (sessionId) {
          usePermissionStore.getState().removePermission(sessionId, requestId)
        }
      } catch {
        toast.error('Failed to respond to permission request.')
      }
    },
    [runtimePath, sessionId]
  )

  const handleCommandApprovalReply = useCallback(
    async (
      requestId: string,
      approved: boolean,
      remember?: 'allow' | 'block',
      pattern?: string,
      patterns?: string[]
    ) => {
      try {
        await window.opencodeOps.commandApprovalReply(
          requestId,
          approved,
          remember,
          pattern,
          runtimePath || undefined,
          patterns
        )
        if (sessionId) {
          useCommandApprovalStore.getState().removeApproval(sessionId, requestId)
        }
      } catch {
        toast.error('Failed to respond to command approval request.')
      }
    },
    [runtimePath, sessionId]
  )

  if (!scope) return null

  return (
    <div className="flex h-full flex-col overflow-hidden bg-card">
      <BoardChatHeader
        scope={scope}
        selectedTargetProjectId={selectedTargetProjectId}
        status={status}
        selectedModel={effectiveSelectedModel}
        agentSdk={effectiveAgentSdk}
        availableAgentSdks={agentSdkOptions}
        modelResetVisible={Boolean(selectedModelOverride)}
        onSelectAgentSdk={(agentSdk) => {
          void handleSelectAgentSdk(agentSdk)
        }}
        onSelectModel={(model) => {
          void handleSelectModel(model)
        }}
        onResetModel={() => {
          void handleResetModel()
        }}
        onSelectTargetProject={handleSelectTargetProject}
        onClear={() => {
          void handleClear()
        }}
        onClose={navigateToBoard}
      />

      {error && (
        <div className="border-b border-destructive/20 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <BoardChatMessageList
        messages={messages}
        drafts={drafts}
        draftSourceMessageId={draftSourceMessageId}
        ticketActions={ticketActions}
        actionSourceMessageId={actionSourceMessageId}
        ticketsById={ticketsById}
        streamingMessage={streamingMessage}
        activeQuestion={activeQuestion}
        activePermission={activePermission}
        activeApproval={activeApproval}
        sessionId={sessionId}
        onToggleDraft={toggleDraftSelected}
        onToggleAction={handleToggleAction}
        onCreateAll={() => {
          void handleCreateDrafts(false)
        }}
        onCreateSelected={() => {
          void handleCreateDrafts(true)
        }}
        onApplyActions={() => {
          void handleApplyTicketActions()
        }}
        onRevise={handleRevise}
        onCancelDrafts={handleCancelDrafts}
        onCancelActions={handleCancelActions}
        hasInvalidDrafts={hasInvalidDrafts}
        hasInvalidActions={hasInvalidActions}
        onQuestionReply={(requestId, answers) => {
          void handleQuestionReply(requestId, answers)
        }}
        onQuestionReject={(requestId) => {
          void handleQuestionReject(requestId)
        }}
        onPermissionReply={(requestId, reply, message) => {
          void handlePermissionReply(requestId, reply, message)
        }}
        onCommandApprovalReply={(requestId, approved, remember, pattern, patterns) => {
          void handleCommandApprovalReply(requestId, approved, remember, pattern, patterns)
        }}
      />

      {mcpDraft && (
        <McpDraftCard
          draft={mcpDraft}
          onChange={setMcpDraft}
          onSave={handleSaveMcpDraft}
          onCancel={() => {
            setMcpDraft(null)
            addLocalSystemMessage('Rascunho de MCP descartado.')
          }}
        />
      )}

      <BoardChatComposer
        value={composerValue}
        disabled={!canInteract || (scope.kind === 'connection' && !selectedTargetProjectId)}
        sending={status === 'starting' || status === 'thinking'}
        canSend={canSend}
        textareaRef={composerFocusRef}
        onChange={setComposerValue}
        onSend={() => {
          void handleSend()
        }}
      />
    </div>
  )
}
