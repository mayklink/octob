import type { IncomingMessage, ServerResponse } from 'node:http'
import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { readJsonBody, writeJson, type JsonRecord } from '../http'

interface LoggingRouteContext {
  allowedOrigins: Set<string>
}

const responseLogDir = join(homedir(), '.octob', 'logs', 'responses')

function ensureResponseLogDir(): void {
  if (!existsSync(responseLogDir)) mkdirSync(responseLogDir, { recursive: true })
}

function isAllowedResponseLogPath(filePath: string): boolean {
  const candidate = resolve(filePath)
  const root = resolve(responseLogDir)
  const rel = relative(root, candidate)
  return isAbsolute(filePath) && rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`)
}

function createResponseLog(sessionId: string): string {
  ensureResponseLogDir()
  const timestamp = new Date().toISOString()
  const safeSessionId = sessionId.replace(/[^a-zA-Z0-9._-]/g, '_')
  const filePath = join(
    responseLogDir,
    `${safeSessionId}-${timestamp.replace(/[:.]/g, '-')}.jsonl`
  )
  appendFileSync(
    filePath,
    `${JSON.stringify({ type: 'session_start', sessionId, timestamp })}\n`,
    'utf8'
  )
  return filePath
}

function appendResponseLog(filePath: string, data: unknown): void {
  if (!isAllowedResponseLogPath(filePath)) throw new Error('response_log_path_not_allowed')
  const entry = {
    ...(typeof data === 'object' && data !== null ? data : { data }),
    timestamp: new Date().toISOString()
  }
  appendFileSync(filePath, `${JSON.stringify(entry)}\n`, 'utf8')
}

export async function handleLoggingRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  context: LoggingRouteContext
): Promise<boolean> {
  if (!url.pathname.startsWith('/v1/logging/')) return false
  if (request.method !== 'POST') return false

  const body = await readJsonBody<JsonRecord>(request)
  try {
    if (url.pathname === '/v1/logging/create') {
      if (typeof body.sessionId !== 'string' || !body.sessionId) {
        writeJson(request, response, context.allowedOrigins, 400, { error: 'session_id_required' })
        return true
      }
      writeJson(request, response, context.allowedOrigins, 200, {
        path: createResponseLog(body.sessionId)
      })
      return true
    }

    if (url.pathname === '/v1/logging/append') {
      if (typeof body.filePath !== 'string') {
        writeJson(request, response, context.allowedOrigins, 400, { error: 'file_path_required' })
        return true
      }
      appendResponseLog(body.filePath, body.data)
      writeJson(request, response, context.allowedOrigins, 200, { success: true })
      return true
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    writeJson(request, response, context.allowedOrigins, message === 'response_log_path_not_allowed' ? 403 : 500, {
      error: message
    })
    return true
  }

  return false
}
