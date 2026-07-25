import type { BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { readFile } from 'node:fs/promises'

import type { AgentSdkImplementer, PromptOptions } from './agent-sdk-types'
import { ANTIGRAVITY_CAPABILITIES } from './agent-sdk-types'
import type { DatabaseService } from '../db/database'
import { createLogger } from './logger'
import { getUserEnvironmentVariables } from './env-vars'
import {
  acpTranscriptAppendAssistantTextChunk,
  acpTranscriptAppendUserTurn
} from './acp-session-transcript'
import {
  ANTIGRAVITY_DEFAULT_MODEL_ID,
  getAntigravityModelInfo,
  getAvailableAntigravityModels
} from './antigravity-models'
import { captureAntigravityUsagePayload } from './antigravity-usage-service'

const log = createLogger({ component: 'AntigravityImplementer' })
const AGY_DATA_DIR = join(homedir(), '.gemini', 'antigravity-cli')

interface AntigravitySessionState {
  octobSessionId: string
  worktreePath: string
  sessionId: string
  conversationId: string | null
  messages: unknown[]
  child: ChildProcessWithoutNullStreams | null
  transcriptOffset: number
  transcriptRemainder: string
  emittedSteps: Set<string>
  baselineConversationId: string | null
}

interface TranscriptRecord {
  source?: string
  type?: string
  status?: string
  content?: string
  step_index?: number
}

function normalizeWorkspace(value: string): string {
  const normalized = resolve(value).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function promptText(message: Parameters<AgentSdkImplementer['prompt']>[2]): string {
  if (typeof message === 'string') return message
  return message
    .map((part) => part.type === 'text' ? part.text : part.url.startsWith('file:') ? `@${part.url}` : '')
    .filter(Boolean)
    .join('\n')
}

export class AntigravityImplementer implements AgentSdkImplementer {
  readonly id = 'antigravity' as const
  readonly capabilities = ANTIGRAVITY_CAPABILITIES

  private mainWindow: BrowserWindow | null = null
  private dbService: DatabaseService | null = null
  private binaryPath: string | null = null
  private selectedModelId = ANTIGRAVITY_DEFAULT_MODEL_ID
  private sessions = new Map<string, AntigravitySessionState>()

  setMainWindow(window: BrowserWindow): void { this.mainWindow = window }
  setDatabaseService(db: DatabaseService): void { this.dbService = db }
  setAntigravityBinaryPath(value: string | null): void { this.binaryPath = value }

  private send(type: string, state: AntigravitySessionState, data: unknown): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return
    this.mainWindow.webContents.send('opencode:stream', {
      type,
      sessionId: state.octobSessionId,
      data,
      ...(type === 'session.status' ? { statusPayload: (data as { status: unknown }).status } : {})
    })
  }

  private find(worktreePath: string, sessionId: string): AntigravitySessionState | undefined {
    return [...new Set(this.sessions.values())].find((state) =>
      normalizeWorkspace(state.worktreePath) === normalizeWorkspace(worktreePath) &&
      (state.sessionId === sessionId || state.conversationId === sessionId)
    )
  }

  hasBackendSession(worktreePath: string, sessionId: string): boolean {
    return !!this.find(worktreePath, sessionId)
  }

  private async readConversationId(worktreePath: string): Promise<string | null> {
    try {
      const raw = await readFile(join(AGY_DATA_DIR, 'cache', 'last_conversations.json'), 'utf-8')
      const values = JSON.parse(raw) as Record<string, string>
      const wanted = normalizeWorkspace(worktreePath)
      for (const [workspace, id] of Object.entries(values)) {
        if (normalizeWorkspace(workspace) === wanted && typeof id === 'string' && id.length > 0) return id
      }
    } catch { /* no conversation has been materialized yet */ }
    return null
  }

  private transcriptPath(conversationId: string): string {
    return join(AGY_DATA_DIR, 'brain', conversationId, '.system_generated', 'logs', 'transcript.jsonl')
  }

  private async materialize(state: AntigravitySessionState): Promise<void> {
    if (state.conversationId) return
    const id = await this.readConversationId(state.worktreePath)
    if (!id) return
    if (id === state.baselineConversationId) return
    state.conversationId = id
    this.sessions.set(id, state)
    this.send('session.materialized', state, { newSessionId: id, wasFork: false })
  }

  private async primeTranscript(state: AntigravitySessionState): Promise<void> {
    if (!state.conversationId) return
    try {
      const content = await readFile(this.transcriptPath(state.conversationId), 'utf-8')
      state.transcriptOffset = content.length
      for (const line of content.split(/\r?\n/)) {
        if (!line.trim()) continue
        let record: TranscriptRecord
        try { record = JSON.parse(line) as TranscriptRecord } catch { continue }
        captureAntigravityUsagePayload(record)
        if (record.type === 'USER_INPUT' && typeof record.content === 'string') {
          acpTranscriptAppendUserTurn(state.messages, record.content)
        } else if (
          record.source === 'MODEL' && record.type === 'PLANNER_RESPONSE' &&
          record.status === 'DONE' && typeof record.content === 'string'
        ) {
          const key = `${record.step_index ?? 'unknown'}:${record.content}`
          state.emittedSteps.add(key)
          acpTranscriptAppendAssistantTextChunk(state.messages, record.content)
        }
      }
    } catch { /* a deleted remote conversation has no local transcript */ }
  }

  private emitAssistantText(state: AntigravitySessionState, text: string): void {
    if (!text.trim()) return
    acpTranscriptAppendAssistantTextChunk(state.messages, text)
    this.send('message.part.updated', state, {
      part: { type: 'text', text },
      delta: text
    })
  }

  private async pollTranscript(state: AntigravitySessionState): Promise<void> {
    await this.materialize(state)
    if (!state.conversationId) return
    try {
      const content = await readFile(this.transcriptPath(state.conversationId), 'utf-8')
      if (content.length < state.transcriptOffset) {
        state.transcriptOffset = 0
        state.transcriptRemainder = ''
      }
      const appended = content.slice(state.transcriptOffset)
      state.transcriptOffset = content.length
      const lines = (state.transcriptRemainder + appended).split(/\r?\n/)
      state.transcriptRemainder = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        let record: TranscriptRecord
        try { record = JSON.parse(line) as TranscriptRecord } catch { continue }
        captureAntigravityUsagePayload(record)
        if (
          record.source === 'MODEL' && record.type === 'PLANNER_RESPONSE' &&
          record.status === 'DONE' && typeof record.content === 'string'
        ) {
          const key = `${record.step_index ?? 'unknown'}:${record.content}`
          if (!state.emittedSteps.has(key)) {
            state.emittedSteps.add(key)
            this.emitAssistantText(state, record.content)
          }
        }
      }
    } catch { /* transcript may not exist until the first model event */ }
  }

  async connect(worktreePath: string, octobSessionId: string): Promise<{ sessionId: string }> {
    if (!this.binaryPath) throw new Error('Google Antigravity CLI is not installed. Install `agy` and restart Octob.')
    const sessionId = randomUUID()
    const baselineConversationId = await this.readConversationId(worktreePath)
    const state: AntigravitySessionState = {
      octobSessionId, worktreePath, sessionId, conversationId: null, messages: [], child: null,
      transcriptOffset: 0, transcriptRemainder: '', emittedSteps: new Set(), baselineConversationId
    }
    this.sessions.set(sessionId, state)
    log.info('Antigravity session connected', { worktreePath, octobSessionId, sessionId })
    return { sessionId }
  }

  async reconnect(worktreePath: string, agentSessionId: string, octobSessionId: string): Promise<{
    success: boolean; sessionStatus?: 'idle' | 'busy' | 'retry'; revertMessageID?: string | null
  }> {
    const existing = this.find(worktreePath, agentSessionId)
    if (existing) {
      existing.octobSessionId = octobSessionId
      return { success: true, sessionStatus: existing.child ? 'busy' : 'idle', revertMessageID: null }
    }
    if (!this.binaryPath) return { success: false }
    const state: AntigravitySessionState = {
      octobSessionId, worktreePath, sessionId: agentSessionId, conversationId: agentSessionId,
      messages: [], child: null, transcriptOffset: 0, transcriptRemainder: '', emittedSteps: new Set(),
      baselineConversationId: null
    }
    this.sessions.set(agentSessionId, state)
    await this.primeTranscript(state)
    return { success: true, sessionStatus: 'idle', revertMessageID: null }
  }

  async prompt(
    worktreePath: string,
    agentSessionId: string,
    message: Parameters<AgentSdkImplementer['prompt']>[2],
    modelOverride?: { providerID: string; modelID: string; variant?: string },
    _options?: PromptOptions
  ): Promise<void> {
    const state = this.find(worktreePath, agentSessionId)
    if (!state || !this.binaryPath) throw new Error(`Antigravity prompt: unknown session ${agentSessionId}`)
    if (state.child) throw new Error('Antigravity is already processing a prompt in this session.')
    const text = promptText(message).trim()
    if (!text) return
    acpTranscriptAppendUserTurn(state.messages, text)
    this.send('session.status', state, { status: { type: 'busy' } })

    const model = modelOverride?.modelID?.trim() || this.selectedModelId
    const args = ['--model', model]
    if (state.conversationId) args.push('--conversation', state.conversationId)
    args.push('--print-timeout', '1800', '-p', text)
    const emittedStepCountBeforePrompt = state.emittedSteps.size

    await new Promise<void>((resolvePromise, reject) => {
      const child = spawn(this.binaryPath!, args, {
        cwd: worktreePath,
        env: { ...process.env, ...getUserEnvironmentVariables(this.dbService), NO_COLOR: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      })
      state.child = child
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf-8') })
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf-8') })
      const timer = setInterval(() => void this.pollTranscript(state), 350)
      child.once('error', (error) => {
        clearInterval(timer); state.child = null; reject(error)
      })
      child.once('close', async (code) => {
        clearInterval(timer)
        state.child = null
        await this.pollTranscript(state)
        if (code !== 0) {
          const error = (stderr || stdout || `agy exited with code ${code}`).trim().slice(-2000)
          this.send('session.error', state, { error })
          reject(new Error(error))
          return
        }
        log.info('Antigravity prompt completed', { conversationId: state.conversationId, code })
        if (state.emittedSteps.size === emittedStepCountBeforePrompt && stdout.trim()) {
          this.emitAssistantText(state, stdout.trim())
        }
        resolvePromise()
      })
    }).finally(() => this.send('session.status', state, { status: { type: 'idle' } }))
  }

  async abort(worktreePath: string, agentSessionId: string): Promise<boolean> {
    const state = this.find(worktreePath, agentSessionId)
    if (!state?.child) return false
    state.child.kill()
    return true
  }

  async disconnect(worktreePath: string, agentSessionId: string): Promise<void> {
    const state = this.find(worktreePath, agentSessionId)
    if (!state) return
    state.child?.kill()
    for (const [key, value] of this.sessions) if (value === state) this.sessions.delete(key)
  }

  async cleanup(): Promise<void> {
    for (const state of new Set(this.sessions.values())) state.child?.kill()
    this.sessions.clear()
  }

  async getMessages(worktreePath: string, agentSessionId: string): Promise<unknown[]> {
    const state = this.find(worktreePath, agentSessionId)
    if (state) await this.pollTranscript(state)
    return state ? [...state.messages] : []
  }

  async getAvailableModels(): Promise<unknown> { return getAvailableAntigravityModels() }
  async getModelInfo(_worktreePath: string, modelId: string) {
    return getAntigravityModelInfo(modelId) ?? { id: modelId, name: modelId, limit: { context: 1048576, output: 65536 } }
  }
  setSelectedModel(model: { providerID: string; modelID: string }): void { this.selectedModelId = model.modelID || ANTIGRAVITY_DEFAULT_MODEL_ID }
  async getSessionInfo() { return { revertMessageID: null, revertDiff: null } }
  async questionReply(): Promise<void> { throw new Error('Antigravity structured questions are handled by the CLI.') }
  async questionReject(): Promise<void> { throw new Error('Antigravity structured questions are handled by the CLI.') }
  async permissionReply(): Promise<void> { throw new Error('Antigravity permissions are controlled by ~/.gemini/antigravity-cli/settings.json.') }
  async permissionList(): Promise<unknown[]> { return [] }
  async undo(): Promise<unknown> { throw new Error('Antigravity undo is available in its native TUI only.') }
  async redo(): Promise<unknown> { throw new Error('Antigravity redo is not supported.') }
  async listCommands(): Promise<unknown[]> { return [] }
  async sendCommand(worktreePath: string, agentSessionId: string, command: string, args?: string): Promise<void> {
    await this.prompt(worktreePath, agentSessionId, `/${command}${args ? ` ${args}` : ''}`)
  }
  async renameSession(_worktreePath: string, agentSessionId: string, name: string): Promise<void> {
    const state = [...new Set(this.sessions.values())].find((value) => value.sessionId === agentSessionId || value.conversationId === agentSessionId)
    if (state && this.dbService) this.dbService.updateSession(state.octobSessionId, { name })
  }
}
