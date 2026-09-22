import type { IncomingMessage, ServerResponse } from 'node:http'
import type { DatabaseService } from '../../main/db/database'
import type { ProjectCreate, ProjectUpdate, WorktreeUpdate } from '../../main/db/types'
import { readJsonBody, writeJson, type JsonRecord } from '../http'

interface DatabaseRouteContext {
  db: DatabaseService
  allowedOrigins: Set<string>
}

function segments(pathname: string): string[] {
  return pathname.split('/').filter(Boolean).map(decodeURIComponent)
}

export async function handleDatabaseRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  context: DatabaseRouteContext
): Promise<boolean> {
  if (!url.pathname.startsWith('/v1/db/')) return false
  const parts = segments(url.pathname)
  const resource = parts[2]
  const id = parts[3]

  if (resource === 'projects' && !id) {
    if (request.method === 'GET') {
      writeJson(request, response, context.allowedOrigins, 200, context.db.getAllProjects())
      return true
    }
    if (request.method === 'POST') {
      const body = await readJsonBody<JsonRecord>(request)
      const project = context.db.createProject(body as unknown as ProjectCreate)
      context.db.createWorktree({
        project_id: project.id,
        name: '(no-worktree)',
        branch_name: '',
        path: project.path,
        is_default: true
      })
      writeJson(request, response, context.allowedOrigins, 201, project)
      return true
    }
  }

  if (resource === 'projects' && id && parts[4] === 'worktrees') {
    if (request.method === 'GET') {
      const worktrees = context.db.getWorktreesByProject(id)
      writeJson(request, response, context.allowedOrigins, 200, worktrees)
      return true
    }
  }

  if (resource === 'projects' && id && parts.length === 4) {
    if (request.method === 'GET') {
      const project = context.db.getProject(id)
      writeJson(request, response, context.allowedOrigins, project ? 200 : 404, project ?? { error: 'not_found' })
      return true
    }
    if (request.method === 'PATCH') {
      const body = await readJsonBody<JsonRecord>(request)
      const project = context.db.updateProject(id, body as unknown as ProjectUpdate)
      writeJson(request, response, context.allowedOrigins, project ? 200 : 404, project ?? { error: 'not_found' })
      return true
    }
    if (request.method === 'DELETE') {
      const deleted = context.db.deleteProject(id)
      writeJson(request, response, context.allowedOrigins, deleted ? 200 : 404, { deleted })
      return true
    }
  }

  if (resource === 'worktrees' && id && parts.length === 4) {
    if (request.method === 'GET') {
      const worktree = context.db.getWorktree(id)
      writeJson(request, response, context.allowedOrigins, worktree ? 200 : 404, worktree ?? { error: 'not_found' })
      return true
    }
    if (request.method === 'PATCH') {
      const body = await readJsonBody<JsonRecord>(request)
      const worktree = context.db.updateWorktree(id, body as unknown as WorktreeUpdate)
      writeJson(request, response, context.allowedOrigins, worktree ? 200 : 404, worktree ?? { error: 'not_found' })
      return true
    }
  }

  if (resource === 'settings' && !id && request.method === 'GET') {
    writeJson(request, response, context.allowedOrigins, 200, context.db.getAllSettings())
    return true
  }

  if (resource === 'settings' && id) {
    if (request.method === 'GET') {
      const value = context.db.getSetting(id)
      writeJson(request, response, context.allowedOrigins, 200, { key: id, value })
      return true
    }
    if (request.method === 'PUT') {
      const body = await readJsonBody<JsonRecord>(request)
      if (typeof body.value !== 'string') {
        writeJson(request, response, context.allowedOrigins, 400, { error: 'value_must_be_string' })
        return true
      }
      context.db.setSetting(id, body.value)
      writeJson(request, response, context.allowedOrigins, 200, { key: id, value: body.value })
      return true
    }
    if (request.method === 'DELETE') {
      context.db.deleteSetting(id)
      writeJson(request, response, context.allowedOrigins, 200, { deleted: true })
      return true
    }
  }

  if (resource === 'schema' && request.method === 'GET') {
    writeJson(request, response, context.allowedOrigins, 200, {
      version: context.db.getSchemaVersion(),
      path: context.db.getDbPath()
    })
    return true
  }

  return false
}
