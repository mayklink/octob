import type { IncomingMessage, ServerResponse } from 'node:http'
import type { DatabaseService } from '../../main/db/database'
import { onAgentStreamEvent } from '../../main/services/agent-event-bus'
import type { AgentSdkId } from '../../main/services/agent-sdk-types'
import type { RuntimeAgentService } from '../agent-runtime'
import { getAllowedOrigin, readJsonBody, writeJson, type JsonRecord } from '../http'
import { isPathAllowed } from '../path-guard'

interface AgentRouteContext {
  db: DatabaseService
  agents: RuntimeAgentService
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

export async function handleAgentRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  context: AgentRouteContext
): Promise<boolean> {
  if (!url.pathname.startsWith('/v1/agents')) return false

  if (request.method === 'GET' && url.pathname === '/v1/agents/stream') {
    response.writeHead(200, streamHeaders(request, context.allowedOrigins))
    writeEvent(response, { type: 'runtime.ready' })
    const dispose = onAgentStreamEvent((event) => writeEvent(response, event))
    const cleanup = (): void => dispose()
    request.once('close', cleanup)
    response.once('close', cleanup)
    return true
  }

  if (request.method === 'GET' && url.pathname === '/v1/agents/detect') {
    writeJson(request, response, context.allowedOrigins, 200, context.agents.detect())
    return true
  }

  if (request.method !== 'POST') return false
  const body = await readJsonBody<JsonRecord>(request)
  const operation = url.pathname.slice('/v1/agents/'.length)
  const requestedWorkspace =
    typeof body.worktreePath === 'string' ? body.worktreePath : ''
  if (requestedWorkspace && !isPathAllowed(context.db, requestedWorkspace)) {
    writeJson(request, response, context.allowedOrigins, 403, {
      success: false,
      error: 'path_not_allowed'
    })
    return true
  }

  try {
    const result = await dispatchAgentOperation(context.agents, operation, body)
    writeJson(request, response, context.allowedOrigins, 200, result)
  } catch (error) {
    writeJson(request, response, context.allowedOrigins, 200, {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    })
  }
  return true
}

async function dispatchAgentOperation(
  agents: RuntimeAgentService,
  operation: string,
  body: JsonRecord
): Promise<unknown> {
  const worktreePath = typeof body.worktreePath === 'string' ? body.worktreePath : ''
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
  const octobSessionId =
    typeof body.octobSessionId === 'string' ? body.octobSessionId : sessionId

  switch (operation) {
    case 'connect':
      return agents.connect(worktreePath, octobSessionId)
    case 'reconnect':
      return agents.reconnect(worktreePath, sessionId, octobSessionId)
    case 'prompt':
      return agents.prompt(
        worktreePath,
        sessionId,
        (body.parts ?? body.message ?? '') as never,
        body.model as never,
        body.options as never
      )
    case 'abort':
      return agents.abort(worktreePath, sessionId)
    case 'disconnect':
      return agents.disconnect(worktreePath, sessionId)
    case 'messages':
      return agents.getMessages(worktreePath, sessionId)
    case 'models':
      return agents.listModels((body.agentSdk as AgentSdkId | undefined) ?? 'opencode')
    case 'set-model':
      return agents.setModel((body.model ?? null) as never)
    case 'model-info':
      return agents.modelInfo(
        worktreePath,
        String(body.modelId ?? ''),
        (body.agentSdk as AgentSdkId | undefined) ?? 'opencode'
      )
    case 'capabilities':
      return agents.capabilities(sessionId || undefined)
    case 'session-info':
      return agents.sessionInfo(worktreePath, sessionId)
    case 'question-reply':
      return agents.questionReply(
        String(body.requestId ?? ''),
        Array.isArray(body.answers) ? body.answers as string[][] : [],
        typeof body.worktreePath === 'string' ? body.worktreePath : undefined
      )
    case 'question-reject':
      return agents.questionReject(
        String(body.requestId ?? ''),
        typeof body.worktreePath === 'string' ? body.worktreePath : undefined
      )
    case 'permission-reply':
      return agents.permissionReply(
        String(body.requestId ?? ''),
        body.reply as 'once' | 'always' | 'reject',
        typeof body.worktreePath === 'string' ? body.worktreePath : undefined,
        typeof body.message === 'string' ? body.message : undefined
      )
    case 'permission-list':
      return agents.permissionList(
        typeof body.worktreePath === 'string' ? body.worktreePath : undefined
      )
    case 'plan-approve':
      return agents.planApprove(
        worktreePath,
        octobSessionId,
        typeof body.requestId === 'string' ? body.requestId : undefined
      )
    case 'plan-reject':
      return agents.planReject(
        worktreePath,
        octobSessionId,
        String(body.feedback ?? ''),
        typeof body.requestId === 'string' ? body.requestId : undefined
      )
    case 'command-approval-reply':
      return agents.commandApprovalReply(
        String(body.requestId ?? ''),
        body.approved === true,
        body.remember as 'allow' | 'block' | undefined,
        typeof body.pattern === 'string' ? body.pattern : undefined,
        Array.isArray(body.patterns) ? body.patterns as string[] : undefined
      )
    case 'undo':
      return agents.undo(worktreePath, sessionId)
    case 'redo':
      return agents.redo(worktreePath, sessionId)
    case 'commands':
      return agents.commands(worktreePath, sessionId || undefined)
    case 'command':
      return agents.command(
        worktreePath,
        sessionId,
        String(body.command ?? ''),
        typeof body.args === 'string' ? body.args : undefined
      )
    case 'rename':
      return agents.renameSession(
        sessionId,
        String(body.title ?? ''),
        typeof body.worktreePath === 'string' ? body.worktreePath : ''
      )
    case 'steer':
      return agents.steer(worktreePath, sessionId, String(body.message ?? ''))
    case 'fork':
      return agents.fork(
        worktreePath,
        sessionId,
        typeof body.messageId === 'string' ? body.messageId : undefined
      )
    default:
      return { success: false, error: 'agent_operation_not_found' }
  }
}
