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
}

export const octobRuntime = new OctobRuntimeClient()
