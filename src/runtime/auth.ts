import { randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

function bearerToken(request: IncomingMessage): string | null {
  const header = request.headers.authorization
  if (!header?.startsWith('Bearer ')) return null
  const token = header.slice('Bearer '.length).trim()
  return token || null
}

export class RuntimeSessionManager {
  private readonly tokens = new Set<string>()

  create(): string {
    const token = `${randomUUID()}${randomUUID()}`
    this.tokens.add(token)
    return token
  }

  authorize(request: IncomingMessage): boolean {
    const token = bearerToken(request)
    return token ? this.tokens.has(token) : false
  }

  revoke(request: IncomingMessage): boolean {
    const token = bearerToken(request)
    return token ? this.tokens.delete(token) : false
  }

  clear(): void {
    this.tokens.clear()
  }
}
