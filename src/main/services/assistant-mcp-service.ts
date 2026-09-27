import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js'
import { z } from 'zod/v4'
import type { DatabaseService } from '../db/database'
import type { Session } from '../db/types'
import type { AgentSdkId, AgentSdkImplementer } from './agent-sdk-types'
import { createWorktreeOp, deleteWorktreeOp } from './worktree-ops'
import { createConnectionOp, deleteConnectionOp } from './connection-ops'
import { AssistantProjectSelectionManager } from './assistant-project-selection'
import {
  DELEGATION_AGENT_SDKS,
  isDelegationAgentSdk,
  resolveDelegationAgentSdk,
  type DelegationAgentSdk
} from './assistant-agent-routing'
import { createLogger } from './logger'
import { telemetryService } from './telemetry-service'
import { openCodeService } from './opencode-service'
import { getCapabilityStudio } from './capability-studio'
import { onAgentStreamEvent, type AgentStreamEvent } from './agent-event-bus'
import type {
  AssistantProjectSelectionRequest,
  AssistantTask,
  AssistantTaskState,
  AssistantTaskTarget,
  AssistantTaskWaitingReason
} from '@shared/types/assistant'

const log = createLogger({ component: 'AssistantMcpService' })
const ASSISTANT_PROJECT_INSTRUCTIONS_KEY = 'assistant_project_instructions_v1'
const ASSISTANT_TASKS_KEY = 'assistant_delegated_tasks_v1'
let assistantMcpUrl: string | null = null
let taskTrackingDisposer: (() => void) | null = null
const projectSelections = new AssistantProjectSelectionManager()

export interface AssistantWindowLike {
  isDestroyed: () => boolean
  webContents: {
    send: (channel: string, ...args: unknown[]) => void
  }
}

export interface AssistantAgentSdkManagerLike {
  getImplementer: (sdkId: AgentSdkId) => AgentSdkImplementer
}

const assistantWindows = new Set<AssistantWindowLike>()

export function getAssistantWorkspacePath(): string {
  const configured = process.env.OCTOB_ASSISTANT_WORKSPACE?.trim()
  return configured || join(homedir(), '.octob', 'assistant-workspace')
}

export function isAssistantWorkspacePath(value?: string): boolean {
  return Boolean(value && resolve(value) === resolve(getAssistantWorkspacePath()))
}

export function getAssistantMcpUrl(): string | null {
  return assistantMcpUrl
}

export function getPendingAssistantProjectSelections(): AssistantProjectSelectionRequest[] {
  return projectSelections.listPending()
}

export function resolveAssistantProjectSelection(
  requestId: string,
  projectId: string | null
): boolean {
  return projectSelections.resolve(requestId, projectId)
}

type CreatedWorktree = {
  project: NonNullable<ReturnType<DatabaseService['getProject']>>
  worktree: NonNullable<Awaited<ReturnType<typeof createWorktreeOp>>['worktree']>
}

async function rollbackCreatedWorktrees(db: DatabaseService, created: CreatedWorktree[]): Promise<void> {
  for (const { project, worktree } of [...created].reverse()) {
    try {
      const result = await deleteWorktreeOp(db, {
        worktreeId: worktree.id,
        worktreePath: worktree.path,
        branchName: worktree.branch_name,
        projectPath: project.path,
        archive: true,
        skipArchiveScript: true
      })
      if (!result.success) throw new Error(result.error || 'Worktree rollback failed')
    } catch (error) {
      log.warn('Could not roll back a worktree created for assistant delegation', {
        worktreeId: worktree.id,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }
}

function text(value: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

function readProjectInstructions(db: DatabaseService): Record<string, string[]> {
  try {
    const raw = db.getSetting(ASSISTANT_PROJECT_INSTRUCTIONS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return Object.fromEntries(Object.entries(parsed).map(([projectId, value]) => [
      projectId,
      Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
    ]))
  } catch {
    return {}
  }
}

export function getAssistantProjectInstructions(
  db: DatabaseService,
  projectId: string
): string[] {
  if (!db.getProject(projectId)) return []
  return readProjectInstructions(db)[projectId] ?? []
}

export function setAssistantProjectInstructions(
  db: DatabaseService,
  projectId: string,
  instructions: string[]
): string[] {
  if (!db.getProject(projectId)) throw new Error('Project not found')
  const normalized = instructions.map((item) => item.trim()).filter(Boolean)
  const deduplicated = normalized.filter(
    (item, index, all) => all.findIndex(
      (candidate) => candidate.toLocaleLowerCase() === item.toLocaleLowerCase()
    ) === index
  )
  const allInstructions = readProjectInstructions(db)
  allInstructions[projectId] = deduplicated
  writeProjectInstructions(db, allInstructions)
  return deduplicated
}

function writeProjectInstructions(db: DatabaseService, value: Record<string, string[]>): void {
  db.setSetting(ASSISTANT_PROJECT_INSTRUCTIONS_KEY, JSON.stringify(value))
}

const TASK_STATES: AssistantTaskState[] = ['running', 'waiting_input', 'completed', 'error']
const WAITING_REASONS: AssistantTaskWaitingReason[] = [
  'plan_review',
  'permission',
  'question',
  'command_approval'
]
const delegationAgentSdkSchema = z.enum(DELEGATION_AGENT_SDKS).optional().describe(
  'Coding agent explicitly requested by the user. Omit to use the current Octob default agent.'
)

/**
 * Accept both the current task shape and the earlier persisted shape, which had
 * no kind/state fields. Older entries are treated as single-worktree jobs that
 * are still running until a stream event says otherwise.
 */
function normalizeAssistantTask(value: unknown): AssistantTask | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (
    typeof raw.projectId !== 'string' ||
    typeof raw.projectName !== 'string' ||
    typeof raw.worktreeId !== 'string' ||
    typeof raw.worktreePath !== 'string' ||
    typeof raw.sessionId !== 'string' ||
    typeof raw.title !== 'string'
  ) {
    return null
  }

  const kind = raw.kind === 'connection' ? 'connection' : 'worktree'
  const state = TASK_STATES.includes(raw.state as AssistantTaskState)
    ? (raw.state as AssistantTaskState)
    : 'running'
  const waitingReason = WAITING_REASONS.includes(raw.waitingReason as AssistantTaskWaitingReason)
    ? (raw.waitingReason as AssistantTaskWaitingReason)
    : null
  const targets = Array.isArray(raw.targets)
    ? raw.targets.filter((target): target is AssistantTaskTarget => {
        if (!target || typeof target !== 'object') return false
        const item = target as Record<string, unknown>
        return (
          typeof item.projectId === 'string' &&
          typeof item.projectName === 'string' &&
          typeof item.worktreeId === 'string' &&
          typeof item.worktreePath === 'string'
        )
      })
    : []
  const now = new Date().toISOString()

  return {
    kind,
    projectId: raw.projectId,
    projectName: raw.projectName,
    worktreeId: raw.worktreeId,
    worktreePath: raw.worktreePath,
    workspacePath: typeof raw.workspacePath === 'string' ? raw.workspacePath : raw.worktreePath,
    connectionId: typeof raw.connectionId === 'string' ? raw.connectionId : null,
    targets: targets.length > 0
      ? targets
      : [
          {
            projectId: raw.projectId,
            projectName: raw.projectName,
            worktreeId: raw.worktreeId,
            worktreePath: raw.worktreePath
          }
        ],
    sessionId: raw.sessionId,
    agentSdk: isDelegationAgentSdk(raw.agentSdk) ? raw.agentSdk : undefined,
    title: raw.title,
    state: waitingReason && state === 'running' ? 'waiting_input' : state,
    waitingReason: state === 'waiting_input' ? waitingReason : null,
    stateDetail: typeof raw.stateDetail === 'string' ? raw.stateDetail : null,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now
  }
}

function isTaskStillValid(db: DatabaseService, task: AssistantTask): boolean {
  if (!db.getProject(task.projectId) || !db.getSession(task.sessionId)) return false
  if (task.kind === 'connection') {
    return Boolean(task.connectionId && db.getConnection(task.connectionId))
  }
  return db.getWorktree(task.worktreeId)?.status === 'active'
}

/**
 * Session ids with a delegated task attached. Stream events fire constantly
 * (text deltas), so the tracker checks this in-memory set before touching the
 * settings row.
 */
let trackedSessionIds: Set<string> | null = null

export function getAssistantTasks(db: DatabaseService): AssistantTask[] {
  try {
    const raw = db.getSetting(ASSISTANT_TASKS_KEY)
    if (!raw) {
      trackedSessionIds = new Set()
      return []
    }
    const stored = JSON.parse(raw) as unknown
    if (!Array.isArray(stored)) return []
    const normalized = stored
      .map(normalizeAssistantTask)
      .filter((task): task is AssistantTask => task !== null)
    const validTasks = normalized.filter((task) => isTaskStillValid(db, task))

    // Keep the persisted list in sync with resources that were removed or archived
    // outside the assistant panel. This also removes invalid legacy entries.
    if (validTasks.length !== stored.length) {
      db.setSetting(ASSISTANT_TASKS_KEY, JSON.stringify(validTasks))
    }

    trackedSessionIds = new Set(validTasks.map((task) => task.sessionId))
    return validTasks
  } catch {
    return []
  }
}

export function removeAssistantTask(db: DatabaseService, sessionId: string): AssistantTask[] {
  const remainingTasks = getAssistantTasks(db).filter((task) => task.sessionId !== sessionId)
  writeAssistantTasks(db, remainingTasks)
  return remainingTasks
}

export function notifyAssistantTasksChanged(db: DatabaseService): void {
  const tasks = getAssistantTasks(db)
  for (const window of assistantWindows) {
    if (window.isDestroyed()) {
      assistantWindows.delete(window)
      continue
    }
    window.webContents.send('assistant:tasks-changed', tasks)
  }
}

function writeAssistantTasks(db: DatabaseService, tasks: AssistantTask[]): void {
  const persisted = tasks.slice(0, 100)
  db.setSetting(ASSISTANT_TASKS_KEY, JSON.stringify(persisted))
  trackedSessionIds = new Set(persisted.map((task) => task.sessionId))
}

function recordAssistantTask(db: DatabaseService, task: AssistantTask): void {
  writeAssistantTasks(db, [
    task,
    ...getAssistantTasks(db).filter((item) => item.sessionId !== task.sessionId)
  ])
}

/**
 * Patch one delegated task and push the new list to every window so the
 * assistant sidebar reflects "needs you" and "finished" without the user
 * having to open the delegated session first.
 */
function patchAssistantTask(
  db: DatabaseService,
  sessionId: string,
  patch: Partial<Pick<AssistantTask, 'state' | 'waitingReason' | 'stateDetail' | 'title'>>
): void {
  const tasks = getAssistantTasks(db)
  const index = tasks.findIndex((task) => task.sessionId === sessionId)
  if (index < 0) return

  const current = tasks[index]
  const next: AssistantTask = {
    ...current,
    ...patch,
    waitingReason:
      patch.state && patch.state !== 'waiting_input'
        ? null
        : patch.waitingReason !== undefined
          ? patch.waitingReason
          : current.waitingReason,
    updatedAt: new Date().toISOString()
  }

  if (
    next.state === current.state &&
    next.waitingReason === current.waitingReason &&
    next.stateDetail === current.stateDetail &&
    next.title === current.title
  ) {
    return
  }

  tasks[index] = next
  writeAssistantTasks(db, tasks)
  notifyAssistantTasksChanged(db)
}

const WAITING_EVENTS: Record<string, AssistantTaskWaitingReason> = {
  'plan.ready': 'plan_review',
  'permission.asked': 'permission',
  'question.asked': 'question',
  'command.approval_needed': 'command_approval'
}

const RESUME_EVENTS = new Set([
  'plan.resolved',
  'permission.replied',
  'question.replied',
  'question.rejected',
  'command.approval_replied'
])

const WAITING_DETAIL: Record<AssistantTaskWaitingReason, string> = {
  plan_review: 'Plano pronto para aprovação',
  permission: 'Aguardando permissão',
  question: 'O agente fez uma pergunta',
  command_approval: 'Aguardando aprovação de comando'
}

function isTrackedTaskEvent(db: DatabaseService, event: AgentStreamEvent): boolean {
  if (!event.sessionId) return false
  if (
    event.type !== 'session.status' &&
    !WAITING_EVENTS[event.type] &&
    !RESUME_EVENTS.has(event.type)
  ) {
    return false
  }
  if (trackedSessionIds === null) getAssistantTasks(db)
  return trackedSessionIds?.has(event.sessionId) ?? false
}

function applyAssistantTaskStreamEvent(db: DatabaseService, event: AgentStreamEvent): void {
  if (!isTrackedTaskEvent(db, event)) return
  const tasks = getAssistantTasks(db)
  const task = tasks.find((item) => item.sessionId === event.sessionId)
  if (!task) return

  const waitingReason = WAITING_EVENTS[event.type]
  if (waitingReason) {
    patchAssistantTask(db, task.sessionId, {
      state: 'waiting_input',
      waitingReason,
      stateDetail: WAITING_DETAIL[waitingReason]
    })
    return
  }

  if (RESUME_EVENTS.has(event.type)) {
    patchAssistantTask(db, task.sessionId, {
      state: 'running',
      waitingReason: null,
      stateDetail: null
    })
    return
  }

  if (event.type !== 'session.status') return
  const statusType =
    event.statusPayload?.type ??
    ((event.data as { status?: { type?: string } } | undefined)?.status?.type)

  if (statusType === 'busy') {
    // A blocked task stays blocked; the agent only resumes once the request is answered.
    if (task.state === 'waiting_input') return
    patchAssistantTask(db, task.sessionId, { state: 'running', stateDetail: null })
    return
  }

  if (statusType === 'idle') {
    // Idle while blocked means the agent is parked on a request, not finished.
    if (task.state === 'waiting_input') return
    patchAssistantTask(db, task.sessionId, {
      state: 'completed',
      waitingReason: null,
      stateDetail: null
    })
  }
}

/**
 * Track delegated task lifecycle in the main process so completion survives
 * renderer reloads and is visible even when the user never opened the session.
 */
function startAssistantTaskTracking(db: DatabaseService): void {
  if (taskTrackingDisposer) return
  getAssistantTasks(db)
  taskTrackingDisposer = onAgentStreamEvent((event) => {
    try {
      applyAssistantTaskStreamEvent(db, event)
    } catch (error) {
      log.warn('Failed to apply assistant task stream event', {
        type: event.type,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  })
}

interface DelegationRunner {
  connect: (workspacePath: string, octobSessionId: string) => Promise<{ sessionId: string }>
  disconnect?: (workspacePath: string, agentSessionId: string) => Promise<void>
  reconnect?: (
    workspacePath: string,
    agentSessionId: string,
    octobSessionId: string
  ) => Promise<{ success: boolean }>
  prompt: (workspacePath: string, agentSessionId: string, message: string) => Promise<void>
}

function getImplementer(
  sdkManager: AssistantAgentSdkManagerLike,
  agentSdk: AgentSdkId
): DelegationRunner {
  if (agentSdk === 'opencode') {
    return openCodeService as unknown as DelegationRunner
  }
  return sdkManager.getImplementer(agentSdk) as unknown as DelegationRunner
}

function resolveSessionAgentSdk(db: DatabaseService, session: Session): AgentSdkId {
  const candidate = session.agent_sdk as AgentSdkId | null
  if (
    candidate === 'opencode' ||
    candidate === 'claude-code' ||
    candidate === 'codex' ||
    candidate === 'mistral-vibe' ||
    candidate === 'cursor-cli' ||
    candidate === 'antigravity'
  ) {
    return candidate
  }
  return resolveDelegationAgentSdk(db)
}

/**
 * Send a prompt into an existing delegated session. The backend session can be
 * gone (app restart, agent crash), so a failed prompt is retried once against a
 * freshly connected backend session.
 */
async function promptExistingSession(
  db: DatabaseService,
  sdkManager: AssistantAgentSdkManagerLike,
  session: Session,
  workspacePath: string,
  prompt: string
): Promise<void> {
  const agentSdk = resolveSessionAgentSdk(db, session)
  const implementer = getImplementer(sdkManager, agentSdk)
  const backendSessionId = session.opencode_session_id

  if (backendSessionId && !backendSessionId.startsWith('pending::')) {
    try {
      await implementer.prompt(workspacePath, backendSessionId, prompt)
      return
    } catch (error) {
      log.warn('Prompt to existing delegated session failed, reconnecting', {
        sessionId: session.id,
        error: error instanceof Error ? error.message : String(error)
      })
    }

    // Resuming keeps the delegated conversation; only fall back to a brand new
    // backend session when the agent cannot restore this one.
    try {
      const resumed = await implementer.reconnect?.(workspacePath, backendSessionId, session.id)
      if (resumed?.success) {
        await implementer.prompt(workspacePath, backendSessionId, prompt)
        return
      }
    } catch (error) {
      log.warn('Reconnect of delegated session failed', {
        sessionId: session.id,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const connected = await implementer.connect(workspacePath, session.id)
  db.updateSession(session.id, { opencode_session_id: connected.sessionId })
  await implementer.prompt(workspacePath, connected.sessionId, prompt)
}

function summarizeTask(task: AssistantTask): Record<string, unknown> {
  return {
    session_id: task.sessionId,
    agent_sdk: task.agentSdk,
    kind: task.kind,
    title: task.title,
    state: task.state,
    waiting_reason: task.waitingReason,
    workspace_path: task.workspacePath,
    connection_id: task.connectionId,
    repositories: task.targets.map((target) => ({
      project_id: target.projectId,
      project_name: target.projectName,
      worktree_id: target.worktreeId,
      worktree_path: target.worktreePath
    })),
    updated_at: task.updatedAt
  }
}

export async function startAssistantMcpService(
  db: DatabaseService,
  sdkManager: AssistantAgentSdkManagerLike,
  mainWindow: AssistantWindowLike
): Promise<void> {
  assistantWindows.add(mainWindow)
  if (assistantMcpUrl) return

  startAssistantTaskTracking(db)

  /** Create a delegated session in a workspace, register the task, and fire the prompt. */
  const delegate = async (params: {
    kind: AssistantTask['kind']
    title: string
    prompt: string
    workspacePath: string
    connectionId: string | null
    targets: AssistantTaskTarget[]
    projectName?: string
    agentSdk?: DelegationAgentSdk
  }): Promise<AssistantTask> => {
    const [primary] = params.targets
    const agentSdk = resolveDelegationAgentSdk(db, params.agentSdk)
    const implementer = getImplementer(sdkManager, agentSdk)
    const session = db.createSession({
      worktree_id: params.kind === 'connection' ? null : primary.worktreeId,
      project_id: primary.projectId,
      ...(params.connectionId ? { connection_id: params.connectionId } : {}),
      name: params.title.slice(0, 120),
      agent_sdk: agentSdk,
      mode: 'plan'
    })
    let backendSessionId: string | null = null
    try {
      const connected = await implementer.connect(params.workspacePath, session.id)
      backendSessionId = connected.sessionId
      db.updateSession(session.id, { opencode_session_id: connected.sessionId })
    } catch (error) {
      if (backendSessionId) {
        await implementer.disconnect?.(params.workspacePath, backendSessionId).catch(() => {})
      }
      db.deleteSession(session.id)
      throw error
    }

    const now = new Date().toISOString()
    const task: AssistantTask = {
      kind: params.kind,
      projectId: primary.projectId,
      projectName:
        params.projectName ??
        [...new Set(params.targets.map((target) => target.projectName))].join(' + '),
      worktreeId: primary.worktreeId,
      worktreePath: primary.worktreePath,
      workspacePath: params.workspacePath,
      connectionId: params.connectionId,
      targets: params.targets,
      sessionId: session.id,
      agentSdk,
      title: params.title,
      state: 'running',
      waitingReason: null,
      stateDetail: null,
      createdAt: now,
      updatedAt: now
    }

    // Persist and announce the task before starting the long-running prompt.
    // The MCP call must return immediately so the global assistant remains
    // responsive while the delegated agent continues in the background.
    recordAssistantTask(db, task)
    telemetryService.track('assistant_task_delegated', {
      agent_sdk: agentSdk,
      agent_selection: params.agentSdk ? 'explicit' : 'default',
      kind: params.kind
    })
    mainWindow.webContents.send('assistant:task-created', task)
    notifyAssistantTasksChanged(db)
    void implementer.prompt(params.workspacePath, backendSessionId!, params.prompt).catch((error) => {
      log.error(
        'Delegated assistant task failed',
        error instanceof Error ? error : new Error(String(error)),
        { sessionId: session.id, workspacePath: params.workspacePath }
      )
      db.updateSession(session.id, {
        status: 'error',
        completed_at: new Date().toISOString()
      })
      patchAssistantTask(db, session.id, {
        state: 'error',
        waitingReason: null,
        stateDetail: error instanceof Error ? error.message : String(error)
      })
    })

    return task
  }

  const makeServer = (): McpServer => {
    const server = new McpServer({
      name: 'octob-internal-tools',
      version: process.env.npm_package_version ?? '1.0.0'
    })

    const capabilitySpecSchema = z.object({
      name: z.string(), description: z.string(), provider: z.string().optional(),
      screens: z.array(z.string()), actions: z.array(z.string()),
      requiredSecrets: z.array(z.string()), externalWrites: z.array(z.string()),
      timeoutMs: z.number().int().positive().optional()
    })
    const capabilityArtifactSchema = z.object({
      html: z.string().describe('HTML fragment for the capability screen, without script tags'),
      css: z.string(),
      javascript: z.string().describe('Browser JavaScript. Use window.capability.call(input) to execute real backend actions.'),
      handler: z.string().describe('Node.js code: an async function expression (input, api) => result or CommonJS source exporting a function. Normal Node APIs including require, process, filesystem, child_process and fetch are available. The user may provide any HTTP destination at runtime.'),
      files: z.record(z.string(), z.string()).optional().describe('Optional versioned source and data files. The handler can require relative JavaScript or JSON files.'),
      tests: z.array(z.object({ name: z.string(), input: z.unknown(), expected: z.unknown(), httpMocks: z.array(z.object({ url: z.string(), method: z.string().optional(), status: z.number().int().optional(), body: z.unknown().optional(), headers: z.record(z.string(), z.string()).optional() })).optional() }))
    })

    server.registerTool('capability_create_draft', {
      description: 'Start a new experimental Octob capability from the user request. Resolve ambiguity first. Produce a specific name, screens, actions and external effects. The user must decide whether to install it after testing.',
      inputSchema: { request: z.string().min(1), spec: capabilitySpecSchema }
    }, async ({ request, spec }) => text(getCapabilityStudio().create(request, spec)))

    server.registerTool('capability_add_version', {
      description: 'Generate or revise the UI and real Node.js backend of a capability draft. Supply HTML, CSS, browser JavaScript, handler, optional files and contract tests. Use httpMocks to stub fetch in tests; other Node APIs remain real. Preview execution uses real network and Node APIs. Then call capability_validate. This does not install it.',
      inputSchema: { draft_id: z.string(), artifact: capabilityArtifactSchema, spec: capabilitySpecSchema.optional() }
    }, async ({ draft_id, artifact, spec }) => text(getCapabilityStudio().addVersion(draft_id, artifact, spec)))

    server.registerTool('capability_validate', {
      description: 'Build and test an experimental capability version. Report failed checks and revise until ready. The user tests the resulting screen in Experimentos and chooses whether to keep it.',
      inputSchema: { draft_id: z.string(), version: z.number().int().positive().optional() }
    }, async ({ draft_id, version }) => text(await getCapabilityStudio().validate(draft_id, version)))

    server.registerTool('capability_list', {
      description: 'List experimental and installed capabilities in Octob.', inputSchema: {}
    }, async () => text(getCapabilityStudio().list()))

    server.registerTool('capability_get', {
      description: 'Inspect a capability draft, version and validation before revising it.',
      inputSchema: { draft_id: z.string(), version: z.number().int().positive().optional() }
    }, async ({ draft_id, version }) => text(getCapabilityStudio().get(draft_id, version)))

    server.registerTool('capability_open_preview', {
      description: 'Open a validated capability in the Experimentos screen so the user can test it and decide whether to keep it. This never installs the capability.',
      inputSchema: { draft_id: z.string() }
    }, async ({ draft_id }) => {
      const detail = getCapabilityStudio().get(draft_id)
      if (!detail.versions.some((item) => item.status === 'ready')) return text({ error: 'Validate a version before opening its preview' })
      if (!mainWindow.isDestroyed()) mainWindow.webContents.send('assistant:capability-preview-requested', draft_id)
      return text({ success: true, draft_id, message: 'Preview opened in Experimentos. The user must decide whether to keep it.' })
    })

    server.registerTool('list_projects', {
      description: 'List projects registered in Octob to resolve project names or inspect project context. Do not open the project picker for general discussion, research, or questions.',
      inputSchema: {}
    }, async () => {
      return text(db.getAllProjects().map((project) => ({
        id: project.id,
        name: project.name,
        description: project.description,
        tags: project.tags,
        language: project.language
      })))
    })

    server.registerTool('get_project', {
      description: 'Get one Octob project and its active worktrees after identifying it with list_projects.',
      inputSchema: { project_id: z.string() }
    }, async ({ project_id }) => {
      const project = db.getProject(project_id)
      if (!project) return text({ error: 'Project not found' })
      return text({
        project,
        assistant_instructions: readProjectInstructions(db)[project_id] ?? [],
        worktrees: db.getActiveWorktreesByProject(project_id).map((worktree) => ({
          id: worktree.id,
          name: worktree.name,
          branch: worktree.branch_name,
          status: worktree.status,
          is_default: worktree.is_default
        }))
      })
    })

    server.registerTool('request_project_selection', {
      description: 'Show the user an Octob project picker and wait for one selection. First call list_projects to resolve the target ids. Use this only after deciding to delegate a task, immediately before creating the delegated work. For a task spanning repositories, call once for each repository. Do not use this for general discussion, research, or questions. Pass the returned selection_token to the matching delegation tool; it is bound to the selected project and can be used once. The selected project and its saved assistant memory are returned together.',
      inputSchema: {
        project_ids: z.array(z.string()).min(1),
        question: z.string().min(1).optional()
      }
    }, async ({ project_ids, question }, extra) => {
      const uniqueIds = Array.from(new Set(project_ids))
      const projects = uniqueIds.map((projectId) => db.getProject(projectId))

      if (projects.length === 0 || projects.some((project) => !project)) {
        return text({ error: 'One or more projects are not registered in Octob' })
      }

      const request: AssistantProjectSelectionRequest = {
        id: randomUUID(),
        question: question?.trim() || 'Qual projeto voce quer selecionar para esta tarefa delegada?',
        projects: projects.map((project) => ({
          id: project!.id,
          name: project!.name,
          description: project!.description,
          language: project!.language
        }))
      }
      const selected = await projectSelections.request(
        request,
        (selectionRequest) => {
          if (mainWindow.isDestroyed()) throw new Error('Assistant window is closed')
          mainWindow.webContents.send('assistant:project-selection-requested', selectionRequest)
        },
        { signal: extra.signal }
      )
      if (!selected) return text({ cancelled: true })

      const selectedProject = db.getProject(selected.projectId)
      if (!selectedProject) return text({ error: 'Selected project no longer exists' })
      return text({
        selected_project: selectedProject,
        selection_token: selected.selectionToken,
        assistant_instructions: readProjectInstructions(db)[selectedProject.id] ?? []
      })
    })

    server.registerTool('remember_project_instruction', {
      description: 'Persist a durable user instruction for one project, such as which external source or account to use. Call this when the user says always, remember, or establishes a lasting convention.',
      inputSchema: {
        project_id: z.string(),
        instruction: z.string().min(1)
      }
    }, async ({ project_id, instruction }) => {
      const project = db.getProject(project_id)
      if (!project) return text({ error: 'Project not found' })
      const allInstructions = readProjectInstructions(db)
      const normalized = instruction.trim()
      const current = allInstructions[project_id] ?? []
      if (!current.some((item) => item.toLocaleLowerCase() === normalized.toLocaleLowerCase())) {
        allInstructions[project_id] = [...current, normalized]
        writeProjectInstructions(db, allInstructions)
      }
      return text({ success: true, project_id, assistant_instructions: allInstructions[project_id] ?? current })
    })

    server.registerTool('forget_project_instruction', {
      description: 'Remove one previously saved project instruction when the user retracts or replaces it. Use get_project first and pass the saved instruction exactly.',
      inputSchema: {
        project_id: z.string(),
        instruction: z.string().min(1)
      }
    }, async ({ project_id, instruction }) => {
      const project = db.getProject(project_id)
      if (!project) return text({ error: 'Project not found' })
      const allInstructions = readProjectInstructions(db)
      const target = instruction.trim().toLocaleLowerCase()
      allInstructions[project_id] = (allInstructions[project_id] ?? []).filter(
        (item) => item.trim().toLocaleLowerCase() !== target
      )
      writeProjectInstructions(db, allInstructions)
      return text({ success: true, project_id, assistant_instructions: allInstructions[project_id] })
    })

    server.registerTool('create_worktree_and_delegate', {
      description: 'Create an isolated worktree for a task the user asked you to perform, create an agent session in it, and send the elaborated prompt. Set agent_sdk when the user explicitly chooses an agent; omit it to use the Octob default. Pass the one-time selection_token returned by request_project_selection for this project. Do not call this while merely listing or researching tasks. For follow-up work on a job you already delegated, use send_prompt_to_task instead of creating another worktree.',
      inputSchema: {
        project_id: z.string(),
        selection_token: z.string().uuid(),
        title: z.string(),
        agent_sdk: delegationAgentSdkSchema,
        prompt: z.string().describe('Complete implementation or investigation prompt for the delegated agent')
      }
    }, async ({ project_id, selection_token, title, agent_sdk, prompt }) => {
      const project = db.getProject(project_id)
      if (!project) return text({ error: 'Project not found' })
      if (!projectSelections.consume([selection_token], [project.id])) {
        return text({ error: 'Select this project in Octob before delegating' })
      }
      const result = await createWorktreeOp(db, {
        projectId: project.id,
        projectPath: project.path,
        projectName: project.name
      })
      if (!result.success || !result.worktree) return text({ error: result.error || 'Worktree creation failed' })

      try {
        const task = await delegate({
          kind: 'worktree',
          title,
          agentSdk: agent_sdk,
          prompt,
          workspacePath: result.worktree.path,
          connectionId: null,
          projectName: project.name,
          targets: [
            {
              projectId: project.id,
              projectName: project.name,
              worktreeId: result.worktree.id,
              worktreePath: result.worktree.path
            }
          ]
        })

        return text({
          success: true,
          project_id: project.id,
          worktree_id: result.worktree.id,
          session_id: task.sessionId,
          agent_sdk: task.agentSdk,
          message: 'The delegated agent is running in the new worktree.'
        })
      } catch (error) {
        await rollbackCreatedWorktrees(db, [{ project, worktree: result.worktree }])
        return text({ error: error instanceof Error ? error.message : String(error) })
      }
    })

    server.registerTool('list_delegated_tasks', {
      description: 'List the jobs this assistant already delegated, with their live state (running, waiting_input, completed, error) and the repositories each one covers. Call this before delegating new work so you can continue an existing job instead of duplicating it, and to report progress to the user.',
      inputSchema: {
        state: z.enum(['running', 'waiting_input', 'completed', 'error']).optional()
      }
    }, async ({ state }) => {
      const tasks = getAssistantTasks(db).filter((task) => !state || task.state === state)
      return text({ tasks: tasks.map(summarizeTask) })
    })

    server.registerTool('send_prompt_to_task', {
      description: 'Send an additional prompt into a job you already delegated, using its existing worktree or connection session. Use this for follow-ups, corrections, extra scope, or to answer the user on behalf of a job that is waiting. Get the session_id from list_delegated_tasks. This never creates a new worktree.',
      inputSchema: {
        session_id: z.string(),
        prompt: z.string().min(1).describe('Complete follow-up prompt for the delegated agent')
      }
    }, async ({ session_id, prompt }) => {
      const task = getAssistantTasks(db).find((item) => item.sessionId === session_id)
      if (!task) return text({ error: 'Delegated task not found. Call list_delegated_tasks first.' })
      const session = db.getSession(session_id)
      if (!session) return text({ error: 'Session no longer exists' })

      patchAssistantTask(db, session_id, { state: 'running', waitingReason: null, stateDetail: null })
      void promptExistingSession(db, sdkManager, session, task.workspacePath, prompt).catch((error) => {
        log.error(
          'Follow-up prompt to delegated task failed',
          error instanceof Error ? error : new Error(String(error)),
          { sessionId: session_id }
        )
        patchAssistantTask(db, session_id, {
          state: 'error',
          stateDetail: error instanceof Error ? error.message : String(error)
        })
      })

      return text({
        success: true,
        session_id,
        workspace_path: task.workspacePath,
        message: 'The follow-up prompt was sent to the running job.'
      })
    })

    server.registerTool('delegate_to_existing_worktree', {
      description: 'Start a delegated agent inside a worktree that is already open in Octob, instead of creating a new one. Set agent_sdk when the user explicitly chooses an agent; omit it to use the Octob default. Pass the one-time selection_token returned by request_project_selection for this worktree project.',
      inputSchema: {
        worktree_id: z.string(),
        selection_token: z.string().uuid(),
        title: z.string(),
        agent_sdk: delegationAgentSdkSchema,
        prompt: z.string().min(1)
      }
    }, async ({ worktree_id, selection_token, title, agent_sdk, prompt }) => {
      const worktree = db.getWorktree(worktree_id)
      if (!worktree || worktree.status !== 'active') return text({ error: 'Active worktree not found' })
      const project = db.getProject(worktree.project_id)
      if (!project) return text({ error: 'Project not found' })
      if (!projectSelections.consume([selection_token], [project.id])) {
        return text({ error: 'Select this project in Octob before delegating' })
      }

      try {
        const task = await delegate({
          kind: 'worktree',
          title,
          agentSdk: agent_sdk,
          prompt,
          workspacePath: worktree.path,
          connectionId: null,
          projectName: project.name,
          targets: [
            {
              projectId: project.id,
              projectName: project.name,
              worktreeId: worktree.id,
              worktreePath: worktree.path
            }
          ]
        })

        return text({
          success: true,
          session_id: task.sessionId,
          agent_sdk: task.agentSdk,
          worktree_id: worktree.id,
          message: 'The delegated agent is running in the existing worktree.'
        })
      } catch (error) {
        return text({ error: error instanceof Error ? error.message : String(error) })
      }
    })

    server.registerTool('list_connections', {
      description: 'List Octob connections: workspaces that join worktrees from two or more repositories behind one agent session. Use this before creating a connection so an existing one can be reused.',
      inputSchema: {}
    }, async () => {
      return text({
        connections: db.getAllConnections().map((connection) => ({
          id: connection.id,
          name: connection.name,
          path: connection.path,
          members: connection.members.map((member) => ({
            project_id: member.project_id,
            project_name: member.project_name,
            worktree_id: member.worktree_id,
            worktree_branch: member.worktree_branch,
            symlink_name: member.symlink_name
          }))
        }))
      })
    })

    server.registerTool('create_connection_and_delegate', {
      description: 'Delegate work spanning repositories. Set agent_sdk when the user explicitly chooses an agent; omit it to use the Octob default. Select each repository in Octob immediately before delegating and pass every one-time selection_token returned by request_project_selection. The token set must exactly match the projects in the resulting connection. The delegated agent runs once with every repository mounted side by side.',
      inputSchema: {
        project_ids: z.array(z.string()).optional().describe('Projects that need a new worktree for this task'),
        worktree_ids: z.array(z.string()).optional().describe('Existing worktrees to include as-is'),
        connection_id: z.string().optional().describe('Reuse this existing connection instead of creating one'),
        selection_tokens: z.array(z.string().uuid()).min(1),
        title: z.string(),
        agent_sdk: delegationAgentSdkSchema,
        prompt: z.string().min(1)
      }
    }, async ({ project_ids, worktree_ids, connection_id, selection_tokens, title, agent_sdk, prompt }) => {
      if (connection_id && ((project_ids?.length ?? 0) > 0 || (worktree_ids?.length ?? 0) > 0)) {
        return text({ error: 'Pass connection_id by itself when reusing a connection' })
      }

      let connection = connection_id ? db.getConnection(connection_id) : null
      if (connection_id && !connection) return text({ error: 'Connection not found' })

      const selectedProjectIds: string[] = []
      const existingWorktrees: NonNullable<ReturnType<DatabaseService['getWorktree']>>[] = []
      const projectsToCreate: NonNullable<ReturnType<DatabaseService['getProject']>>[] = []

      if (connection) {
        for (const member of connection.members) selectedProjectIds.push(member.project_id)
      } else {
        for (const projectId of new Set(project_ids ?? [])) {
          const project = db.getProject(projectId)
          if (!project) return text({ error: `Project not found: ${projectId}` })
          projectsToCreate.push(project)
          selectedProjectIds.push(project.id)
        }
        for (const worktreeId of new Set(worktree_ids ?? [])) {
          const worktree = db.getWorktree(worktreeId)
          if (!worktree || worktree.status !== 'active') return text({ error: `Active worktree not found: ${worktreeId}` })
          const project = db.getProject(worktree.project_id)
          if (!project) return text({ error: `Project not found for worktree ${worktree.id}` })
          existingWorktrees.push(worktree)
          selectedProjectIds.push(project.id)
        }
      }

      const targetProjectIds = [...new Set(selectedProjectIds)]
      if (targetProjectIds.length === 0) return text({ error: 'Select at least one registered project before delegating' })
      if (!projectSelections.consume(selection_tokens, targetProjectIds)) {
        return text({ error: 'Select every project in Octob before delegating' })
      }

      const createdWorktrees: CreatedWorktree[] = []
      let createdConnectionId: string | null = null
      try {
        if (!connection) {
          for (const project of projectsToCreate) {
            const result = await createWorktreeOp(db, {
              projectId: project.id,
              projectPath: project.path,
              projectName: project.name
            })
            if (!result.success || !result.worktree) throw new Error(result.error || `Worktree creation failed for ${project.name}`)
            createdWorktrees.push({ project, worktree: result.worktree })
          }

          const memberWorktreeIds = [...new Set([
            ...existingWorktrees.map((worktree) => worktree.id),
            ...createdWorktrees.map(({ worktree }) => worktree.id)
          ])]
          if (memberWorktreeIds.length < 2) throw new Error('A connection needs at least two worktrees')

          const result = await createConnectionOp(db, memberWorktreeIds)
          if (!result.success || !result.connection) throw new Error(result.error || 'Connection creation failed')
          connection = result.connection
          createdConnectionId = result.connection.id
        }

        const targets: AssistantTaskTarget[] = connection.members.map((member) => ({
          projectId: member.project_id,
          projectName: member.project_name,
          worktreeId: member.worktree_id,
          worktreePath: member.worktree_path
        }))
        const actualProjectIds = [...new Set(targets.map((target) => target.projectId))]
        if (
          targets.length === 0 ||
          actualProjectIds.length !== targetProjectIds.length ||
          targetProjectIds.some((projectId) => !actualProjectIds.includes(projectId))
        ) throw new Error('The connection projects do not match the selected projects')

        const task = await delegate({
          kind: 'connection',
          title,
          agentSdk: agent_sdk,
          prompt,
          workspacePath: connection.path,
          connectionId: connection.id,
          targets
        })

        return text({
          success: true,
          session_id: task.sessionId,
          agent_sdk: task.agentSdk,
          connection_id: connection.id,
          connection_path: connection.path,
          repositories: targets.map((target) => target.projectName),
          message: 'The delegated agent is running in the connection workspace with every repository mounted.'
        })
      } catch (error) {
        if (createdConnectionId) {
          const cleanup = await deleteConnectionOp(db, createdConnectionId)
          if (!cleanup.success) {
            log.warn('Could not roll back the connection created for assistant delegation', {
              connectionId: createdConnectionId,
              error: cleanup.error
            })
          }
        }
        await rollbackCreatedWorktrees(db, createdWorktrees)
        return text({ error: error instanceof Error ? error.message : String(error) })
      }
    })

    return server
  }

  const expressApp = createMcpExpressApp({ host: '127.0.0.1' })
  expressApp.post('/mcp', async (req, res) => {
    const server = makeServer()
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    res.on('close', () => { void transport.close(); void server.close() })
    try {
      await server.connect(transport)
      await transport.handleRequest(req, res, req.body)
    } catch (error) {
      log.error('Assistant MCP request failed', error instanceof Error ? error : new Error(String(error)))
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null })
    }
  })

  await new Promise<void>((resolveStart, reject) => {
    const httpServer = expressApp.listen(0, '127.0.0.1', () => {
      const address = httpServer.address()
      if (!address || typeof address === 'string') return reject(new Error('Could not bind assistant MCP server'))
      assistantMcpUrl = `http://127.0.0.1:${address.port}/mcp`
      log.info('Assistant MCP service started', { url: assistantMcpUrl })
      resolveStart()
    })
    httpServer.on('error', reject)
  })
}
