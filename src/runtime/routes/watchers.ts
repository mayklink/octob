import type { IncomingMessage, ServerResponse } from 'node:http'
import type { DatabaseService } from '../../main/db/database'
import { getAllowedOrigin, readJsonBody, writeJson, type JsonRecord } from '../http'
import { isRegisteredWorkspaceRoot } from '../path-guard'
import { runtimeWatchers } from '../watcher-runtime'

interface WatcherRouteContext {
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

export async function handleWatcherRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  context: WatcherRouteContext
): Promise<boolean> {
  if (!url.pathname.startsWith('/v1/watchers/')) return false

  if (request.method === 'GET' && url.pathname === '/v1/watchers/stream') {
    response.writeHead(200, streamHeaders(request, context.allowedOrigins))
    response.write(JSON.stringify({ type: 'runtime.ready' }) + '\n')
    const dispose = runtimeWatchers.onEvent((event) => {
      if (!response.destroyed && !response.writableEnded) {
        response.write(JSON.stringify(event) + '\n')
      }
    })
    const cleanup = (): void => dispose()
    request.once('close', cleanup)
    response.once('close', cleanup)
    return true
  }

  if (request.method !== 'POST') return false
  const body = await readJsonBody<JsonRecord>(request)
  const worktreePath = typeof body.worktreePath === 'string' ? body.worktreePath : ''
  if (!worktreePath || !isRegisteredWorkspaceRoot(context.db, worktreePath)) {
    writeJson(request, response, context.allowedOrigins, 403, { error: 'path_not_allowed' })
    return true
  }

  const operation = url.pathname.slice('/v1/watchers/'.length)
  if (operation === 'file/watch') await runtimeWatchers.watchFiles(worktreePath)
  else if (operation === 'file/unwatch') await runtimeWatchers.unwatchFiles(worktreePath)
  else if (operation === 'git/watch') await runtimeWatchers.watchGit(worktreePath)
  else if (operation === 'git/unwatch') await runtimeWatchers.unwatchGit(worktreePath)
  else if (operation === 'branch/watch') await runtimeWatchers.watchBranch(worktreePath)
  else if (operation === 'branch/unwatch') await runtimeWatchers.unwatchBranch(worktreePath)
  else {
    writeJson(request, response, context.allowedOrigins, 404, { error: 'watcher_operation_not_found' })
    return true
  }

  writeJson(request, response, context.allowedOrigins, 200, { success: true })
  return true
}
