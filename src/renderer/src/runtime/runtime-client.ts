import type {
  RuntimeCapabilities,
  RuntimeHealth
} from '../../../shared/runtime-protocol'

const DEFAULT_RUNTIME_URL = 'http://127.0.0.1:47821'

export class OctobRuntimeClient {
  constructor(private readonly baseUrl = DEFAULT_RUNTIME_URL) {}

  private async get<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: { accept: 'application/json' }
    })

    if (!response.ok) {
      throw new Error(`Octob Runtime returned HTTP ${response.status}`)
    }

    return response.json() as Promise<T>
  }

  health(): Promise<RuntimeHealth> {
    return this.get<RuntimeHealth>('/v1/health')
  }

  capabilities(): Promise<RuntimeCapabilities> {
    return this.get<RuntimeCapabilities>('/v1/capabilities')
  }

  async isAvailable(): Promise<boolean> {
    try {
      const health = await this.health()
      return health.status === 'ok'
    } catch {
      return false
    }
  }
}

export const octobRuntime = new OctobRuntimeClient()
