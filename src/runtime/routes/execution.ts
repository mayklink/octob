import type { IncomingMessage, ServerResponse } from 'node:http'
import type { DatabaseService } from '../../main/db/database'
import { bashService } from '../../main/services/bash-service'
import { scriptRunner } from '../../main/services/script-runner'
import { assignPort, getAssignedPort } from '../../main/services/port-registry'
import { getAllowedOrigin, readJsonBody, writeJson, type JsonRecord } from '../http'
import { isPathAllowed } from '../path-guard'

interface ExecutionContext {
  db: DatabaseService
  allowedOrigins: Set<string>
}

function streamHeaders(
  request: IncomingMessage,
  allowedOrigins: Set<string>
): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no'
  }
  const origin = getAllowedOrigin(request, allowedOrigins)
  if (origin) {
    headers['access-control-allow-origin'] = origin
    headers.vary = 'Origin'
  }
  return headers
}

function writeEvent(response: ServerResponse, value: unknown): void {
  if (!response.destroyed && !response.writableEnded) {
    response.write(JSON.stringify(value) + '\n')
  }
}

function resolvePortEnv(
  db: DatabaseService,
  worktreeId: string,
  cwd: string
): Record<string, string> {
  const worktree = db.getWorktree(worktreeId)
  if (!worktree) return {}
  const project = db.getProject(worktree.project_id)
  if (!project?.auto_assign_port) return {}

  let port = getAssignedPort(cwd)
  if (port === null) port = assignPort(cwd)
  return { PORT: String(port) }
}

function validCwd(context: ExecutionContext, cwd: unknown): cwd is string {
  return typeof cwd === 'string' && isPathAllowed(context.db, cwd)
}

export async function handleExecutionRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  context: ExecutionContext
): Promise<boolean> {
  if (
    request.method === 'GET' &&
    (url.pathname === '/v1/bash/stream' || url.pathname === '/v1/scripts/stream')
  ) {
    response.writeHead(200, streamHeaders(request, context.allowedOrigins))
    writeEvent(response, { type: 'runtime.ready' })

    const dispose = url.pathname === '/v1/bash/stream'
      ? bashService.onEvent((event) => writeEvent(response, event))
      : scriptRunner.onEvent((eventKey, event) => writeEvent(response, { eventKey, event }))

    const cleanup = (): void => dispose()
    request.once('close', cleanup)
    response.once('close', cleanup)
    return true
  }

  if (url.pathname.startsWith('/v1/bash/')) {
    const body = await readJsonBody<JsonRecord>(request)
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''

    if (request.method === 'POST' && url.pathname === '/v1/bash/run') {
      if (
        !sessionId ||
        typeof body.command !== 'string' ||
        !validCwd(context, body.cwd)
      ) {
        writeJson(request, response, context.allowedOrigins, 400, { error: 'invalid_request' })
        return true
      }
      try {
        const { runId } = await bashService.run(sessionId, body.command, body.cwd)
        writeJson(request, response, context.allowedOrigins, 200, { success: true, runId })
      } catch (error) {
        writeJson(request, response, context.allowedOrigins, 409, {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        })
      }
      return true
    }

    if (request.method === 'POST' && url.pathname === '/v1/bash/abort') {
      writeJson(request, response, context.allowedOrigins, 200, {
        success: await bashService.abort(sessionId)
      })
      return true
    }

    if (request.method === 'POST' && url.pathname === '/v1/bash/get') {
      writeJson(request, response, context.allowedOrigins, 200, bashService.getRun(sessionId))
      return true
    }

    return false
  }

  if (!url.pathname.startsWith('/v1/scripts/')) return false
  const body = await readJsonBody<JsonRecord>(request)
  const worktreeId = typeof body.worktreeId === 'string' ? body.worktreeId : ''
  const commands = Array.isArray(body.commands)
    ? body.commands.filter((value): value is string => typeof value === 'string')
    : []
  if (request.method === 'POST' && url.pathname === '/v1/scripts/run-setup') {
    if (!worktreeId || !validCwd(context, body.cwd) || commands.length === 0) {
      writeJson(request, response, context.allowedOrigins, 400, { error: 'invalid_request' })
      return true
    }
    const result = await scriptRunner.runSequential(
      commands,
      body.cwd,
      `script:setup:${worktreeId}`,
      resolvePortEnv(context.db, worktreeId, body.cwd)
    )
    writeJson(request, response, context.allowedOrigins, 200, result)
    return true
  }

  if (request.method === 'POST' && url.pathname === '/v1/scripts/run-project') {
    if (!worktreeId || !validCwd(context, body.cwd) || commands.length === 0) {
      writeJson(request, response, context.allowedOrigins, 400, { error: 'invalid_request' })
      return true
    }
    const handle = await scriptRunner.runPersistent(
      commands,
      body.cwd,
      `script:run:${worktreeId}`,
      resolvePortEnv(context.db, worktreeId, body.cwd)
    )
    writeJson(request, response, context.allowedOrigins, 200, {
      success: true,
      pid: handle.pid
    })
    return true
  }
  if (request.method === 'POST' && url.pathname === '/v1/scripts/kill') {
    if (!worktreeId) {
      writeJson(request, response, context.allowedOrigins, 400, { error: 'worktreeId_required' })
      return true
    }
    await scriptRunner.killProcess(`script:run:${worktreeId}`)
    writeJson(request, response, context.allowedOrigins, 200, { success: true })
    return true
  }

  if (request.method === 'POST' && url.pathname === '/v1/scripts/state') {
    const eventKey = `script:run:${worktreeId}`
    writeJson(request, response, context.allowedOrigins, 200, {
      events: scriptRunner.getEventHistory(eventKey),
      running: scriptRunner.isRunning(eventKey),
      pid: scriptRunner.getPid(eventKey)
    })
    return true
  }

  if (request.method === 'POST' && url.pathname === '/v1/scripts/archive') {
    if (!validCwd(context, body.cwd) || commands.length === 0) {
      writeJson(request, response, context.allowedOrigins, 400, { error: 'invalid_request' })
      return true
    }
    const result = await scriptRunner.runAndWait(commands, body.cwd, 30_000)
    writeJson(request, response, context.allowedOrigins, 200, result)
    return true
  }
  if (request.method === 'POST' && url.pathname === '/v1/scripts/port') {
    if (!validCwd(context, body.cwd)) {
      writeJson(request, response, context.allowedOrigins, 403, { error: 'path_not_allowed' })
      return true
    }
    writeJson(request, response, context.allowedOrigins, 200, {
      port: getAssignedPort(body.cwd)
    })
    return true
  }

  return false
}
