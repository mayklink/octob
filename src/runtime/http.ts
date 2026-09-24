import type { IncomingMessage, ServerResponse } from 'node:http'

export type JsonRecord = Record<string, unknown>

export function getRequestUrl(request: IncomingMessage): URL {
  return new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`)
}

export function getAllowedOrigin(
  request: IncomingMessage,
  allowedOrigins: Set<string>
): string | null {
  const origin = request.headers.origin
  return origin && allowedOrigins.has(origin) ? origin : null
}

export function isOriginAllowed(
  request: IncomingMessage,
  allowedOrigins: Set<string>
): boolean {
  const origin = request.headers.origin
  return !origin || allowedOrigins.has(origin)
}

export function writeJson(
  request: IncomingMessage,
  response: ServerResponse,
  allowedOrigins: Set<string>,
  status: number,
  body: unknown
): void {
  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'close'
  }
  const origin = getAllowedOrigin(request, allowedOrigins)
  if (origin) {
    headers['access-control-allow-origin'] = origin
    headers['access-control-allow-headers'] = 'accept, authorization, content-type'
    headers['access-control-allow-methods'] = 'GET, POST, PUT, PATCH, DELETE, OPTIONS'
    headers.vary = 'Origin'
  }
  const payload = JSON.stringify(body)
  headers['content-length'] = String(Buffer.byteLength(payload, 'utf8'))
  response.writeHead(status, headers)
  response.end(payload)
}

export function writeCorsPreflight(
  request: IncomingMessage,
  response: ServerResponse,
  allowedOrigins: Set<string>
): void {
  if (!isOriginAllowed(request, allowedOrigins)) {
    writeJson(request, response, allowedOrigins, 403, { error: 'origin_not_allowed' })
    return
  }
  const origin = getAllowedOrigin(request, allowedOrigins)
  const privateNetworkRequested =
    request.headers['access-control-request-private-network'] === 'true'
  response.writeHead(204, {
    ...(origin ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}),
    ...(privateNetworkRequested
      ? { 'access-control-allow-private-network': 'true' }
      : {}),
    'access-control-allow-headers': 'accept, authorization, content-type',
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'access-control-max-age': '600'
  })
  response.end()
}

export async function readJsonBody<T extends JsonRecord>(
  request: IncomingMessage,
  maxBytes = 2 * 1024 * 1024
): Promise<T> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > maxBytes) throw new Error('request_body_too_large')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {} as T
  const raw = Buffer.concat(chunks).toString('utf8')
  return JSON.parse(raw) as T
}
