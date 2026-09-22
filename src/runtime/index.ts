import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { DatabaseService } from '../main/db/database'
import {
  OCTOB_RUNTIME_PROTOCOL_VERSION,
  type RuntimeCapabilities,
  type RuntimeHealth
} from '../shared/runtime-protocol'
import { RuntimeSessionManager } from './auth'
import {
  getRequestUrl,
  isOriginAllowed,
  writeCorsPreflight,
  writeJson
} from './http'
import { handleDatabaseRoute } from './routes/database'
import { handleFileRoute } from './routes/files'
import { handleGitRoute } from './routes/git'
import { handleWorktreeRoute } from './routes/worktrees'

const host = process.env.OCTOB_RUNTIME_HOST ?? '127.0.0.1'
const port = Number.parseInt(process.env.OCTOB_RUNTIME_PORT ?? '47821', 10)
const allowedOrigins = new Set(
  (process.env.OCTOB_ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
)

const db = new DatabaseService()
db.init()
const sessions = new RuntimeSessionManager()

function health(): RuntimeHealth {
  return {
    status: 'ok',
    runtime: 'local',
    protocolVersion: OCTOB_RUNTIME_PROTOCOL_VERSION,
    pid: process.pid,
    platform: process.platform,
    uptimeSeconds: Math.floor(process.uptime())
  }
}

function capabilities(): RuntimeCapabilities {
  return {
    runtime: 'local',
    protocolVersion: OCTOB_RUNTIME_PROTOCOL_VERSION,
    transport: { http: true, websocket: false },
    features: {
      database: true,
      filesystem: true,
      git: true,
      worktrees: true,
      terminal: false,
      agents: false,
      mcp: false
    }
  }
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  if (request.method === 'OPTIONS') {
    writeCorsPreflight(request, response, allowedOrigins)
    return
  }

  if (!isOriginAllowed(request, allowedOrigins)) {
    writeJson(request, response, allowedOrigins, 403, { error: 'origin_not_allowed' })
    return
  }

  const url = getRequestUrl(request)
  if (request.method === 'GET' && url.pathname === '/v1/health') {
    writeJson(request, response, allowedOrigins, 200, health())
    return
  }
  if (request.method === 'GET' && url.pathname === '/v1/capabilities') {
    writeJson(request, response, allowedOrigins, 200, capabilities())
    return
  }

  if (request.method === 'POST' && url.pathname === '/v1/session') {
    const token = sessions.create()
    writeJson(request, response, allowedOrigins, 201, {
      token,
      protocolVersion: OCTOB_RUNTIME_PROTOCOL_VERSION
    })
    return
  }

  if (!sessions.authorize(request)) {
    writeJson(request, response, allowedOrigins, 401, { error: 'unauthorized' })
    return
  }

  if (request.method === 'DELETE' && url.pathname === '/v1/session') {
    sessions.revoke(request)
    writeJson(request, response, allowedOrigins, 200, { revoked: true })
    return
  }

  const context = { db, allowedOrigins }
  if (await handleDatabaseRoute(request, response, url, context)) return
  if (await handleFileRoute(request, response, url, context)) return
  if (await handleGitRoute(request, response, url, context)) return
  if (await handleWorktreeRoute(request, response, url, context)) return

  writeJson(request, response, allowedOrigins, 404, { error: 'not_found' })
}

const server = createServer((request, response) => {
  void handleRequest(request, response).catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    const status = message === 'request_body_too_large' ? 413 : 500
    writeJson(request, response, allowedOrigins, status, { error: message })
  })
})

server.listen(port, host, () => {
  console.log(`Octob Runtime listening on http://${host}:${port}`)
})

function shutdown(signal: NodeJS.Signals): void {
  console.log(`Received ${signal}, shutting down Octob Runtime`)
  sessions.clear()
  db.close()
  server.close(() => process.exit(0))
}

process.once('SIGINT', () => shutdown('SIGINT'))
process.once('SIGTERM', () => shutdown('SIGTERM'))
