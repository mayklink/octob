import type { IncomingMessage, ServerResponse } from 'node:http'
import type { DatabaseService } from '../../main/db/database'
import { ptyService } from '../../main/services/pty-service'
import { getAllowedOrigin, readJsonBody, writeJson, type JsonRecord } from '../http'
import { isPathAllowed } from '../path-guard'

interface TerminalRouteContext {
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

export async function handleTerminalRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  context: TerminalRouteContext
): Promise<boolean> {
  if (!url.pathname.startsWith('/v1/terminal')) return false

  if (request.method === 'GET' && url.pathname === '/v1/terminal/stream') {
    const terminalId = url.searchParams.get('terminalId')
    if (!terminalId || !ptyService.has(terminalId)) {
      writeJson(request, response, context.allowedOrigins, 404, { error: 'terminal_not_found' })
      return true
    }

    response.writeHead(200, streamHeaders(request, context.allowedOrigins))
    writeEvent(response, { type: 'ready', terminalId })

    const removeData = ptyService.onData(terminalId, (data) => {
      writeEvent(response, { type: 'data', data })
    })
    const removeExit = ptyService.onExit(terminalId, (code, signal) => {
      writeEvent(response, { type: 'exit', code, signal })
      response.end()
    })

    const cleanup = (): void => {
      removeData()
      removeExit()
    }
    response.once('close', cleanup)
    return true
  }

  const body = await readJsonBody<JsonRecord>(request)
  const terminalId = typeof body.terminalId === 'string' ? body.terminalId : null

  if (request.method === 'POST' && url.pathname === '/v1/terminal/create') {
    const cwd = typeof body.cwd === 'string' ? body.cwd : null
    const shell = typeof body.shell === 'string' ? body.shell : undefined
    const commandRecord =
      typeof body.command === 'object' && body.command !== null && !Array.isArray(body.command)
        ? (body.command as JsonRecord)
        : null
    const command =
      typeof commandRecord?.file === 'string' &&
      Array.isArray(commandRecord.args) &&
      commandRecord.args.every((arg) => typeof arg === 'string')
        ? { file: commandRecord.file, args: commandRecord.args as string[] }
        : undefined
    if (body.command !== undefined && !command) {
      writeJson(request, response, context.allowedOrigins, 400, { error: 'invalid_command' })
      return true
    }
    if (!terminalId || !cwd) {
      writeJson(request, response, context.allowedOrigins, 400, { error: 'invalid_request' })
      return true
    }
    if (!isPathAllowed(context.db, cwd)) {
      writeJson(request, response, context.allowedOrigins, 403, { error: 'path_not_allowed' })
      return true
    }
    try {
      const size = ptyService.create(terminalId, { cwd, shell, command })
      writeJson(request, response, context.allowedOrigins, 200, { success: true, ...size })
    } catch (error) {
      writeJson(request, response, context.allowedOrigins, 500, {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      })
    }
    return true
  }

  // A browser can retain a terminal tab across a runtime restart, while PTYs
  // only live in memory. Focus/liveness cleanup is advisory in that state:
  // acknowledge it so React does not retry an already-dead terminal forever.
  // Commands that mutate a terminal still fail below, so we never hide lost
  // input or a failed resize.
  const isLifecycleOperation =
    (request.method === 'POST' &&
      (url.pathname === '/v1/terminal/focus' || url.pathname === '/v1/terminal/keep-alive')) ||
    (request.method === 'DELETE' && url.pathname === '/v1/terminal')

  if (!terminalId || !ptyService.has(terminalId)) {
    if (terminalId && isLifecycleOperation) {
      writeJson(request, response, context.allowedOrigins, 200, {
        success: true,
        terminalMissing: true
      })
      return true
    }
    writeJson(request, response, context.allowedOrigins, 404, { error: 'terminal_not_found' })
    return true
  }

  if (request.method === 'POST' && url.pathname === '/v1/terminal/write') {
    if (typeof body.data !== 'string') {
      writeJson(request, response, context.allowedOrigins, 400, { error: 'data_required' })
      return true
    }
    ptyService.write(terminalId, body.data)
    writeJson(request, response, context.allowedOrigins, 200, { success: true })
    return true
  }

  if (request.method === 'POST' && url.pathname === '/v1/terminal/resize') {
    const cols = typeof body.cols === 'number' ? body.cols : 0
    const rows = typeof body.rows === 'number' ? body.rows : 0
    if (cols < 1 || rows < 1 || cols > 1000 || rows > 1000) {
      writeJson(request, response, context.allowedOrigins, 400, { error: 'invalid_size' })
      return true
    }
    ptyService.resize(terminalId, cols, rows)
    writeJson(request, response, context.allowedOrigins, 200, { success: true })
    return true
  }

  if (request.method === 'POST' && url.pathname === '/v1/terminal/focus') {
    ptyService.setFocus(terminalId, body.focused === true)
    writeJson(request, response, context.allowedOrigins, 200, { success: true })
    return true
  }

  if (request.method === 'POST' && url.pathname === '/v1/terminal/keep-alive') {
    ptyService.setKeepAlive(terminalId, body.keepAlive === true)
    writeJson(request, response, context.allowedOrigins, 200, { success: true })
    return true
  }

  if (request.method === 'DELETE' && url.pathname === '/v1/terminal') {
    ptyService.destroy(terminalId)
    writeJson(request, response, context.allowedOrigins, 200, { success: true })
    return true
  }

  writeJson(request, response, context.allowedOrigins, 404, { error: 'terminal_operation_not_found' })
  return true
}
