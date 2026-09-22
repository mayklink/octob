import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import {
  OCTOB_RUNTIME_PROTOCOL_VERSION,
  type RuntimeCapabilities,
  type RuntimeHealth
} from '../shared/runtime-protocol'

const host = process.env.OCTOB_RUNTIME_HOST ?? '127.0.0.1'
const port = Number.parseInt(process.env.OCTOB_RUNTIME_PORT ?? '47821', 10)
const allowedOrigins = new Set(
  (process.env.OCTOB_ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
)

function responseHeaders(request: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  }
  const origin = request.headers.origin
  if (origin && allowedOrigins.has(origin)) {
    headers['access-control-allow-origin'] = origin
    headers.vary = 'Origin'
  }
  return headers
}
function writeJson(
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  body: unknown
): void {
  response.writeHead(status, responseHeaders(request))
  response.end(JSON.stringify(body))
}

function handleRequest(request: IncomingMessage, response: ServerResponse): void {
  if (request.method === 'GET' && request.url === '/v1/health') {
    const health: RuntimeHealth = {
      status: 'ok',
      runtime: 'local',
      protocolVersion: OCTOB_RUNTIME_PROTOCOL_VERSION,
      pid: process.pid,
      platform: process.platform,
      uptimeSeconds: Math.floor(process.uptime())
    }
    writeJson(request, response, 200, health)
    return
  }

  if (request.method === 'GET' && request.url === '/v1/capabilities') {
    const capabilities: RuntimeCapabilities = {
      runtime: 'local',
      protocolVersion: OCTOB_RUNTIME_PROTOCOL_VERSION,
      transport: { http: true, websocket: false },
      features: {
        database: false,
        filesystem: false,
        git: false,
        worktrees: false,
        terminal: false,
        agents: false,
        mcp: false
      }
    }
    writeJson(request, response, 200, capabilities)
    return
  }

  writeJson(request, response, 404, { error: 'not_found' })
}

const server = createServer(handleRequest)

server.listen(port, host, () => {
  console.log(`Octob Runtime listening on http://${host}:${port}`)
})
function shutdown(signal: NodeJS.Signals): void {
  console.log(`Received ${signal}, shutting down Octob Runtime`)
  server.close(() => process.exit(0))
}

process.once('SIGINT', () => shutdown('SIGINT'))
process.once('SIGTERM', () => shutdown('SIGTERM'))
