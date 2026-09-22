import type {
  RuntimeCapabilities,
  RuntimeHealth
} from '../../../shared/runtime-protocol'

const DEFAULT_RUNTIME_URL = 'http://127.0.0.1:47821'

interface RuntimeSession {
  token: string
  protocolVersion: number
}

type RequestOptions = Omit<RequestInit, 'body'> & {
  body?: unknown
  auth?: boolean
}

export class OctobRuntimeClient {
  private token: string | null = null

  constructor(private readonly baseUrl = DEFAULT_RUNTIME_URL) {}

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    if (options.auth !== false && !this.token) {
      await this.connect()
    }

    const headers = new Headers(options.headers)
    headers.set('accept', 'application/json')
    if (options.body !== undefined) headers.set('content-type', 'application/json')
    if (options.auth !== false && this.token) {
      headers.set('authorization', `Bearer ${this.token}`)
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    })

    if (!response.ok) {
      const errorBody = await response.text()
      throw new Error(`Octob Runtime HTTP ${response.status}: ${errorBody}`)
    }

    return response.json() as Promise<T>
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
    const session = await this.request<RuntimeSession>('/v1/session', {
      method: 'POST',
      auth: false
    })
    this.token = session.token
    return session
  }

  async disconnect(): Promise<void> {
    if (!this.token) return
    await this.request<{ revoked: boolean }>('/v1/session', { method: 'DELETE' })
    this.token = null
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
    body?: unknown
  ): Promise<T> {
    return this.request<T>(path, { method, body })
  }

  async dbCall<T = unknown>(method: string, args: unknown[] = []): Promise<T> {
    const response = await this.request<{ result: T }>('/v1/db/call', {
      method: 'POST',
      body: { method, args }
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
        `${this.baseUrl}/v1/terminal/stream?terminalId=${encodeURIComponent(terminalId)}`,
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
      body
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
      const response = await fetch(`${this.baseUrl}${path}`, {
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
