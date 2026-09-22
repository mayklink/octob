import type { IncomingMessage, ServerResponse } from 'node:http'
import { isAbsolute, resolve } from 'node:path'
import type { DatabaseService } from '../../main/db/database'
import { createGitService } from '../../main/services/git-service'
import { isPathAllowed, isRegisteredWorkspaceRoot } from '../path-guard'
import { readJsonBody, writeJson, type JsonRecord } from '../http'

interface GitRouteContext {
  db: DatabaseService
  allowedOrigins: Set<string>
}

function validatedFilePath(
  db: DatabaseService,
  worktreePath: string,
  filePath: string
): boolean {
  const absolutePath = isAbsolute(filePath) ? filePath : resolve(worktreePath, filePath)
  return isPathAllowed(db, absolutePath)
}

export async function handleGitRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  context: GitRouteContext
): Promise<boolean> {
  if (!url.pathname.startsWith('/v1/git/')) return false
  if (request.method !== 'POST') return false
  const operation = url.pathname.slice('/v1/git/'.length)
  const body = await readJsonBody<JsonRecord>(request)
  if (typeof body.worktreePath !== 'string') {
    writeJson(request, response, context.allowedOrigins, 400, { error: 'worktreePath_required' })
    return true
  }
  if (!isRegisteredWorkspaceRoot(context.db, body.worktreePath)) {
    writeJson(request, response, context.allowedOrigins, 403, { error: 'path_not_allowed' })
    return true
  }

  const git = createGitService(body.worktreePath)

  if (operation === 'status') {
    writeJson(request, response, context.allowedOrigins, 200, await git.getFileStatuses())
    return true
  }

  if (operation === 'branch') {
    writeJson(request, response, context.allowedOrigins, 200, await git.getBranchInfo())
    return true
  }

  if (operation === 'branches') {
    const branches = await git.getAllBranches()
    const currentBranch = await git.getCurrentBranch()
    writeJson(request, response, context.allowedOrigins, 200, { success: true, branches, currentBranch })
    return true
  }

  if (operation === 'stage' || operation === 'unstage' || operation === 'discard') {
    if (
      typeof body.filePath !== 'string' ||
      !validatedFilePath(context.db, body.worktreePath, body.filePath)
    ) {
      writeJson(request, response, context.allowedOrigins, 400, { error: 'invalid_file_path' })
      return true
    }
    const result =
      operation === 'stage'
        ? await git.stageFile(body.filePath)
        : operation === 'unstage'
          ? await git.unstageFile(body.filePath)
          : await git.discardChanges(body.filePath)
    writeJson(request, response, context.allowedOrigins, 200, result)
    return true
  }

  if (operation === 'stage-all') {
    writeJson(request, response, context.allowedOrigins, 200, await git.stageAll())
    return true
  }

  if (operation === 'unstage-all') {
    writeJson(request, response, context.allowedOrigins, 200, await git.unstageAll())
    return true
  }

  if (operation === 'commit') {
    if (typeof body.message !== 'string') {
      writeJson(request, response, context.allowedOrigins, 400, { error: 'message_required' })
      return true
    }
    writeJson(request, response, context.allowedOrigins, 200, await git.commit(body.message))
    return true
  }

  if (operation === 'push') {
    const remote = typeof body.remote === 'string' ? body.remote : undefined
    const branch = typeof body.branch === 'string' ? body.branch : undefined
    writeJson(request, response, context.allowedOrigins, 200, await git.push(remote, branch))
    return true
  }

  if (operation === 'pull') {
    const remote = typeof body.remote === 'string' ? body.remote : undefined
    const branch = typeof body.branch === 'string' ? body.branch : undefined
    const rebase = typeof body.rebase === 'boolean' ? body.rebase : undefined
    writeJson(request, response, context.allowedOrigins, 200, await git.pull(remote, branch, rebase))
    return true
  }

  if (operation === 'diff-stat') {
    writeJson(request, response, context.allowedOrigins, 200, await git.getDiffStat())
    return true
  }

  if (operation === 'has-changes') {
    writeJson(request, response, context.allowedOrigins, 200, {
      success: true,
      hasChanges: await git.hasUncommittedChanges()
    })
    return true
  }

  if (operation === 'remote-url') {
    const remote = typeof body.remote === 'string' ? body.remote : 'origin'
    writeJson(request, response, context.allowedOrigins, 200, await git.getRemoteUrl(remote))
    return true
  }

  writeJson(request, response, context.allowedOrigins, 404, { error: 'git_operation_not_found' })
  return true
}
