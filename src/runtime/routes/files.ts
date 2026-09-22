import type { IncomingMessage, ServerResponse } from 'node:http'
import type { DatabaseService } from '../../main/db/database'
import {
  createFile,
  deleteFile,
  readFile,
  readFileAsBase64,
  writeFile
} from '../../main/services/file-ops'
import { canCreateInsideWorkspace, isPathAllowed, isRegisteredWorkspaceRoot } from '../path-guard'
import { readJsonBody, writeJson, type JsonRecord } from '../http'

interface FileRouteContext {
  db: DatabaseService
  allowedOrigins: Set<string>
}

export async function handleFileRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  context: FileRouteContext
): Promise<boolean> {
  if (!url.pathname.startsWith('/v1/files')) return false

  if (request.method === 'GET' && url.pathname === '/v1/files/read') {
    const path = url.searchParams.get('path')
    if (!path || !isPathAllowed(context.db, path)) {
      writeJson(request, response, context.allowedOrigins, 403, { error: 'path_not_allowed' })
      return true
    }
    writeJson(request, response, context.allowedOrigins, 200, readFile(path))
    return true
  }

  if (request.method === 'GET' && url.pathname === '/v1/files/image') {
    const path = url.searchParams.get('path')
    if (!path || !isPathAllowed(context.db, path)) {
      writeJson(request, response, context.allowedOrigins, 403, { error: 'path_not_allowed' })
      return true
    }
    writeJson(request, response, context.allowedOrigins, 200, readFileAsBase64(path))
    return true
  }

  if (request.method === 'PUT' && url.pathname === '/v1/files/content') {
    const body = await readJsonBody<JsonRecord>(request)
    if (typeof body.path !== 'string' || typeof body.content !== 'string') {
      writeJson(request, response, context.allowedOrigins, 400, { error: 'invalid_body' })
      return true
    }
    if (!isPathAllowed(context.db, body.path)) {
      writeJson(request, response, context.allowedOrigins, 403, { error: 'path_not_allowed' })
      return true
    }
    writeJson(request, response, context.allowedOrigins, 200, writeFile(body.path, body.content))
    return true
  }

  if (request.method === 'POST' && url.pathname === '/v1/files') {
    const body = await readJsonBody<JsonRecord>(request)
    if (
      typeof body.worktreePath !== 'string' ||
      typeof body.relativePath !== 'string' ||
      (body.content !== undefined && typeof body.content !== 'string')
    ) {
      writeJson(request, response, context.allowedOrigins, 400, { error: 'invalid_body' })
      return true
    }
    if (!canCreateInsideWorkspace(context.db, body.worktreePath, body.relativePath)) {
      writeJson(request, response, context.allowedOrigins, 403, { error: 'path_not_allowed' })
      return true
    }
    const result = createFile(body.worktreePath, body.relativePath, body.content ?? '')
    writeJson(request, response, context.allowedOrigins, 200, result)
    return true
  }

  if (request.method === 'DELETE' && url.pathname === '/v1/files') {
    const body = await readJsonBody<JsonRecord>(request)
    if (typeof body.worktreePath !== 'string' || typeof body.filePath !== 'string') {
      writeJson(request, response, context.allowedOrigins, 400, { error: 'invalid_body' })
      return true
    }
    if (
      !isRegisteredWorkspaceRoot(context.db, body.worktreePath) ||
      !isPathAllowed(context.db, body.filePath)
    ) {
      writeJson(request, response, context.allowedOrigins, 403, { error: 'path_not_allowed' })
      return true
    }
    writeJson(
      request,
      response,
      context.allowedOrigins,
      200,
      deleteFile(body.worktreePath, body.filePath)
    )
    return true
  }

  return false
}
