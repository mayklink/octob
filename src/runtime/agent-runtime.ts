import { randomUUID } from 'node:crypto'
import type { DatabaseService } from '../main/db/database'
import type {
  AgentSdkCapabilities,
  AgentSdkId,
  AgentSdkImplementer,
  PromptOptions
} from '../main/services/agent-sdk-types'
import { OPENCODE_CAPABILITIES, TERMINAL_CAPABILITIES } from '../main/services/agent-sdk-types'
import { ClaudeCodeImplementer } from '../main/services/claude-code-implementer'
import { CodexImplementer } from '../main/services/codex-implementer'
import { MistralVibeImplementer } from '../main/services/mistral-vibe-implementer'
import { CursorCliImplementer } from '../main/services/cursor-cli-implementer'
import { AntigravityImplementer } from '../main/services/antigravity-implementer'
import { openCodeService } from '../main/services/opencode-service'
import { resolveClaudeBinaryPath } from '../main/services/claude-binary-resolver'
import {
  resolveCodexBinaryPath,
  resolveConfiguredCodexBinaryPath,
  resolveCodexVoiceResumeCommand,
  setConfiguredCodexBinaryPath,
  supportsCodexAppServer
} from '../main/services/codex-binary-resolver'
import { resolveMistralVibeAcpBinaryPath } from '../main/services/mistral-vibe-binary-resolver'
import { resolveCursorCliAgentBinaryPath } from '../main/services/cursor-cli-binary-resolver'
import {
  getAntigravityVersion,
  resolveAntigravityBinaryPath
} from '../main/services/antigravity-binary-resolver'
import { resolveOpenCodeLaunchSpec } from '../main/services/opencode-binary-resolver'
import { emitAgentStreamEvent } from '../main/services/agent-event-bus'
import { isAssistantWorkspacePath } from '../main/services/assistant-mcp-service'

const GLOBAL_ASSISTANT_CONTEXT = `[Global Assistant Operating Context]
You are Octob's global assistant. This is a clean workspace with no repository context preloaded. Use the internal Octob tools to discover registered projects only when the conversation requires it. Other enabled MCP tools provide external sources.
Interpret the user naturally; do not use canned responses or keyword routing. Reason about ambiguity and ask a concise clarifying question when a project, source, account, or scope is genuinely unclear.
When the user states a durable preference such as where a project's work items live, use remember_project_instruction after resolving the project. Apply saved assistant_instructions in later conversations; if the user retracts or replaces one, use forget_project_instruction and save the replacement.
Use list_projects to resolve a project name or nickname before asking the user, and get_project only after narrowing the target. When the user explicitly asks you to delegate or create a job, that is authorization to create it; do not ask for another approval. Use the project and scope already established in the conversation, and ask only if essential details are still missing. For requests that do not explicitly ask for delegation, decide whether delegating would help; if so, explain the proposed task briefly and wait for the user to choose or approve it before creating the job. In either case, pass a complete prompt that you elaborated for the delegated agent.
You own the jobs you delegate. Call list_delegated_tasks to see them and their state before delegating anything new, and report waiting or finished jobs to the user. For follow-ups, corrections, extra scope, or to unblock a job that is waiting, call send_prompt_to_task with that job's session_id instead of creating another worktree. To start work inside a worktree the user already has open, use delegate_to_existing_worktree.
When a task spans two or more repositories, delegate it once with create_connection_and_delegate so every repository is mounted side by side in a single connection workspace; check list_connections first to reuse an existing one. Never split a cross-repository task into one delegation per repository.
Whenever the user's request requires targeting a specific project, first call list_projects and then call request_project_selection with all matching project ids. This explicit picker is mandatory even when there is exactly one match. Do not assume the sole match and do not present the choices as plain text. After the user selects, use the selected_project and assistant_instructions returned by the tool as the project context. This rule does not apply when the user merely asks to list registered projects without choosing one.
Do not create branches, worktrees, edit code, or start implementation while merely discovering or listing work. First research and present the findings. Wait for the user to choose work before moving into execution, except when the user has explicitly asked you to delegate or create that work, which is sufficient authorization to proceed.
Never claim that a source was searched unless you actually used the corresponding tool or inspected it successfully.

[User Message]
`

type PromptPart =
  | { type: 'text'; text: string }
  | { type: 'file'; mime: string; url: string; filename?: string }

interface PromptOperation {
  operationId: string
  worktreePath: string
  backendSessionId: string
  octobSessionId: string
  state: 'running' | 'completed' | 'failed'
  startedAt: number
  completedAt?: number
  error?: string
}

const PROBE_ORDER: Exclude<AgentSdkId, 'opencode' | 'terminal'>[] = [
  'antigravity',
  'cursor-cli',
  'mistral-vibe',
  'claude-code',
  'codex'
]

export class RuntimeAgentService {
  private readonly implementers = new Map<AgentSdkId, AgentSdkImplementer>()
  private readonly promptOperations = new Map<string, PromptOperation>()
  private readonly claude: ClaudeCodeImplementer
  private readonly codex: CodexImplementer
  private readonly mistral: MistralVibeImplementer
  private readonly cursor: CursorCliImplementer
  private readonly antigravity: AntigravityImplementer
  private readonly availability: Record<string, boolean | string | null>

  constructor(private readonly db: DatabaseService) {
    const claudePath = resolveClaudeBinaryPath()
    const codexPath = resolveCodexBinaryPath()
    const mistralPath = resolveMistralVibeAcpBinaryPath()
    const cursorPath = resolveCursorCliAgentBinaryPath()
    const antigravityPath = resolveAntigravityBinaryPath()
    const openCodeSpec = resolveOpenCodeLaunchSpec()

    this.claude = new ClaudeCodeImplementer()
    this.claude.setDatabaseService(db)
    this.claude.setClaudeBinaryPath(claudePath)

    this.codex = new CodexImplementer()
    this.codex.setDatabaseService(db)
    this.codex.setCodexBinaryPath(codexPath)

    this.mistral = new MistralVibeImplementer()
    this.mistral.setDatabaseService(db)
    this.mistral.setMistralVibeAcpBinaryPath(mistralPath)

    this.cursor = new CursorCliImplementer()
    this.cursor.setDatabaseService(db)
    this.cursor.setCursorCliAgentBinaryPath(cursorPath)

    this.antigravity = new AntigravityImplementer()
    this.antigravity.setDatabaseService(db)
    this.antigravity.setAntigravityBinaryPath(antigravityPath)

    this.implementers.set('claude-code', this.claude)
    this.implementers.set('codex', this.codex)
    this.implementers.set('mistral-vibe', this.mistral)
    this.implementers.set('cursor-cli', this.cursor)
    this.implementers.set('antigravity', this.antigravity)

    openCodeService.setOpenCodeLaunchSpec(openCodeSpec)

    this.availability = {
      opencode: Boolean(openCodeSpec),
      claude: Boolean(claudePath),
      codex: Boolean(codexPath),
      mistralVibe: Boolean(mistralPath),
      cursorCli: Boolean(cursorPath),
      antigravity: Boolean(antigravityPath),
      antigravityVersion: antigravityPath ? getAntigravityVersion(antigravityPath) : null
    }
  }

  detect(): Record<string, boolean | string | null> {
    return { ...this.availability }
  }

  configureCodexBinaryPath(binaryPath: string): {
    success: boolean
    path: string | null
    error?: string
  } {
    const requestedPath = binaryPath.trim()
    setConfiguredCodexBinaryPath(requestedPath || null)

    const configuredPath = requestedPath
      ? resolveConfiguredCodexBinaryPath(requestedPath)
      : null
    const resolvedPath = resolveCodexBinaryPath()
    const resolvedSupportsAppServer = resolvedPath ? supportsCodexAppServer(resolvedPath) : false
    const selectedPath = resolvedSupportsAppServer ? resolvedPath : null
    const configuredIsUsable = Boolean(configuredPath && selectedPath === configuredPath)

    this.codex.setCodexBinaryPath(selectedPath)
    this.availability.codex = Boolean(selectedPath)

    if (requestedPath && !configuredIsUsable) {
      return {
        success: false,
        path: null,
        error: configuredPath
          ? 'The selected Codex binary does not support app-server.'
          : 'The selected Codex binary was not found.'
      }
    }

    return {
      success: Boolean(selectedPath),
      path: selectedPath,
      ...(selectedPath ? {} : { error: 'Codex app-server was not found.' })
    }
  }

  codexVoiceResumeCommand(threadId: string): {
    success: boolean
    command?: { file: string; args: string[] }
    error?: string
  } {
    try {
      return { success: true, command: resolveCodexVoiceResumeCommand(threadId) }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  private sdkForOctobSession(
    octobSessionId: string,
    requestedSdk?: AgentSdkId
  ): AgentSdkId {
    return requestedSdk ?? this.db.getSession(octobSessionId)?.agent_sdk ?? 'opencode'
  }

  private sdkForBackend(worktreePath: string, backendSessionId: string): AgentSdkId {
    const stored = this.db.getAgentSdkForSession(backendSessionId)
    if (stored) return stored

    for (const candidate of PROBE_ORDER) {
      const impl = this.implementers.get(candidate)
      if (impl?.hasBackendSession?.(worktreePath, backendSessionId)) return candidate
    }
    return 'opencode'
  }

  getImplementer(sdk: AgentSdkId): AgentSdkImplementer {
    const implementer = this.implementers.get(sdk)
    if (!implementer) {
      throw new Error(`Agent SDK is not available in runtime: ${sdk}`)
    }
    return implementer
  }

  async connect(worktreePath: string, octobSessionId: string, requestedSdk?: AgentSdkId) {
    const sdk = this.sdkForOctobSession(octobSessionId, requestedSdk)
    if (sdk === 'terminal') return { success: true, sessionId: octobSessionId }
    if (sdk === 'opencode') {
      const result = await openCodeService.connect(worktreePath, octobSessionId)
      return { success: true, ...result }
    }
    const result = await this.getImplementer(sdk)!.connect(worktreePath, octobSessionId)
    return { success: true, ...result }
  }

  async reconnect(worktreePath: string, backendSessionId: string, octobSessionId: string) {
    const sdk = this.sdkForBackend(worktreePath, backendSessionId)
    if (sdk === 'terminal') return { success: true, sessionStatus: 'idle' as const }
    if (sdk === 'opencode') {
      return openCodeService.reconnect(worktreePath, backendSessionId, octobSessionId)
    }
    return this.getImplementer(sdk)!.reconnect(worktreePath, backendSessionId, octobSessionId)
  }

  async prompt(
    worktreePath: string,
    backendSessionId: string,
    message: string | PromptPart[],
    model?: { providerID: string; modelID: string; variant?: string },
    options?: PromptOptions
  ) {
    // The desktop IPC path injects this operating contract for the global
    // assistant. The web runtime sends prompts through this service instead,
    // so give Codex the same delegation instructions here.
    const promptMessage = isAssistantWorkspacePath(worktreePath)
      ? typeof message === 'string'
        ? GLOBAL_ASSISTANT_CONTEXT + message
        : message.map((part) =>
            part.type === 'text'
              ? { ...part, text: GLOBAL_ASSISTANT_CONTEXT + part.text }
              : part
          )
      : message
    const sdk = this.sdkForBackend(worktreePath, backendSessionId)
    if (sdk === 'terminal') return { success: false, error: 'terminal_session' }
    if (sdk === 'opencode') {
      await openCodeService.prompt(worktreePath, backendSessionId, promptMessage, model)
      return { success: true }
    }
    await this.getImplementer(sdk)!.prompt(worktreePath, backendSessionId, promptMessage, model, options)
    return { success: true }
  }

  /**
   * Start a prompt without holding the browser's HTTP connection until the
   * provider finishes. Provider events and approval requests continue through
   * the agent stream while this operation runs.
   */
  startPrompt(
    worktreePath: string,
    backendSessionId: string,
    octobSessionId: string,
    message: string | PromptPart[],
    model?: { providerID: string; modelID: string; variant?: string },
    options?: PromptOptions
  ): { success: boolean; accepted: boolean; operationId?: string; error?: string } {
    const active = [...this.promptOperations.values()].find(
      (operation) =>
        operation.state === 'running' &&
        operation.worktreePath === worktreePath &&
        operation.backendSessionId === backendSessionId
    )
    if (active) {
      return {
        success: false,
        accepted: false,
        operationId: active.operationId,
        error: 'prompt_in_progress'
      }
    }

    const operation: PromptOperation = {
      operationId: randomUUID(),
      worktreePath,
      backendSessionId,
      octobSessionId,
      state: 'running',
      startedAt: Date.now()
    }
    this.promptOperations.set(operation.operationId, operation)

    void this.prompt(worktreePath, backendSessionId, message, model, options)
      .then(() => {
        operation.state = 'completed'
        operation.completedAt = Date.now()
      })
      .catch((error) => {
        const messageText = error instanceof Error ? error.message : String(error)
        operation.state = 'failed'
        operation.completedAt = Date.now()
        operation.error = messageText
        emitAgentStreamEvent({
          type: 'session.error',
          sessionId: octobSessionId,
          data: { error: messageText, operationId: operation.operationId }
        })
      })
      .finally(() => {
        const cleanup = setTimeout(() => this.promptOperations.delete(operation.operationId), 10 * 60_000)
        cleanup.unref?.()
      })

    return {
      success: true,
      accepted: true,
      operationId: operation.operationId
    }
  }

  getPromptOperation(operationId: string): PromptOperation | null {
    return this.promptOperations.get(operationId) ?? null
  }

  async abort(worktreePath: string, backendSessionId: string) {
    const sdk = this.sdkForBackend(worktreePath, backendSessionId)
    const value = sdk === 'opencode'
      ? await openCodeService.abort(worktreePath, backendSessionId)
      : sdk === 'terminal'
        ? false
        : await this.getImplementer(sdk)!.abort(worktreePath, backendSessionId)
    return { success: value }
  }

  async startCodexVoice(sessionId: string, sdp: string) {
    return this.codex.startVoice(sessionId, sdp)
  }

  async stopCodexVoice(sessionId: string) {
    return this.codex.stopVoice(sessionId)
  }

  async disconnect(worktreePath: string, backendSessionId: string) {
    const sdk = this.sdkForBackend(worktreePath, backendSessionId)
    if (sdk === 'opencode') {
      await openCodeService.disconnect(worktreePath, backendSessionId)
    } else if (sdk !== 'terminal') {
      await this.getImplementer(sdk)!.disconnect(worktreePath, backendSessionId)
    }
    return { success: true }
  }

  async getMessages(worktreePath: string, backendSessionId: string) {
    const sdk = this.sdkForBackend(worktreePath, backendSessionId)
    const messages = sdk === 'opencode'
      ? await openCodeService.getMessages(worktreePath, backendSessionId)
      : sdk === 'terminal'
        ? []
        : await this.getImplementer(sdk)!.getMessages(worktreePath, backendSessionId)
    return { success: true, messages }
  }

  async listModels(sdk: AgentSdkId = 'opencode') {
    if (sdk === 'terminal') return { success: true, providers: {} }
    const providers = sdk === 'opencode'
      ? await openCodeService.getAvailableModels()
      : await this.getImplementer(sdk)!.getAvailableModels()
    return { success: true, providers }
  }

  setModel(model: {
    providerID: string
    modelID: string
    variant?: string
    agentSdk?: AgentSdkId
  } | null) {
    if (!model) {
      openCodeService.clearSelectedModel()
      return { success: true }
    }
    const sdk = model.agentSdk ?? 'opencode'
    if (sdk === 'opencode') openCodeService.setSelectedModel(model)
    else if (sdk !== 'terminal') this.getImplementer(sdk)!.setSelectedModel(model)
    return { success: true }
  }

  async modelInfo(worktreePath: string, modelId: string, sdk: AgentSdkId = 'opencode') {
    if (sdk === 'terminal') return { success: true, model: null }
    const model = sdk === 'opencode'
      ? await openCodeService.getModelInfo(worktreePath, modelId)
      : await this.getImplementer(sdk)!.getModelInfo(worktreePath, modelId)
    return { success: true, model }
  }

  capabilities(backendSessionId?: string): {
    success: true
    capabilities: AgentSdkCapabilities
  } {
    const sdk = backendSessionId
      ? this.db.getAgentSdkForSession(backendSessionId) ?? 'opencode'
      : 'opencode'
    if (sdk === 'opencode') return { success: true, capabilities: OPENCODE_CAPABILITIES }
    if (sdk === 'terminal') return { success: true, capabilities: TERMINAL_CAPABILITIES }
    return { success: true, capabilities: this.getImplementer(sdk)!.capabilities }
  }

  async sessionInfo(worktreePath: string, backendSessionId: string) {
    const sdk = this.sdkForBackend(worktreePath, backendSessionId)
    if (sdk === 'terminal') {
      return { success: true, revertMessageID: null, revertDiff: null }
    }
    const result = sdk === 'opencode'
      ? await openCodeService.getSessionInfo(worktreePath, backendSessionId)
      : await this.getImplementer(sdk)!.getSessionInfo(worktreePath, backendSessionId)
    return { success: true, ...result }
  }

  async cleanup(): Promise<void> {
    await Promise.allSettled([...this.implementers.values()].map((impl) => impl.cleanup()))
    await openCodeService.cleanup()
  }

  async questionReply(requestId: string, answers: string[][], worktreePath?: string) {
    const candidates = [this.claude, this.codex, this.mistral, this.cursor]
    for (const impl of candidates) {
      const withPending = impl as unknown as {
        hasPendingQuestion?: (id: string) => boolean
        questionReply: AgentSdkImplementer['questionReply']
      }
      if (withPending.hasPendingQuestion?.(requestId)) {
        await withPending.questionReply(requestId, answers, worktreePath)
        return { success: true }
      }
    }
    await openCodeService.questionReply(requestId, answers, worktreePath)
    return { success: true }
  }

  async questionReject(requestId: string, worktreePath?: string) {
    const candidates = [this.claude, this.codex, this.mistral, this.cursor]
    for (const impl of candidates) {
      const withPending = impl as unknown as {
        hasPendingQuestion?: (id: string) => boolean
        questionReject: AgentSdkImplementer['questionReject']
      }
      if (withPending.hasPendingQuestion?.(requestId)) {
        await withPending.questionReject(requestId, worktreePath)
        return { success: true }
      }
    }
    await openCodeService.questionReject(requestId, worktreePath)
    return { success: true }
  }

  async permissionReply(
    requestId: string,
    reply: 'once' | 'always' | 'reject',
    worktreePath?: string,
    message?: string
  ) {
    const candidates = [this.codex, this.mistral, this.cursor]
    for (const impl of candidates) {
      const withPending = impl as unknown as {
        hasPendingApproval?: (id: string) => boolean
        permissionReply: AgentSdkImplementer['permissionReply']
      }
      if (withPending.hasPendingApproval?.(requestId)) {
        await withPending.permissionReply(requestId, reply, worktreePath)
        return { success: true }
      }
    }
    await openCodeService.permissionReply(requestId, reply, worktreePath, message)
    return { success: true }
  }

  async permissionList(worktreePath?: string) {
    let permissions: unknown[] = []
    try {
      permissions = await openCodeService.permissionList(worktreePath)
    } catch {
      permissions = []
    }
    try {
      permissions.push(...await this.codex.permissionList(worktreePath))
    } catch {
      // no active Codex approval
    }
    return { success: true, permissions }
  }

  async planApprove(
    worktreePath: string,
    octobSessionId: string,
    requestId?: string
  ) {
    if (
      (requestId && this.claude.hasPendingPlan(requestId)) ||
      this.claude.hasPendingPlanForSession(octobSessionId)
    ) {
      await this.claude.planApprove(worktreePath, octobSessionId, requestId)
      return { success: true }
    }
    return { success: false, error: 'No pending plan found' }
  }

  async planReject(
    worktreePath: string,
    octobSessionId: string,
    feedback: string,
    requestId?: string
  ) {
    if (
      (requestId && this.claude.hasPendingPlan(requestId)) ||
      this.claude.hasPendingPlanForSession(octobSessionId)
    ) {
      await this.claude.planReject(worktreePath, octobSessionId, feedback, requestId)
      return { success: true }
    }
    return { success: false, error: 'No pending plan found' }
  }

  commandApprovalReply(
    requestId: string,
    approved: boolean,
    remember?: 'allow' | 'block',
    pattern?: string,
    patterns?: string[]
  ) {
    this.claude.handleApprovalReply(requestId, approved, remember, pattern, patterns)
    return { success: true }
  }

  private octobSessionIdForBackend(backendSessionId: string): string {
    return this.db.getSessionByOpenCodeSessionId(backendSessionId)?.id ?? backendSessionId
  }

  async undo(worktreePath: string, backendSessionId: string) {
    const sdk = this.sdkForBackend(worktreePath, backendSessionId)
    const octobSessionId = this.octobSessionIdForBackend(backendSessionId)
    try {
      const result = sdk === 'opencode'
        ? await openCodeService.undo(worktreePath, backendSessionId)
        : sdk === 'terminal'
          ? null
          : await this.getImplementer(sdk)!.undo(worktreePath, backendSessionId, octobSessionId)
      return result
        ? { success: true, ...(result as Record<string, unknown>) }
        : { success: false, error: 'sdk_not_supported' }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  async redo(worktreePath: string, backendSessionId: string) {
    const sdk = this.sdkForBackend(worktreePath, backendSessionId)
    const octobSessionId = this.octobSessionIdForBackend(backendSessionId)
    try {
      const result = sdk === 'opencode'
        ? await openCodeService.redo(worktreePath, backendSessionId)
        : sdk === 'terminal'
          ? null
          : await this.getImplementer(sdk)!.redo(worktreePath, backendSessionId, octobSessionId)
      return result
        ? { success: true, ...(result as Record<string, unknown>) }
        : { success: false, error: 'sdk_not_supported' }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  async commands(worktreePath: string, backendSessionId?: string) {
    const sdk = backendSessionId
      ? this.sdkForBackend(worktreePath, backendSessionId)
      : 'opencode'
    const commands = sdk === 'opencode'
      ? await openCodeService.listCommands(worktreePath)
      : sdk === 'terminal'
        ? []
        : await this.getImplementer(sdk)!.listCommands(worktreePath)
    return { success: true, commands }
  }

  async command(
    worktreePath: string,
    backendSessionId: string,
    command: string,
    args?: string
  ) {
    const sdk = this.sdkForBackend(worktreePath, backendSessionId)
    if (sdk === 'terminal') return { success: false, error: 'terminal_session' }
    if (sdk === 'opencode') {
      await openCodeService.sendCommand(worktreePath, backendSessionId, command, args ?? '')
    } else {
      await this.getImplementer(sdk)!.sendCommand(worktreePath, backendSessionId, command, args)
    }
    return { success: true }
  }

  async renameSession(
    backendSessionId: string,
    title: string,
    worktreePath = ''
  ) {
    const sdk = this.sdkForBackend(worktreePath, backendSessionId)
    if (sdk === 'opencode') {
      await openCodeService.renameSession(backendSessionId, title, worktreePath)
    } else if (sdk !== 'terminal') {
      await this.getImplementer(sdk)!.renameSession(worktreePath, backendSessionId, title)
    }
    return { success: true }
  }

  async steer(worktreePath: string, backendSessionId: string, message: string) {
    const sdk = this.sdkForBackend(worktreePath, backendSessionId)
    if (sdk !== 'codex') return { success: false, error: 'sdk_not_supported' }
    const result = await this.codex.steer(worktreePath, backendSessionId, message)
    return {
      success: result.steered,
      error: result.error,
      insertedMessageId: result.insertedMessageId,
      nextAssistantMessageId: result.nextAssistantMessageId,
      turnId: result.turnId
    }
  }

  async fork(worktreePath: string, backendSessionId: string, messageId?: string) {
    const sdk = this.sdkForBackend(worktreePath, backendSessionId)
    if (sdk !== 'opencode') return { success: false, error: 'sdk_not_supported' }
    const result = await openCodeService.forkSession(worktreePath, backendSessionId, messageId)
    return { success: true, ...result }
  }
}
