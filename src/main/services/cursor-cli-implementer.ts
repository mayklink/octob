import type { BrowserWindow } from 'electron'
import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio
} from 'node:child_process'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { Writable, Readable } from 'node:stream'
import { dirname, extname, relative, resolve as resolveFs } from 'node:path'

import type {
  Client,
  PromptResponse,
  ReadTextFileRequest,
  WriteTextFileRequest,
  PermissionOptionKind,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification
} from '@agentclientprotocol/sdk'
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'

import type { AgentSdkImplementer, PromptOptions } from './agent-sdk-types'
import { CURSOR_CLI_CAPABILITIES } from './agent-sdk-types'
import { createLogger } from './logger'
import type { DatabaseService } from '../db/database'
import { getUserEnvironmentVariables } from './env-vars'
import { getConfiguredMcpServers } from './mcp-settings'
import type { OpenCodeStreamEvent } from '@shared/types/opencode'
import {
  getAvailableCursorCliModels,
  getCursorCliModelInfo,
  CURSOR_CLI_DEFAULT_MODEL_ID,
  invalidateCursorCliModelResolutionCache,
  normalizeCursorCliModelIdentity
} from './cursor-cli-models'
import {
  acpTranscriptAppendAssistantReasoningChunk,
  acpTranscriptAppendAssistantTextChunk,
  acpTranscriptAppendUserTurn,
  acpTranscriptRecordToolCall,
  acpTranscriptUpdateToolCall
} from './acp-session-transcript'

const log = createLogger({ component: 'CursorCliImplementer' })

interface CursorCliSessionState {
  octobSessionId: string
  worktreePath: string
  acpSessionId: string
  child: ChildProcessWithoutNullStreams
  connection: ClientSideConnection
  messages: unknown[]
}

interface PendingPermission {
  octobSessionId: string
  worktreePath: string
  request: RequestPermissionRequest
  resolve: (value: RequestPermissionResponse) => void
}

function toTextDeltaStreamEvent(sessionIdOctob: string, text: string): OpenCodeStreamEvent {
  return {
    type: 'message.part.updated',
    sessionId: sessionIdOctob,
    data: {
      part: { type: 'text', text },
      delta: text
    }
  }
}

function toReasoningDeltaStreamEvent(sessionIdOctob: string, text: string): OpenCodeStreamEvent {
  return {
    type: 'message.part.updated',
    sessionId: sessionIdOctob,
    data: {
      part: { type: 'reasoning', text },
      delta: text
    }
  }
}

function assertPathUnderWorkspace(workspaceRoot: string, absoluteTarget: string): void {
  const root = resolveFs(workspaceRoot)
  const resolved = resolveFs(absoluteTarget)
  const rel = relative(root, resolved)
  if (rel.startsWith('..') || rel === '..') {
    throw new Error(`Path escapes workspace root: ${absoluteTarget}`)
  }
}

/** Windows: `spawn` cannot execute `.cmd`/`.bat` directly — it returns EINVAL without a shell. */
function quoteForCmdExe(pathToBinary: string): string {
  if (!/[ \t&^]/.test(pathToBinary)) {
    return pathToBinary
  }
  return `"${pathToBinary.replace(/"/g, '""')}"`
}

function spawnCursorAgentAcp(
  binary: string,
  options: SpawnOptionsWithoutStdio & { stdio: ['pipe', 'pipe', 'pipe'] }
): ChildProcessWithoutNullStreams {
  const ext = extname(binary).toLowerCase()
  const wrapInCmd = process.platform === 'win32' && (ext === '.cmd' || ext === '.bat')

  if (wrapInCmd) {
    const comSpec = process.env.ComSpec || 'cmd.exe'
    const line = `${quoteForCmdExe(binary)} acp`
    return spawn(comSpec, ['/d', '/s', '/c', line], options) as ChildProcessWithoutNullStreams
  }

  return spawn(binary, ['acp'], options) as ChildProcessWithoutNullStreams
}

export class CursorCliImplementer implements AgentSdkImplementer {
  readonly id = 'cursor-cli' as const
  readonly capabilities = CURSOR_CLI_CAPABILITIES

  private mainWindow: BrowserWindow | null = null
  private dbService: DatabaseService | null = null
  private cursorAgentBinaryPath: string | null = null
  private selectedModelID: string = CURSOR_CLI_DEFAULT_MODEL_ID
  private selectedVariant: string | undefined

  private sessions = new Map<string, CursorCliSessionState>()
  private pendingPermissions = new Map<string, PendingPermission>()
  /** Coalesces concurrent `connect()` for the same Hive UI session (double IPC before first finishes). */
  private octobConnectInFlight = new Map<string, Promise<{ sessionId: string }>>()

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  setDatabaseService(db: DatabaseService): void {
    this.dbService = db
  }

  setCursorCliAgentBinaryPath(pathValue: string | null): void {
    if (pathValue !== this.cursorAgentBinaryPath) {
      invalidateCursorCliModelResolutionCache()
    }
    this.cursorAgentBinaryPath = pathValue
  }

  hasPendingQuestion(requestId: string): boolean {
    void requestId
    return false
  }

  hasPendingApproval(requestId: string): boolean {
    return this.pendingPermissions.has(requestId)
  }

  private sendToRenderer(channel: string, data: unknown): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data)
    } else {
      log.debug('sendToRenderer: no window')
    }
  }

  private getSessionKey(worktreePath: string, agentSessionId: string): string {
    return `${worktreePath}::${agentSessionId}`
  }

  hasBackendSession(worktreePath: string, agentSessionId: string): boolean {
    return this.sessions.has(this.getSessionKey(worktreePath, agentSessionId))
  }

  private async openAcpSession(params: {
    worktreePath: string
    octobSessionId: string
    resumeAcpSessionId?: string | null
  }): Promise<{ connection: ClientSideConnection; child: ChildProcessWithoutNullStreams; acpSessionId: string }> {
    const binary =
      this.cursorAgentBinaryPath ??
      (() => {
        throw new Error(
          'Cursor CLI is not installed. Install Cursor CLI and ensure `agent` is on PATH (`agent acp`; see Cursor CLI docs).'
        )
      })()

    const child = spawnCursorAgentAcp(binary, {
      cwd: params.worktreePath,
      env: {
        ...process.env,
        ...getUserEnvironmentVariables(this.dbService)
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      const line = chunk.toString('utf-8').trim().slice(0, 800)
      if (line) {
        log.warn('cursor agent stderr', { line })
      }
    })

    child.on('error', (err) => {
      log.error('cursor agent process error', { error: err instanceof Error ? err.message : String(err) })
    })

    const stream = ndJsonStream(
      Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>
    )

    const connection = new ClientSideConnection(() => this.buildAcpClient(), stream)

    await connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: {
        name: 'octob',
        title: 'Octob',
        version: app.getVersion()
      },
      clientCapabilities: {
        fs: {
          readTextFile: true,
          writeTextFile: true
        }
      }
    })

    try {
      await connection.authenticate({ methodId: 'cursor_login' })
    } catch (err) {
      log.warn('Cursor CLI authenticate did not complete (run `agent login` or set CURSOR_API_KEY)', {
        message: err instanceof Error ? err.message : String(err)
      })
    }

    const mcpServers = getConfiguredMcpServers(this.dbService)
    let acpSessionId: string

    if (params.resumeAcpSessionId) {
      await connection.resumeSession({
        cwd: params.worktreePath,
        sessionId: params.resumeAcpSessionId,
        mcpServers
      })
      acpSessionId = params.resumeAcpSessionId
    } else {
      const created = await connection.newSession({ cwd: params.worktreePath, mcpServers })
      acpSessionId = created.sessionId
    }

    try {
      await connection.unstable_setSessionModel({
        sessionId: acpSessionId,
        modelId: this.selectedModelID
      })
    } catch {
      log.debug('unstable_setSessionModel unsupported or rejected; keeping Cursor default model', {
        modelId: this.selectedModelID
      })
    }

    return { connection, child, acpSessionId }
  }

  private async handleCursorExtensionMethod(
    method: string,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    if (method === 'cursor/ask_question') {
      const questions = params.questions as
        | Array<{ id: string; options?: Array<{ id: string }> }>
        | undefined
      const answers = (questions ?? []).map((q) => ({
        questionId: q.id,
        selectedOptionIds: q.options?.[0]?.id ? [q.options[0].id] : []
      }))
      return { outcome: { outcome: 'answered', answers } }
    }
    if (method === 'cursor/create_plan') {
      return { outcome: { outcome: 'accepted' } }
    }

    log.debug('Cursor CLI: unhandled ACP extension request from agent', { method })
    return {}
  }

  private buildAcpClient(): Client {
    return {
      sessionUpdate: async (notification: SessionNotification) => this.onSessionNotification(notification),
      requestPermission: async (req: RequestPermissionRequest) =>
        this.onRequestPermissionAwaitUser(req),

      readTextFile: async (params: ReadTextFileRequest) => {
        const state = this.findSessionByAcpId(params.sessionId)
        assertPathUnderWorkspace(state.worktreePath, params.path)
        const content = await readFile(params.path, 'utf-8')
        return { content }
      },

      writeTextFile: async (params: WriteTextFileRequest) => {
        const state = this.findSessionByAcpId(params.sessionId)
        assertPathUnderWorkspace(state.worktreePath, params.path)
        await mkdir(dirname(params.path), { recursive: true })
        await writeFile(params.path, params.content, 'utf-8')
        return {}
      },

      extMethod: async (method: string, p: Record<string, unknown>) =>
        this.handleCursorExtensionMethod(method, p),

      extNotification: async (_method: string, _params: Record<string, unknown>): Promise<void> => {
        void _method
        void _params
      }
    }
  }

  private findSessionByAcpId(acpSessionId: string): CursorCliSessionState {
    for (const s of this.sessions.values()) {
      if (s.acpSessionId === acpSessionId) return s
    }
    throw new Error(`Cursor CLI: unknown ACP session id ${acpSessionId}`)
  }

  private async onSessionNotification(params: SessionNotification): Promise<void> {
    let state: CursorCliSessionState | undefined
    try {
      state = this.findSessionByAcpId(params.sessionId)
    } catch {
      return
    }

    const u = params.update
    switch (u.sessionUpdate) {
      case 'agent_message_chunk': {
        const c = u.content as { type?: string; text?: string }
        const t = typeof c.text === 'string' ? c.text : ''
        if (
          t.length > 0 &&
          (c.type === 'text' || c.type === 'markdown' || c.type === undefined || c.type === null)
        ) {
          acpTranscriptAppendAssistantTextChunk(state.messages, t, c.type ?? null)
          this.sendToRenderer('opencode:stream', toTextDeltaStreamEvent(state.octobSessionId, t))
        }
        break
      }
      case 'agent_thought_chunk': {
        const c = u.content as { type?: string; text?: string }
        const t = typeof c.text === 'string' ? c.text : ''
        if (t.length > 0) {
          acpTranscriptAppendAssistantReasoningChunk(state.messages, t)
          this.sendToRenderer('opencode:stream', toReasoningDeltaStreamEvent(state.octobSessionId, t))
        }
        break
      }
      case 'tool_call': {
        const tcp = u
        acpTranscriptRecordToolCall(state.messages, tcp.toolCallId, tcp.title ?? 'tool', tcp.rawInput)

        /** ACP can send terminal `completed`/`failed` on the initial notification without a separate `tool_call_update` */
        const acpDone = tcp.status === 'completed' || tcp.status === 'failed'
        if (acpDone) {
          acpTranscriptUpdateToolCall(
            state.messages,
            tcp.toolCallId,
            tcp.title ?? 'tool',
            tcp.status === 'completed' ? 'completed' : 'failed',
            tcp.rawOutput,
            undefined
          )
        }

        const streamToolStatus =
          tcp.status === 'completed'
            ? ('completed' as const)
            : tcp.status === 'failed'
              ? ('error' as const)
              : ('running' as const)

        const streamState: Record<string, unknown> = { status: streamToolStatus }
        if (tcp.rawInput !== undefined) streamState.input = tcp.rawInput
        if (tcp.rawOutput !== undefined) streamState.output = tcp.rawOutput

        this.sendToRenderer('opencode:stream', {
          type: 'message.part.updated',
          sessionId: state.octobSessionId,
          data: {
            part: {
              type: 'tool',
              callID: tcp.toolCallId,
              tool: tcp.title ?? 'tool',
              state: streamState
            },
            delta: ''
          }
        })
        break
      }
      case 'tool_call_update': {
        const transcriptStatus =
          u.status === 'completed'
            ? ('completed' as const)
            : u.status === 'failed'
              ? ('failed' as const)
              : ('running' as const)
        const streamToolStatus =
          transcriptStatus === 'failed'
            ? 'error'
            : transcriptStatus === 'completed'
              ? 'completed'
              : 'running'
        acpTranscriptUpdateToolCall(
          state.messages,
          u.toolCallId,
          u.title ?? 'tool',
          transcriptStatus,
          u.rawOutput,
          u.rawInput
        )
        const streamState: Record<string, unknown> = { status: streamToolStatus }
        if (u.rawInput !== undefined) streamState.input = u.rawInput
        if (u.rawOutput !== undefined) streamState.output = u.rawOutput

        this.sendToRenderer('opencode:stream', {
          type: 'message.part.updated',
          sessionId: state.octobSessionId,
          data: {
            part: {
              type: 'tool',
              callID: u.toolCallId,
              tool: u.title ?? 'tool',
              state: streamState
            },
            delta: ''
          }
        })
        break
      }
      default:
        break
    }
  }

  private async onRequestPermissionAwaitUser(req: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    const state = this.findSessionByAcpId(req.sessionId)
    const requestId = randomUUID()

    return await new Promise<RequestPermissionResponse>((resolve) => {
      this.pendingPermissions.set(requestId, {
        octobSessionId: state.octobSessionId,
        worktreePath: state.worktreePath,
        request: req,
        resolve
      })

      const toolTitle = req.toolCall.title ?? req.toolCall.toolCallId
      const permission =
        req.toolCall.kind === 'execute'
          ? 'bash'
          : req.toolCall.kind === 'read'
            ? 'read'
            : req.toolCall.kind === 'edit' || req.toolCall.kind === 'delete'
              ? 'edit'
              : 'unknown'

      this.sendToRenderer('opencode:stream', {
        type: 'permission.asked',
        sessionId: state.octobSessionId,
        data: {
          id: requestId,
          sessionID: state.octobSessionId,
          permission,
          patterns: [toolTitle],
          metadata: { toolTitle, toolCallId: req.toolCall.toolCallId },
          always: []
        }
      })
    })
  }

  private pickOptionKindForHiveDecision(decision: 'once' | 'always' | 'reject'): PermissionOptionKind {
    if (decision === 'reject') return 'reject_once'
    if (decision === 'always') return 'allow_always'
    return 'allow_once'
  }

  private mapHivePermissionToResponse(
    request: RequestPermissionRequest,
    decision: 'once' | 'always' | 'reject'
  ): RequestPermissionResponse {
    if (decision === 'reject') {
      const rejectOpt =
        request.options.find((o) => o.kind === 'reject_once' || o.kind === 'reject_always') ?? null
      if (rejectOpt) {
        return { outcome: { outcome: 'selected', optionId: rejectOpt.optionId } }
      }
      return { outcome: { outcome: 'cancelled' } }
    }

    const wantKind = this.pickOptionKindForHiveDecision(decision)
    let match =
      request.options.find((o) => o.kind === wantKind) ?? request.options.find((o) => o.kind === 'allow_once')

    if (!match && decision === 'always') {
      match =
        request.options.find((o) => o.kind === 'allow_always') ??
        request.options.find((o) => o.kind === 'allow_once')
    }

    if (!match) {
      return { outcome: { outcome: 'cancelled' } }
    }
    return { outcome: { outcome: 'selected', optionId: match.optionId } }
  }

  private findSessionForOctobWorktree(
    worktreePath: string,
    octobSessionId: string
  ): CursorCliSessionState | undefined {
    for (const sess of this.sessions.values()) {
      if (sess.worktreePath === worktreePath && sess.octobSessionId === octobSessionId) {
        return sess
      }
    }
    return undefined
  }

  private octobConnectLockKey(worktreePath: string, octobSessionId: string): string {
    return `${worktreePath}\0${octobSessionId}`
  }

  private async performFreshConnect(
    worktreePath: string,
    octobSessionId: string
  ): Promise<{ sessionId: string }> {
    const { connection, child, acpSessionId } = await this.openAcpSession({
      worktreePath,
      octobSessionId,
      resumeAcpSessionId: null
    })

    const key = this.getSessionKey(worktreePath, acpSessionId)
    this.sessions.set(key, {
      octobSessionId,
      worktreePath,
      acpSessionId,
      child,
      connection,
      messages: []
    })

    this.sendToRenderer('opencode:stream', {
      type: 'session.materialized',
      sessionId: octobSessionId,
      data: { newSessionId: acpSessionId, wasFork: false }
    })

    log.info('Cursor CLI connected', { worktreePath, octobSessionId, acpSessionId })
    return { sessionId: acpSessionId }
  }

  async connect(worktreePath: string, octobSessionId: string): Promise<{ sessionId: string }> {
    const existing = this.findSessionForOctobWorktree(worktreePath, octobSessionId)
    if (existing) {
      log.debug('Cursor CLI connect: reusing existing backend session (duplicate IPC connect)', {
        worktreePath,
        octobSessionId,
        acpSessionId: existing.acpSessionId
      })
      return { sessionId: existing.acpSessionId }
    }

    const lockKey = this.octobConnectLockKey(worktreePath, octobSessionId)
    const inflight = this.octobConnectInFlight.get(lockKey)
    if (inflight) {
      log.debug('Cursor CLI connect: coalescing with in-flight connect (same Octob session)', {
        worktreePath,
        octobSessionId
      })
      return inflight
    }

    const flight = this.performFreshConnect(worktreePath, octobSessionId).finally(() => {
      this.octobConnectInFlight.delete(lockKey)
    })

    this.octobConnectInFlight.set(lockKey, flight)
    return flight
  }

  async reconnect(
    worktreePath: string,
    agentSessionId: string,
    octobSessionId: string
  ): Promise<{
    success: boolean
    sessionStatus?: 'idle' | 'busy' | 'retry'
    revertMessageID?: string | null
  }> {
    const key = this.getSessionKey(worktreePath, agentSessionId)

    const existing = this.sessions.get(key)
    if (existing) {
      existing.octobSessionId = octobSessionId
      return { success: true, sessionStatus: 'idle', revertMessageID: null }
    }

    try {
      const { connection, child, acpSessionId } = await this.openAcpSession({
        worktreePath,
        octobSessionId,
        resumeAcpSessionId: agentSessionId
      })

      const newKey = this.getSessionKey(worktreePath, acpSessionId)
      this.sessions.set(newKey, {
        octobSessionId,
        worktreePath,
        acpSessionId,
        child,
        connection,
        messages: []
      })

      this.sendToRenderer('opencode:stream', {
        type: 'session.materialized',
        sessionId: octobSessionId,
        data: { newSessionId: acpSessionId, wasFork: false }
      })

      return { success: true, sessionStatus: 'idle', revertMessageID: null }
    } catch (err) {
      log.warn('Cursor CLI reconnect failed', {
        agentSessionId,
        error: err instanceof Error ? err.message : String(err)
      })
      return { success: false }
    }
  }

  async disconnect(worktreePath: string, agentSessionId: string): Promise<void> {
    const key = this.getSessionKey(worktreePath, agentSessionId)
    const sess = this.sessions.get(key)
    if (!sess) return

    try {
      await sess.connection.closeSession({ sessionId: sess.acpSessionId })
    } catch {
      // ignore — agent may already be gone
    }

    sess.child.kill()
    this.sessions.delete(key)
    log.info('Cursor CLI disconnected', { worktreePath, agentSessionId })
  }

  async cleanup(): Promise<void> {
    const entries = [...this.sessions.entries()]
    for (const [, sess] of entries) {
      try {
        await sess.connection.closeSession({ sessionId: sess.acpSessionId })
      } catch {
        /* empty */
      }
      sess.child.kill()
    }
    this.sessions.clear()
    log.info('Cursor CLI cleanup completed')
  }

  async prompt(
    worktreePath: string,
    agentSessionId: string,
    message:
      | string
      | Array<
          { type: 'text'; text: string } | { type: 'file'; mime: string; url: string; filename?: string }
        >,
    modelOverride?: { providerID: string; modelID: string; variant?: string },
    _options?: PromptOptions
  ): Promise<void> {
    const key = this.getSessionKey(worktreePath, agentSessionId)
    const sess = this.sessions.get(key)
    if (!sess) {
      throw new Error(`Cursor CLI prompt: unknown session ${agentSessionId}`)
    }

    if (modelOverride?.modelID && modelOverride.modelID.trim()) {
      const normalized =
        normalizeCursorCliModelIdentity(modelOverride.modelID) ?? modelOverride.modelID.trim()
      this.selectedModelID = normalized
      try {
        await sess.connection.unstable_setSessionModel({
          sessionId: sess.acpSessionId,
          modelId: this.selectedModelID
        })
      } catch {
        /* keep previous */
      }
    }

    let text = ''
    if (typeof message === 'string') {
      text = message
    } else {
      text = message
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('\n')
      const hasFiles = message.some((p) => p.type === 'file')
      if (hasFiles) {
        log.warn(
          'Cursor CLI: file attachments in prompts are not fully mapped via ACP; text-only slice used.'
        )
      }
    }

    acpTranscriptAppendUserTurn(sess.messages, text)

    this.sendToRenderer('opencode:stream', {
      type: 'session.status',
      sessionId: sess.octobSessionId,
      data: { status: { type: 'busy' } },
      statusPayload: { type: 'busy' }
    })

    try {
      const response: PromptResponse = await sess.connection.prompt({
        sessionId: sess.acpSessionId,
        prompt: [{ type: 'text', text }]
      })

      const stopReason = response.stopReason
      if (stopReason === 'cancelled') {
        this.sendToRenderer('opencode:stream', {
          type: 'session.error',
          sessionId: sess.octobSessionId,
          data: { error: 'Turn cancelled.' }
        })
      }

      if (stopReason === 'refusal') {
        this.sendToRenderer('opencode:stream', {
          type: 'session.error',
          sessionId: sess.octobSessionId,
          data: { error: 'The model declined to proceed.' }
        })
      }

      this.sendToRenderer('opencode:stream', {
        type: 'session.status',
        sessionId: sess.octobSessionId,
        data: { status: { type: 'idle' } },
        statusPayload: { type: 'idle' }
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.sendToRenderer('opencode:stream', {
        type: 'session.error',
        sessionId: sess.octobSessionId,
        data: { error: msg }
      })
      this.sendToRenderer('opencode:stream', {
        type: 'session.status',
        sessionId: sess.octobSessionId,
        data: { status: { type: 'idle' } },
        statusPayload: { type: 'idle' }
      })
      throw err
    }
  }

  async abort(worktreePath: string, agentSessionId: string): Promise<boolean> {
    const key = this.getSessionKey(worktreePath, agentSessionId)
    const sess = this.sessions.get(key)
    if (!sess) return false
    await sess.connection.cancel({ sessionId: sess.acpSessionId })
    return true
  }

  async getMessages(worktreePath: string, agentSessionId: string): Promise<unknown[]> {
    const key = this.getSessionKey(worktreePath, agentSessionId)
    const sess = this.sessions.get(key)
    if (!sess) return []
    return [...sess.messages]
  }

  async getAvailableModels(): Promise<unknown> {
    return getAvailableCursorCliModels()
  }

  async getModelInfo(
    _worktreePath: string,
    modelId: string
  ): Promise<{
    id: string
    name: string
    limit: { context: number; input?: number; output: number }
  } | null> {
    const row = getCursorCliModelInfo(modelId, this.cursorAgentBinaryPath)
    if (!row) {
      return {
        id: modelId,
        name: modelId,
        limit: { context: 262144, output: 8192 }
      }
    }
    return {
      id: row.id,
      name: row.name,
      limit: { context: row.limit.context, output: row.limit.output }
    }
  }

  setSelectedModel(model: { providerID: string; modelID: string; variant?: string }): void {
    void model.providerID
    const t = model.modelID?.trim()
    this.selectedModelID =
      !t ? CURSOR_CLI_DEFAULT_MODEL_ID : (normalizeCursorCliModelIdentity(t) ?? t)
    this.selectedVariant = model.variant
    void this.selectedVariant
  }

  async getSessionInfo(
    _worktreePath: string,
    _agentSessionId: string
  ): Promise<{ revertMessageID: string | null; revertDiff: string | null }> {
    return { revertMessageID: null, revertDiff: null }
  }

  async questionReply(requestId: string, _answers: string[][], _worktreePath?: string): Promise<void> {
    void requestId
    void _answers
    void _worktreePath
    throw new Error('Cursor CLI: structured questions (ACP elicitation) are not implemented yet.')
  }

  async questionReject(requestId: string, _worktreePath?: string): Promise<void> {
    void requestId
    void _worktreePath
    throw new Error('Cursor CLI: structured questions (ACP elicitation) are not implemented yet.')
  }

  async permissionReply(
    requestId: string,
    decision: 'once' | 'always' | 'reject',
    _worktreePath?: string
  ): Promise<void> {
    const pending = this.pendingPermissions.get(requestId)
    if (!pending) {
      throw new Error(`No pending Cursor CLI approval for ${requestId}`)
    }

    const response = this.mapHivePermissionToResponse(pending.request, decision)

    pending.resolve(response)
    this.pendingPermissions.delete(requestId)

    this.sendToRenderer('opencode:stream', {
      type: 'permission.replied',
      sessionId: pending.octobSessionId,
      data: { requestId, id: requestId, decision }
    })
  }

  async permissionList(_worktreePath?: string): Promise<unknown[]> {
    void _worktreePath
    return []
  }

  async undo(
    _worktreePath: string,
    _agentSessionId: string,
    _octobSessionId: string
  ): Promise<unknown> {
    throw new Error('Cursor CLI: undo is not supported.')
  }

  async redo(
    _worktreePath: string,
    _agentSessionId: string,
    _octobSessionId: string
  ): Promise<unknown> {
    throw new Error('Cursor CLI: redo is not supported.')
  }

  async listCommands(_worktreePath: string): Promise<unknown[]> {
    void _worktreePath
    return []
  }

  async sendCommand(
    worktreePath: string,
    agentSessionId: string,
    command: string,
    args?: string
  ): Promise<void> {
    const trimmed = (`/${command} ${args ?? ''}`).trim()
    await this.prompt(worktreePath, agentSessionId, trimmed)
  }

  async renameSession(_worktreePath: string, agentSessionId: string, name: string): Promise<void> {
    if (!this.dbService) {
      log.warn('renameSession: no dbService available', { agentSessionId })
      return
    }

    let octobSessionId: string | null = null
    for (const session of this.sessions.values()) {
      if (session.acpSessionId === agentSessionId) {
        octobSessionId = session.octobSessionId
        break
      }
    }

    if (!octobSessionId) {
      log.warn('renameSession: session not found in active map', { agentSessionId })
      return
    }

    try {
      this.dbService.updateSession(octobSessionId, { name })
      log.info('renameSession: updated title in DB', { octobSessionId, name })
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      log.error('renameSession: failed to update title', error, { octobSessionId })
    }
  }
}
