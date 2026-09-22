import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  deleteAttachment,
  saveAttachment
} from '../../main/services/attachment-storage'
import { readJsonBody, writeJson, type JsonRecord } from '../http'

interface AttachmentRouteContext {
  allowedOrigins: Set<string>
}

export async function handleAttachmentRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  context: AttachmentRouteContext
): Promise<boolean> {
  if (!url.pathname.startsWith('/v1/attachments/')) return false
  if (request.method !== 'POST') return false

  const body = await readJsonBody<JsonRecord>(request, 14 * 1024 * 1024)

  if (url.pathname === '/v1/attachments/save') {
    if (typeof body.data !== 'string' || typeof body.originalName !== 'string') {
      writeJson(request, response, context.allowedOrigins, 400, { error: 'invalid_request' })
      return true
    }
    const result = await saveAttachment(Buffer.from(body.data, 'base64'), body.originalName)
    writeJson(request, response, context.allowedOrigins, 200, result)
    return true
  }

  if (url.pathname === '/v1/attachments/delete') {
    if (typeof body.filePath !== 'string') {
      writeJson(request, response, context.allowedOrigins, 400, { error: 'invalid_request' })
      return true
    }
    const result = await deleteAttachment(body.filePath)
    writeJson(request, response, context.allowedOrigins, 200, result)
    return true
  }

  return false
}
