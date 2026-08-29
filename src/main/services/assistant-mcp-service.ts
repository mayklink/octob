import { app, type BrowserWindow } from 'electron'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js'
import { z } from 'zod/v4'
import type { DatabaseService } from '../db/database'
import type { AgentSdkManager } from './agent-sdk-manager'
import type { AgentSdkId } from './agent-sdk-types'
import { createWorktreeOp } from './worktree-ops'
import { APP_SETTINGS_DB_KEY } from '@shared/types/settings'
import { createLogger } from './logger'
import { openCodeService } from './opencode-service'
import type {
  AssistantProjectSelectionRequest,
  AssistantTask
} from '@shared/types/assistant'

const log = createLogger({ component: 'AssistantMcpService' })
const ASSISTANT_PROJECT_INSTRUCTIONS_KEY = 'assistant_project_instructions_v1'
const ASSISTANT_TASKS_KEY = 'assistant_delegated_tasks_v1'
let assistantMcpUrl: string | null = null
const pendingProjectSelections = new Map<
  string,
  {
    request: AssistantProjectSelectionRequest
    resolve: (projectId: string | null) => void
  }
>()

export function getAssistantWorkspacePath(): string {
  return join(app.getPath('userData'), 'assistant-workspace')
}

export function isAssistantWorkspacePath(value?: string): boolean {
  return Boolean(value && resolve(value) === resolve(getAssistantWorkspacePath()))
}

export function getAssistantMcpUrl(): string | null {
  return assistantMcpUrl
}

export function getPendingAssistantProjectSelections(): AssistantProjectSelectionRequest[] {
  return Array.from(pendingProjectSelections.values(), (entry) => entry.request)
}

export function resolveAssistantProjectSelection(
  requestId: string,
  projectId: string | null
): boolean {
  const pending = pendingProjectSelections.get(requestId)
  if (!pending) return false
  if (projectId && !pending.request.projects.some((project) => project.id === projectId)) {
    return false
  }
  pendingProjectSelections.delete(requestId)
  pending.resolve(projectId)
  return true
}

function waitForAssistantProjectSelection(
  request: AssistantProjectSelectionRequest,
  mainWindow: BrowserWindow
): Promise<string | null> {
  return new Promise((resolveSelection) => {
    pendingProjectSelections.set(request.id, { request, resolve: resolveSelection })
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('assistant:project-selection-requested', request)
    }
  })
}

function readDefaultAgentSdk(db: DatabaseService): AgentSdkId {
  try {
    const raw = db.getSetting(APP_SETTINGS_DB_KEY)
    const value = raw ? (JSON.parse(raw) as Record<string, unknown>).defaultAgentSdk : null
    if (value === 'claude-code' || value === 'codex' || value === 'mistral-vibe' || value === 'cursor-cli' || value === 'antigravity' || value === 'opencode') return value
  } catch {
    // Use the stable default below.
  }
  return 'opencode'
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

function isAssistantTask(value: unknown): value is AssistantTask {
  if (!value || typeof value !== 'object') return false
  const task = value as Record<string, unknown>
  return (
    typeof task.projectId === 'string' &&
    typeof task.projectName === 'string' &&
    typeof task.worktreeId === 'string' &&
    typeof task.worktreePath === 'string' &&
    typeof task.sessionId === 'string' &&
    typeof task.title === 'string'
  )
}

export function getAssistantTasks(db: DatabaseService): AssistantTask[] {
  try {
    const raw = db.getSetting(ASSISTANT_TASKS_KEY)
    if (!raw) return []
    const tasks = JSON.parse(raw) as unknown
    if (!Array.isArray(tasks)) return []
    return tasks.filter(isAssistantTask).filter((task) => (
      Boolean(db.getProject(task.projectId)) &&
      Boolean(db.getWorktree(task.worktreeId)) &&
      Boolean(db.getSession(task.sessionId))
    ))
  } catch {
    return []
  }
}

function recordAssistantTask(db: DatabaseService, task: AssistantTask): void {
  const tasks = [task, ...getAssistantTasks(db).filter((item) => item.sessionId !== task.sessionId)]
  db.setSetting(ASSISTANT_TASKS_KEY, JSON.stringify(tasks.slice(0, 100)))
}

export async function startAssistantMcpService(
  db: DatabaseService,
  sdkManager: AgentSdkManager,
  mainWindow: BrowserWindow
): Promise<void> {
  if (assistantMcpUrl) return

  const makeServer = (): McpServer => {
    const server = new McpServer({ name: 'octob-internal-tools', version: app.getVersion() })

    server.registerTool('list_projects', {
      description: 'List projects registered in Octob. Use this before asking the user which repository a nickname refers to.',
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
      description: 'Show the user an Octob project picker and wait for an explicit selection. When project-scoped work is requested, call list_projects first, then call this tool with every matching project id. This confirmation is mandatory even when there is exactly one match. Do not print a plain-text project list instead. The selected project and its saved assistant memory are returned together.',
      inputSchema: {
        project_ids: z.array(z.string()).min(1),
        question: z.string().min(1).optional()
      }
    }, async ({ project_ids, question }) => {
      const uniqueIds = Array.from(new Set(project_ids))
      const projects = uniqueIds
        .map((projectId) => db.getProject(projectId))
        .filter((project): project is NonNullable<typeof project> => Boolean(project))

      if (projects.length === 0) return text({ error: 'No matching registered projects found' })

      const request: AssistantProjectSelectionRequest = {
        id: randomUUID(),
        question: question?.trim() || 'Sobre qual projeto você quer falar?',
        projects: projects.map((project) => ({
          id: project.id,
          name: project.name,
          description: project.description,
          language: project.language
        }))
      }
      const selectedProjectId = await waitForAssistantProjectSelection(request, mainWindow)
      if (!selectedProjectId) return text({ cancelled: true })

      const selectedProject = db.getProject(selectedProjectId)
      if (!selectedProject) return text({ error: 'Selected project no longer exists' })
      return text({
        selected_project: selectedProject,
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
      description: 'Create an isolated worktree for a user-approved task, create an agent session in it, and send the elaborated prompt. Do not call this while merely listing or researching tasks.',
      inputSchema: {
        project_id: z.string(),
        title: z.string(),
        prompt: z.string().describe('Complete implementation or investigation prompt for the delegated agent')
      }
    }, async ({ project_id, title, prompt }) => {
      const project = db.getProject(project_id)
      if (!project) return text({ error: 'Project not found' })
      const result = await createWorktreeOp(db, {
        projectId: project.id,
        projectPath: project.path,
        projectName: project.name
      })
      if (!result.success || !result.worktree) return text({ error: result.error || 'Worktree creation failed' })

      const agentSdk = readDefaultAgentSdk(db)
      const session = db.createSession({
        worktree_id: result.worktree.id,
        project_id: project.id,
        name: title.slice(0, 120),
        agent_sdk: agentSdk,
        mode: 'plan'
      })
      const implementer = agentSdk === 'opencode' ? openCodeService : sdkManager.getImplementer(agentSdk)
      const connected = await implementer.connect(result.worktree.path, session.id)
      db.updateSession(session.id, { opencode_session_id: connected.sessionId })
      const task: AssistantTask = {
        projectId: project.id,
        projectName: project.name,
        worktreeId: result.worktree.id,
        worktreePath: result.worktree.path,
        sessionId: session.id,
        title
      }

      // Persist and announce the task before starting the long-running prompt.
      // The MCP call must return immediately so the global assistant remains
      // responsive while the delegated agent continues in the background.
      recordAssistantTask(db, task)
      mainWindow.webContents.send('assistant:task-created', task)
      void implementer.prompt(result.worktree.path, connected.sessionId, prompt).catch((error) => {
        log.error(
          'Delegated assistant task failed',
          error instanceof Error ? error : new Error(String(error)),
          { sessionId: session.id, worktreePath: result.worktree!.path }
        )
        db.updateSession(session.id, {
          status: 'error',
          completed_at: new Date().toISOString()
        })
      })
      return text({
        success: true,
        project_id: project.id,
        worktree_id: result.worktree.id,
        session_id: session.id,
        message: 'The delegated agent is running in the new worktree.'
      })
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
