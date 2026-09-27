import type { IncomingMessage, ServerResponse } from 'node:http'
import { getCapabilityStudio } from '../../main/services/capability-studio'
import { readJsonBody, writeJson } from '../http'

export async function handleCapabilityStudioRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  context: { allowedOrigins: Set<string> }
): Promise<boolean> {
  if (!url.pathname.startsWith('/v1/capability-studio')) return false
  const studio = getCapabilityStudio()
  const path = url.pathname.slice('/v1/capability-studio'.length).split('/').filter(Boolean)
  const method = request.method
  let result: unknown
  if (method === 'GET' && path.length === 0) result = studio.list()
  else if (method === 'GET' && path.length === 1) {
    result = studio.get(path[0], url.searchParams.has('version') ? Number(url.searchParams.get('version')) : undefined)
  } else if (method === 'POST' && path.length === 2) {
    const body = await readJsonBody<{ version?: number; input?: unknown }>(request)
    if (path[1] === 'validate') result = await studio.validate(path[0], body.version)
    else if (path[1] === 'execute') {
      const controller = new AbortController()
      const abortOnRequestClose = (): void => controller.abort()
      const abortOnResponseClose = (): void => {
        if (!response.writableEnded) controller.abort()
      }
      request.once('aborted', abortOnRequestClose)
      response.once('close', abortOnResponseClose)
      if (request.aborted) controller.abort()
      try {
        result = await studio.execute(path[0], body.input, body.version, controller.signal)
      } finally {
        request.off('aborted', abortOnRequestClose)
        response.off('close', abortOnResponseClose)
      }
    }
    else if (path[1] === 'install') result = studio.install(path[0], Number(body.version))
    else if (path[1] === 'deactivate') result = studio.deactivate(path[0])
    else if (path[1] === 'discard') result = studio.discard(path[0])
    else return false
  } else return false
  writeJson(request, response, context.allowedOrigins, 200, result ?? { ok: true })
  return true
}
