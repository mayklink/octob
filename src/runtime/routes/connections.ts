import type { IncomingMessage, ServerResponse } from 'node:http'
import type { DatabaseService } from '../../main/db/database'
import {
  addConnectionMemberOp,
  createConnectionOp,
  deleteConnectionOp,
  removeConnectionMemberOp,
  removeWorktreeFromAllConnectionsOp,
  renameConnectionOp
} from '../../main/services/connection-ops'
import { readJsonBody, writeJson, type JsonRecord } from '../http'

interface ConnectionRouteContext {
  db: DatabaseService
  allowedOrigins: Set<string>
}

export async function handleConnectionRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  context: ConnectionRouteContext
): Promise<boolean> {
  if (!url.pathname.startsWith('/v1/connections/')) return false
  if (request.method !== 'POST') return false

  const operation = url.pathname.slice('/v1/connections/'.length)
  const body = await readJsonBody<JsonRecord>(request)
  if (operation === 'create') {
    const worktreeIds = Array.isArray(body.worktreeIds)
      ? body.worktreeIds.filter((value): value is string => typeof value === 'string')
      : []
    if (worktreeIds.length === 0) {
      writeJson(request, response, context.allowedOrigins, 400, {
        error: 'worktreeIds_required'
      })
      return true
    }
    const result = await createConnectionOp(context.db, worktreeIds)
    writeJson(request, response, context.allowedOrigins, 200, result)
    return true
  }

  if (operation === 'delete') {
    if (typeof body.connectionId !== 'string') {
      writeJson(request, response, context.allowedOrigins, 400, {
        error: 'connectionId_required'
      })
      return true
    }
    const result = await deleteConnectionOp(context.db, body.connectionId)
    writeJson(request, response, context.allowedOrigins, 200, result)
    return true
  }
  if (operation === 'rename') {
    if (typeof body.connectionId !== 'string') {
      writeJson(request, response, context.allowedOrigins, 400, {
        error: 'connectionId_required'
      })
      return true
    }
    const customName = typeof body.customName === 'string' ? body.customName : null
    const result = await renameConnectionOp(context.db, body.connectionId, customName)
    writeJson(request, response, context.allowedOrigins, 200, result)
    return true
  }

  if (operation === 'add-member' || operation === 'remove-member') {
    if (
      typeof body.connectionId !== 'string' ||
      typeof body.worktreeId !== 'string'
    ) {
      writeJson(request, response, context.allowedOrigins, 400, {
        error: 'invalid_request'
      })
      return true
    }

    const result = operation === 'add-member'
      ? await addConnectionMemberOp(context.db, body.connectionId, body.worktreeId)
      : await removeConnectionMemberOp(context.db, body.connectionId, body.worktreeId)

    writeJson(request, response, context.allowedOrigins, 200, result)
    return true
  }
  if (operation === 'remove-worktree') {
    if (typeof body.worktreeId !== 'string') {
      writeJson(request, response, context.allowedOrigins, 400, {
        error: 'worktreeId_required'
      })
      return true
    }
    const result = await removeWorktreeFromAllConnectionsOp(context.db, body.worktreeId)
    writeJson(request, response, context.allowedOrigins, 200, result)
    return true
  }

  writeJson(request, response, context.allowedOrigins, 404, {
    error: 'connection_operation_not_found'
  })
  return true
}
