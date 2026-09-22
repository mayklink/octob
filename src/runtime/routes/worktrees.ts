import type { IncomingMessage, ServerResponse } from 'node:http'
import type { DatabaseService } from '../../main/db/database'
import {
  createWorktreeFromBranchOp,
  createWorktreeOp,
  deleteWorktreeOp,
  duplicateWorktreeOp,
  renameWorktreeBranchOp,
  syncWorktreesOp
} from '../../main/services/worktree-ops'
import { readJsonBody, writeJson, type JsonRecord } from '../http'

interface WorktreeRouteContext {
  db: DatabaseService
  allowedOrigins: Set<string>
}

function projectOr404(
  context: WorktreeRouteContext,
  projectId: unknown
) {
  return typeof projectId === 'string' ? context.db.getProject(projectId) : null
}

export async function handleWorktreeRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  context: WorktreeRouteContext
): Promise<boolean> {
  if (!url.pathname.startsWith('/v1/worktrees/')) return false
  if (request.method !== 'POST') return false

  const operation = url.pathname.slice('/v1/worktrees/'.length)
  const body = await readJsonBody<JsonRecord>(request)

  if (operation === 'create') {
    const project = projectOr404(context, body.projectId)
    if (!project) {
      writeJson(request, response, context.allowedOrigins, 404, { error: 'project_not_found' })
      return true
    }
    const result = await createWorktreeOp(context.db, {
      projectId: project.id,
      projectPath: project.path,
      projectName: project.name
    })
    writeJson(request, response, context.allowedOrigins, 200, result)
    return true
  }

  if (operation === 'sync') {
    const project = projectOr404(context, body.projectId)
    if (!project) {
      writeJson(request, response, context.allowedOrigins, 404, { error: 'project_not_found' })
      return true
    }
    const result = await syncWorktreesOp(context.db, {
      projectId: project.id,
      projectPath: project.path
    })
    writeJson(request, response, context.allowedOrigins, 200, result)
    return true
  }

  if (operation === 'delete') {
    const worktree =
      typeof body.worktreeId === 'string' ? context.db.getWorktree(body.worktreeId) : null
    if (!worktree) {
      writeJson(request, response, context.allowedOrigins, 404, { error: 'worktree_not_found' })
      return true
    }
    const project = context.db.getProject(worktree.project_id)
    if (!project) {
      writeJson(request, response, context.allowedOrigins, 404, { error: 'project_not_found' })
      return true
    }
    const result = await deleteWorktreeOp(context.db, {
      worktreeId: worktree.id,
      worktreePath: worktree.path,
      branchName: worktree.branch_name,
      projectPath: project.path,
      archive: body.archive === true
    })
    writeJson(request, response, context.allowedOrigins, 200, result)
    return true
  }

  if (operation === 'duplicate') {
    const source =
      typeof body.worktreeId === 'string' ? context.db.getWorktree(body.worktreeId) : null
    if (!source) {
      writeJson(request, response, context.allowedOrigins, 404, { error: 'worktree_not_found' })
      return true
    }
    const project = context.db.getProject(source.project_id)
    if (!project) {
      writeJson(request, response, context.allowedOrigins, 404, { error: 'project_not_found' })
      return true
    }
    const result = await duplicateWorktreeOp(context.db, {
      projectId: project.id,
      projectPath: project.path,
      projectName: project.name,
      sourceBranch: source.branch_name,
      sourceWorktreePath: source.path,
      nameHint: typeof body.nameHint === 'string' ? body.nameHint : undefined
    })
    writeJson(request, response, context.allowedOrigins, 200, result)
    return true
  }

  if (operation === 'rename') {
    const worktree =
      typeof body.worktreeId === 'string' ? context.db.getWorktree(body.worktreeId) : null
    if (!worktree || typeof body.newBranch !== 'string') {
      writeJson(request, response, context.allowedOrigins, 400, { error: 'invalid_request' })
      return true
    }
    const result = await renameWorktreeBranchOp(context.db, {
      worktreeId: worktree.id,
      worktreePath: worktree.path,
      oldBranch: worktree.branch_name,
      newBranch: body.newBranch
    })
    writeJson(request, response, context.allowedOrigins, 200, result)
    return true
  }

  if (operation === 'from-branch') {
    const project = projectOr404(context, body.projectId)
    if (!project || typeof body.branchName !== 'string') {
      writeJson(request, response, context.allowedOrigins, 400, { error: 'invalid_request' })
      return true
    }
    const result = await createWorktreeFromBranchOp(context.db, {
      projectId: project.id,
      projectPath: project.path,
      projectName: project.name,
      branchName: body.branchName,
      prNumber: typeof body.prNumber === 'number' ? body.prNumber : undefined,
      nameHint: typeof body.nameHint === 'string' ? body.nameHint : undefined,
      fetchRemoteUrl: typeof body.fetchRemoteUrl === 'string' ? body.fetchRemoteUrl : undefined,
      fetchRef: typeof body.fetchRef === 'string' ? body.fetchRef : undefined
    })
    writeJson(request, response, context.allowedOrigins, 200, result)
    return true
  }

  writeJson(request, response, context.allowedOrigins, 404, {
    error: 'worktree_operation_not_found'
  })
  return true
}
