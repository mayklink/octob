import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { getDatabase } from '../main/db/database'
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
import { handleTerminalRoute } from './routes/terminal'
import { handleProjectRoute } from './routes/project'
import { handleFileTreeRoute } from './routes/file-tree'
import { handleAgentRoute } from './routes/agents'
import { handleExecutionRoute } from './routes/execution'
import { handleConnectionRoute } from './routes/connections'
import { handleSystemRoute } from './routes/system'
import { handleAttachmentRoute } from './routes/attachments'
import { handleWatcherRoute } from './routes/watchers'
import { handleVoiceRoute } from './routes/voice'
import { handleAssistantRoute } from './routes/assistant'
import { handleUsageRoute } from './routes/usage'
import { handleLoggingRoute } from './routes/logging'
import { runtimeWatchers } from './watcher-runtime'
import { runtimeAssistantWindow } from './assistant-runtime'
import { RuntimeAgentService } from './agent-runtime'
import { ptyService } from '../main/services/pty-service'
import { bashService } from '../main/services/bash-service'
import { scriptRunner } from '../main/services/script-runner'
import { loadShellEnv } from '../main/services/shell-env'
import { startAssistantMcpService } from '../main/services/assistant-mcp-service'
import { serveStaticWeb } from './static-web'
import { openRuntimeBrowser } from './open-browser'

loadShellEnv()

const host = process.env.OCTOB_RUNTIME_HOST ?? '127.0.0.1'
const port = Number.parseInt(process.env.OCTOB_RUNTIME_PORT ?? '47821', 10)
const allowedOrigins = new Set(
  (
    process.env.OCTOB_ALLOWED_ORIGINS ??
    'http://localhost:5173,http://127.0.0.1:5173,http://localhost:47821,http://127.0.0.1:47821'
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
)

const db = getDatabase()
const sessions = new RuntimeSessionManager()
const agents = new RuntimeAgentService(db)
const debugRequests = process.env.OCTOB_RUNTIME_DEBUG_REQUESTS === '1'

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
      terminal: true,
      agents: true,
      mcp: true
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
  if (serveStaticWeb(request, response, url)) return

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

  const context = { db, agents, allowedOrigins }
  if (await handleDatabaseRoute(request, response, url, context)) return
  if (await handleFileRoute(request, response, url, context)) return
  if (await handleGitRoute(request, response, url, context)) return
  if (await handleWorktreeRoute(request, response, url, context)) return
  if (await handleTerminalRoute(request, response, url, context)) return
  if (await handleProjectRoute(request, response, url, context)) return
  if (await handleFileTreeRoute(request, response, url, context)) return
  if (await handleAgentRoute(request, response, url, context)) return
  if (await handleExecutionRoute(request, response, url, context)) return
  if (await handleConnectionRoute(request, response, url, context)) return
  if (await handleSystemRoute(request, response, url, context)) return
  if (await handleAttachmentRoute(request, response, url, context)) return
  if (await handleWatcherRoute(request, response, url, context)) return
  if (await handleVoiceRoute(request, response, url, context)) return
  if (await handleAssistantRoute(request, response, url, context)) return
  if (await handleLoggingRoute(request, response, url, context)) return
  if (await handleUsageRoute(request, response, url, context)) return

  writeJson(request, response, allowedOrigins, 404, { error: 'not_found' })
}

const server = createServer((request, response) => {
  const startedAt = Date.now()
  const requestPath = request.url?.split('?')[0] ?? '/'
  if (debugRequests) {
    console.log('[runtime:req:start]', request.method ?? 'GET', requestPath)
    response.once('finish', () => {
      console.log(
        '[runtime:req:finish]',
        request.method ?? 'GET',
        requestPath,
        response.statusCode,
        `${Date.now() - startedAt}ms`
      )
    })
    response.once('close', () => {
      if (!response.writableEnded) {
        console.log(
          '[runtime:req:close]',
          request.method ?? 'GET',
          requestPath,
          `${Date.now() - startedAt}ms`
        )
      }
    })
  }
  void handleRequest(request, response).catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    const status = message === 'request_body_too_large' ? 413 : 500
    writeJson(request, response, allowedOrigins, status, { error: message })
  })
})

async function startRuntime(): Promise<void> {
  try {
    await startAssistantMcpService(db, agents, runtimeAssistantWindow)
  } catch (error) {
    console.error(
      'Failed to start internal assistant MCP service:',
      error instanceof Error ? error.message : String(error)
    )
  }

  server.listen(port, host, () => {
    const runtimeUrl = `http://${host}:${port}`
    console.log(`Octob Runtime listening on ${runtimeUrl}`)
    if (process.env.OCTOB_OPEN_BROWSER === '1') {
      openRuntimeBrowser(`${runtimeUrl}/`)
    }
  })
}

void startRuntime()

function shutdown(signal: NodeJS.Signals): void {
  console.log(`Received ${signal}, shutting down Octob Runtime`)
  sessions.clear()
  runtimeAssistantWindow.destroy()
  ptyService.destroyAll()
  bashService.killAll()
  scriptRunner.killAll()
  void Promise.allSettled([
    agents.cleanup(),
    runtimeWatchers.cleanup()
  ]).finally(() => {
    db.close()
    server.close(() => process.exit(0))
  })
}

process.once('SIGINT', () => shutdown('SIGINT'))
process.once('SIGTERM', () => shutdown('SIGTERM'))
