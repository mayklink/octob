import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdirSync } from 'node:fs'
import type { DatabaseService } from '../../main/db/database'
import {
  getAssistantMcpUrl,
  getAssistantProjectInstructions,
  getAssistantTasks,
  getAssistantWorkspacePath,
  getPendingAssistantProjectSelections,
  removeAssistantTask,
  resolveAssistantProjectSelection,
  setAssistantProjectInstructions
} from '../../main/services/assistant-mcp-service'
import { runtimeAssistantWindow } from '../assistant-runtime'
import { getAllowedOrigin, readJsonBody, writeJson, type JsonRecord } from '../http'

interface AssistantRouteContext {
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

export async function handleAssistantRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  context: AssistantRouteContext
): Promise<boolean> {
  if (!url.pathname.startsWith('/v1/assistant/')) return false

  if (request.method === 'GET' && url.pathname === '/v1/assistant/stream') {
    response.writeHead(200, streamHeaders(request, context.allowedOrigins))
    writeEvent(response, { type: 'runtime.ready' })
    const dispose = runtimeAssistantWindow.onEvent((event) => writeEvent(response, event))
    const cleanup = (): void => dispose()
    request.once('close', cleanup)
    response.once('close', cleanup)
    return true
  }
  if (request.method === 'GET' && url.pathname === '/v1/assistant/workspace') {
    const path = getAssistantWorkspacePath()
    mkdirSync(path, { recursive: true })
    writeJson(request, response, context.allowedOrigins, 200, { path })
    return true
  }

  if (request.method === 'GET' && url.pathname === '/v1/assistant/status') {
    writeJson(request, response, context.allowedOrigins, 200, {
      ready: Boolean(getAssistantMcpUrl()),
      workspacePath: getAssistantWorkspacePath()
    })
    return true
  }

  if (request.method === 'GET' && url.pathname === '/v1/assistant/session') {
    const projectId = url.searchParams.get('projectId')
    if (!projectId) {
      writeJson(request, response, context.allowedOrigins, 400, { error: 'projectId_required' })
      return true
    }
    const session = context.db.createSession({
      id: url.searchParams.get('id') || undefined,
      worktree_id: null,
      project_id: projectId,
      name: url.searchParams.get('name') ?? 'Assistente Global',
      agent_sdk: (url.searchParams.get('agentSdk') ?? 'opencode') as never,
      model_provider_id: url.searchParams.get('modelProviderId') || null,
      model_id: url.searchParams.get('modelId') || null,
      model_variant: url.searchParams.get('modelVariant') || null
    })
    writeJson(request, response, context.allowedOrigins, 200, session)
    return true
  }

  if (request.method === 'GET' && url.pathname === '/v1/assistant/tasks') {
    writeJson(request, response, context.allowedOrigins, 200, getAssistantTasks(context.db))
    return true
  }

  if (
    request.method === 'GET' &&
    url.pathname === '/v1/assistant/project-selection-requests'
  ) {
    writeJson(
      request,
      response,
      context.allowedOrigins,
      200,
      getPendingAssistantProjectSelections()
    )
    return true
  }

  if (request.method === 'GET' && url.pathname === '/v1/assistant/instructions') {
    const projectId = url.searchParams.get('projectId') ?? ''
    writeJson(
      request,
      response,
      context.allowedOrigins,
      200,
      getAssistantProjectInstructions(context.db, projectId)
    )
    return true
  }
  if (request.method !== 'POST') return false
  const body = await readJsonBody<JsonRecord>(request)

  if (url.pathname === '/v1/assistant/remove-task') {
    if (typeof body.sessionId !== 'string') {
      writeJson(request, response, context.allowedOrigins, 400, { error: 'sessionId_required' })
      return true
    }
    writeJson(
      request,
      response,
      context.allowedOrigins,
      200,
      removeAssistantTask(context.db, body.sessionId)
    )
    return true
  }

  if (url.pathname === '/v1/assistant/resolve-project-selection') {
    if (typeof body.requestId !== 'string') {
      writeJson(request, response, context.allowedOrigins, 400, { error: 'requestId_required' })
      return true
    }
    const projectId = typeof body.projectId === 'string' ? body.projectId : null
    writeJson(
      request,
      response,
      context.allowedOrigins,
      200,
      { resolved: resolveAssistantProjectSelection(body.requestId, projectId) }
    )
    return true
  }
  if (url.pathname === '/v1/assistant/instructions') {
    if (
      typeof body.projectId !== 'string' ||
      !Array.isArray(body.instructions)
    ) {
      writeJson(request, response, context.allowedOrigins, 400, { error: 'invalid_request' })
      return true
    }
    const instructions = body.instructions.filter(
      (value): value is string => typeof value === 'string'
    )
    writeJson(
      request,
      response,
      context.allowedOrigins,
      200,
      setAssistantProjectInstructions(context.db, body.projectId, instructions)
    )
    return true
  }

  return false
}
