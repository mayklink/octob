import type {
  RuntimeCapabilities,
  RuntimeHealth
} from '../../../shared/runtime-protocol'

const DEFAULT_RUNTIME_URL = 'http://127.0.0.1:47821'
const DEFAULT_REQUEST_TIMEOUT_MS = 45_000
const AGENT_PROMPT_TIMEOUT_MS = 15 * 60_000

function getDefaultRuntimeUrl(): string {
  if (typeof window !== 'undefined' && /^https?:$/.test(window.location.protocol)) {
    return window.location.origin
  }
  return DEFAULT_RUNTIME_URL
}

/**
 * Keep long-lived event streams on a separate browser connection pool from
 * request/response traffic. Chrome limits HTTP/1.1 connections per origin;
 * without this split, a few streams can queue control requests behind them.
 * The runtime already allows both loopback origins and handles the CORS
 * preflight for the Authorization header.
 */
export function getStreamRuntimeUrl(baseUrl: string): string {
  if (typeof window === 'undefined' || !/^https?:$/.test(window.location.protocol)) {
    return baseUrl
  }

  try {
    const url = new URL(baseUrl)
    if (url.hostname === '127.0.0.1') url.hostname = 'localhost'
    else if (url.hostname === 'localhost') url.hostname = '127.0.0.1'
    return url.origin
  } catch {
    return baseUrl
  }
}

interface RuntimeSession {
  token: string
  protocolVersion: number
}

type RequestOptions = Omit<RequestInit, 'body'> & {
  body?: unknown
  auth?: boolean
  retryAuth?: boolean
  scope?: string
  timeoutMs?: number
}

export class OctobRuntimeClient {
  private token: string | null = null
  private runtimeSession: RuntimeSession | null = null
  private connectionPromise: Promise<RuntimeSession> | null = null
  private scopedRequests = new Map<string, Set<AbortController>>()
  private readonly streamBaseUrl: string

  constructor(private readonly baseUrl = getDefaultRuntimeUrl()) {
    this.streamBaseUrl = getStreamRuntimeUrl(baseUrl)
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    if (options.auth !== false && !this.token) {
      await this.connect()
    }

    const {
      auth: _auth,
      retryAuth: _retryAuth,
      scope,
      timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
      body,
      ...fetchOptions
    } = options
    void _auth
    void _retryAuth

    const controller = new AbortController()
    if (scope) {
      const requests = this.scopedRequests.get(scope) ?? new Set<AbortController>()
      requests.add(controller)
      this.scopedRequests.set(scope, requests)
    }

    const headers = new Headers(fetchOptions.headers)
    headers.set('accept', 'application/json')
    if (body !== undefined) headers.set('content-type', 'application/json')
    if (options.auth !== false && this.token) {
      headers.set('authorization', `Bearer ${this.token}`)
    }

    const externalSignal = fetchOptions.signal
    const abortForExternalSignal = (): void => controller.abort(externalSignal?.reason)
    if (externalSignal?.aborted) abortForExternalSignal()
    else externalSignal?.addEventListener('abort', abortForExternalSignal, { once: true })

    let didTimeout = false
    const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0
      ? setTimeout(() => {
          didTimeout = true
          controller.abort()
        }, timeoutMs)
      : null

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...fetchOptions,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal
      })

      if (!response.ok) {
        if (response.status === 401 && options.auth !== false && options.retryAuth !== false) {
          this.token = null
          this.runtimeSession = null
          await this.connect()
          return this.request<T>(path, { ...options, retryAuth: false })
        }
        const errorBody = await response.text()
        throw new Error(`Octob Runtime HTTP ${response.status}: ${errorBody}`)
      }

      return response.json() as Promise<T>
    } catch (error) {
      if (didTimeout) {
        throw new Error(`Octob Runtime request timed out after ${timeoutMs}ms: ${path}`)
      }
      throw error
    } finally {
      if (timeout) clearTimeout(timeout)
      externalSignal?.removeEventListener('abort', abortForExternalSignal)
      if (scope) {
        const requests = this.scopedRequests.get(scope)
        requests?.delete(controller)
        if (requests?.size === 0) this.scopedRequests.delete(scope)
      }
    }
  }

  cancelScope(scope: string): void {
    const requests = this.scopedRequests.get(scope)
    if (!requests) return
    for (const controller of requests) controller.abort()
    this.scopedRequests.delete(scope)
  }

  health(): Promise<RuntimeHealth> {
    return this.request<RuntimeHealth>('/v1/health', { method: 'GET', auth: false })
  }

  capabilities(): Promise<RuntimeCapabilities> {
    return this.request<RuntimeCapabilities>('/v1/capabilities', {
      method: 'GET',
      auth: false
    })
  }

  async connect(): Promise<RuntimeSession> {
    if (this.token) {
      return this.runtimeSession ?? { token: this.token, protocolVersion: 0 }
    }
    if (this.connectionPromise) return this.connectionPromise

    this.connectionPromise = (async () => {
      const session = await this.request<RuntimeSession>('/v1/session', {
        method: 'POST',
        auth: false
      })
      this.token = session.token
      this.runtimeSession = session
      return session
    })()

    try {
      return await this.connectionPromise
    } finally {
      this.connectionPromise = null
    }
  }

  async disconnect(): Promise<void> {
    if (!this.token) return
    await this.request<{ revoked: boolean }>('/v1/session', { method: 'DELETE' })
    this.token = null
    this.runtimeSession = null
  }

  async ensureConnected(): Promise<void> {
    if (!this.token) await this.connect()
  }

  async isAvailable(): Promise<boolean> {
    try {
      const health = await this.health()
      return health.status === 'ok'
    } catch {
      return false
    }
  }

  api<T = unknown>(
    path: string,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'GET',
    body?: unknown,
    scope?: string
  ): Promise<T> {
    return this.request<T>(path, { method, body, scope })
  }

  async dbCall<T = unknown>(
    method: string,
    args: unknown[] = [],
    scope?: string
  ): Promise<T> {
    const response = await this.request<{ result: T }>('/v1/db/call', {
      method: 'POST',
      body: { method, args },
      scope
    })
    return response.result
  }

  getProjects<T = unknown[]>(): Promise<T> {
    return this.request<T>('/v1/db/projects', { method: 'GET' })
  }

  getProject<T = unknown>(projectId: string): Promise<T> {
    return this.request<T>(`/v1/db/projects/${encodeURIComponent(projectId)}`, {
      method: 'GET'
    })
  }

  readFile<T = unknown>(path: string): Promise<T> {
    return this.request<T>(`/v1/files/read?path=${encodeURIComponent(path)}`, {
      method: 'GET'
    })
  }

  writeFile<T = unknown>(path: string, content: string): Promise<T> {
    return this.request<T>('/v1/files/content', {
      method: 'PUT',
      body: { path, content }
    })
  }

  gitStatus<T = unknown>(worktreePath: string): Promise<T> {
    return this.request<T>('/v1/git/status', {
      method: 'POST',
      body: { worktreePath }
    })
  }

  gitBranches<T = unknown>(worktreePath: string): Promise<T> {
    return this.request<T>('/v1/git/branches', {
      method: 'POST',
      body: { worktreePath }
    })
  }

  createWorktree<T = unknown>(projectId: string): Promise<T> {
    return this.request<T>('/v1/worktrees/create', {
      method: 'POST',
      body: { projectId }
    })
  }

  syncWorktrees<T = unknown>(projectId: string): Promise<T> {
    return this.request<T>('/v1/worktrees/sync', {
      method: 'POST',
      body: { projectId }
    })
  }

  createTerminal(
    terminalId: string,
    cwd: string,
    shell?: string
  ): Promise<{ success: boolean; cols?: number; rows?: number; error?: string }> {
    return this.request('/v1/terminal/create', {
      method: 'POST',
      body: { terminalId, cwd, shell }
    })
  }

  writeTerminal(terminalId: string, data: string): Promise<{ success: boolean }> {
    return this.request('/v1/terminal/write', {
      method: 'POST',
      body: { terminalId, data }
    })
  }

  resizeTerminal(terminalId: string, cols: number, rows: number): Promise<{ success: boolean }> {
    return this.request('/v1/terminal/resize', {
      method: 'POST',
      body: { terminalId, cols, rows }
    })
  }

  focusTerminal(terminalId: string, focused: boolean): Promise<{ success: boolean }> {
    return this.request('/v1/terminal/focus', {
      method: 'POST',
      body: { terminalId, focused }
    })
  }

  keepAliveTerminal(terminalId: string, keepAlive: boolean): Promise<{ success: boolean }> {
    return this.request('/v1/terminal/keep-alive', {
      method: 'POST',
      body: { terminalId, keepAlive }
    })
  }

  destroyTerminal(terminalId: string): Promise<{ success: boolean }> {
    return this.request('/v1/terminal', {
      method: 'DELETE',
      body: { terminalId }
    })
  }

  streamTerminal(terminalId: string, handlers: RuntimeTerminalStreamHandlers): () => void {
    const controller = new AbortController()
    void this.consumeTerminalStream(terminalId, handlers, controller.signal)
    return () => controller.abort()
  }

  private async consumeTerminalStream(
    terminalId: string,
    handlers: RuntimeTerminalStreamHandlers,
    signal: AbortSignal
  ): Promise<void> {
    try {
      await this.ensureConnected()
      const response = await fetch(
        `${this.streamBaseUrl}/v1/terminal/stream?terminalId=${encodeURIComponent(terminalId)}`,
        {
          headers: {
            accept: 'application/x-ndjson',
            authorization: `Bearer ${this.token}`
          },
          signal
        }
      )
      if (!response.ok || !response.body) {
        throw new Error(`Terminal stream HTTP ${response.status}`)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line) continue
          const event = JSON.parse(line) as {
            type: 'ready' | 'data' | 'exit'
            data?: string
            code?: number
            signal?: number
          }
          if (event.type === 'data' && event.data !== undefined) handlers.onData(event.data)
          if (event.type === 'exit') handlers.onExit?.(event.code ?? -1, event.signal ?? 0)
        }
      }
    } catch (error) {
      if (!signal.aborted) {
        handlers.onError?.(error instanceof Error ? error : new Error(String(error)))
      }
    }
  }

  agentOperation<T = unknown>(operation: string, body: unknown = {}): Promise<T> {
    return this.request<T>(`/v1/agents/${operation}`, {
      method: 'POST',
      body,
      // A prompt intentionally remains open while the agent accepts the work.
      // Control-plane calls must fail rather than leaving the UI loading forever.
      timeoutMs: operation === 'prompt' ? AGENT_PROMPT_TIMEOUT_MS : DEFAULT_REQUEST_TIMEOUT_MS
    })
  }

  detectAgents<T = unknown>(): Promise<T> {
    return this.request<T>('/v1/agents/detect', { method: 'GET' })
  }

  streamAgents(
    onEvent: (event: unknown) => void,
    onError?: (error: Error) => void
  ): () => void {
    const controller = new AbortController()
    void this.consumeAgentStream(onEvent, onError, controller.signal)
    return () => controller.abort()
  }

  private async consumeAgentStream(
    onEvent: (event: unknown) => void,
    onError: ((error: Error) => void) | undefined,
    signal: AbortSignal
  ): Promise<void> {
    await this.consumeRuntimeStream('/v1/agents/stream', onEvent, onError, signal)
  }

  streamBash(onEvent: (event: unknown) => void, onError?: (error: Error) => void): () => void {
    return this.openRuntimeStream('/v1/bash/stream', onEvent, onError)
  }

  streamScripts(
    onEvent: (event: unknown) => void,
    onError?: (error: Error) => void
  ): () => void {
    return this.openRuntimeStream('/v1/scripts/stream', onEvent, onError)
  }

  streamWatchers(
    onEvent: (event: unknown) => void,
    onError?: (error: Error) => void
  ): () => void {
    return this.openRuntimeStream('/v1/watchers/stream', onEvent, onError)
  }

  streamAssistant(
    onEvent: (event: unknown) => void,
    onError?: (error: Error) => void
  ): () => void {
    return this.openRuntimeStream('/v1/assistant/stream', onEvent, onError)
  }

  private openRuntimeStream(
    path: string,
    onEvent: (event: unknown) => void,
    onError?: (error: Error) => void
  ): () => void {
    const controller = new AbortController()
    void this.consumeRuntimeStream(path, onEvent, onError, controller.signal)
    return () => controller.abort()
  }

  private async consumeRuntimeStream(
    path: string,
    onEvent: (event: unknown) => void,
    onError: ((error: Error) => void) | undefined,
    signal: AbortSignal
  ): Promise<void> {
    try {
      await this.ensureConnected()
      const response = await fetch(`${this.streamBaseUrl}${path}`, {
        headers: {
          accept: 'application/x-ndjson',
          authorization: `Bearer ${this.token}`
        },
        signal
      })
      if (!response.ok || !response.body) throw new Error(`Runtime stream HTTP ${response.status}`)

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line) continue
          const event = JSON.parse(line) as { type?: string }
          if (event.type !== 'runtime.ready') onEvent(event)
        }
      }
    } catch (error) {
      if (!signal.aborted) {
        onError?.(error instanceof Error ? error : new Error(String(error)))
      }
    }
  }
}

export const octobRuntime = new OctobRuntimeClient()

export interface RuntimeTerminalStreamHandlers {
  onData: (data: string) => void
  onExit?: (code: number, signal: number) => void
  onError?: (error: Error) => void
}
