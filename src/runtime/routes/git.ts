import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { promisify } from 'node:util'
import { isAbsolute, resolve } from 'node:path'
import type { DatabaseService } from '../../main/db/database'
import { createGitService } from '../../main/services/git-service'
import { githubRequest, parseGitHubRemote } from '../../main/services/github-api'
import { readFileAsBase64 } from '../../main/services/file-ops'
import type { PRReviewComment } from '../../shared/types/git'
import { isPathAllowed, isRegisteredWorkspaceRoot } from '../path-guard'
import { readJsonBody, writeJson, type JsonRecord } from '../http'

const execFileAsync = promisify(execFile)

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

function pathFromBody(body: JsonRecord): string | null {
  if (typeof body.worktreePath === 'string') return body.worktreePath
  if (typeof body.projectPath === 'string') return body.projectPath
  return null
}

function branchName(body: JsonRecord): string | null {
  if (typeof body.branch === 'string') return body.branch
  if (typeof body.branchName === 'string') return body.branchName
  return null
}

async function githubRepositoryFor(git: ReturnType<typeof createGitService>) {
  const remote = await git.getRemoteUrl()
  return remote.url ? parseGitHubRemote(remote.url) : null
}

function worktreeForBranch(output: string, branch: string): string | null {
  for (const block of output.split(/\r?\n\r?\n/)) {
    const path = block.match(/^worktree (.+)$/m)?.[1]?.trim()
    const ref = block.match(/^branch refs\/heads\/(.+)$/m)?.[1]?.trim()
    if (path && ref === branch) return path
  }
  return null
}

async function syncMergedPullRequest(repoPath: string, baseBranch: string, headBranch: string): Promise<void> {
  const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], { cwd: repoPath })
  const targetPath = worktreeForBranch(stdout, baseBranch)
  if (!targetPath) return
  await execFileAsync('git', ['merge', headBranch], { cwd: targetPath })
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
  const repoPath = pathFromBody(body)
  if (!repoPath) {
    writeJson(request, response, context.allowedOrigins, 400, { error: 'worktreePath_required' })
    return true
  }
  if (!isRegisteredWorkspaceRoot(context.db, repoPath)) {
    writeJson(request, response, context.allowedOrigins, 403, { error: 'path_not_allowed' })
    return true
  }

  const git = createGitService(repoPath)

  if (operation === 'status') {
    writeJson(request, response, context.allowedOrigins, 200, await git.getFileStatuses())
    return true
  }

  if (operation === 'has-commits') {
    writeJson(request, response, context.allowedOrigins, 200, {
      success: true,
      hasCommits: await git.hasCommits()
    })
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

  if (operation === 'list-branches-with-status') {
    writeJson(request, response, context.allowedOrigins, 200, {
      success: true,
      branches: await git.listBranchesWithStatus()
    })
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

  if (operation === 'add-gitignore') {
    if (typeof body.pattern !== 'string' || !body.pattern.trim()) {
      writeJson(request, response, context.allowedOrigins, 400, { error: 'pattern_required' })
      return true
    }
    writeJson(
      request,
      response,
      context.allowedOrigins,
      200,
      await git.addToGitignore(body.pattern)
    )
    return true
  }

  if (operation === 'sync-pull-request-branch') {
    const options = body.options
    if (!options || typeof options !== 'object') {
      writeJson(request, response, context.allowedOrigins, 400, { error: 'options_required' })
      return true
    }
    writeJson(
      request,
      response,
      context.allowedOrigins,
      200,
      await git.syncPullRequestBranch(options as {
        prNumber?: number
        headRefName: string
        sourceRepositoryUrl?: string
      })
    )
    return true
  }

  if (operation === 'checkout') {
    const branch = branchName(body)
    writeJson(
      request,
      response,
      context.allowedOrigins,
      200,
      await git.checkoutBranch(branch ?? '')
    )
    return true
  }

  if (operation === 'merge') {
    writeJson(
      request,
      response,
      context.allowedOrigins,
      200,
      await git.merge(branchName(body) ?? '')
    )
    return true
  }

  if (operation === 'merge-abort') {
    writeJson(request, response, context.allowedOrigins, 200, await git.mergeAbort())
    return true
  }

  if (operation === 'branch-diff-stat') {
    writeJson(
      request,
      response,
      context.allowedOrigins,
      200,
      await git.getBranchDiffShortStat(typeof body.baseBranch === 'string' ? body.baseBranch : '')
    )
    return true
  }

  if (operation === 'diff') {
    if (
      typeof body.filePath !== 'string' ||
      !validatedFilePath(context.db, repoPath, body.filePath)
    ) {
      writeJson(request, response, context.allowedOrigins, 400, { error: 'invalid_file_path' })
      return true
    }
    const result = body.isUntracked === true
      ? await git.getUntrackedFileDiff(body.filePath)
      : await git.getDiff(body.filePath, body.staged === true,
          typeof body.contextLines === 'number' ? body.contextLines : undefined)
    writeJson(request, response, context.allowedOrigins, 200, result)
    return true
  }

  if (operation === 'file-content' || operation === 'file-content-base64') {
    if (
      typeof body.filePath !== 'string' ||
      !validatedFilePath(context.db, repoPath, body.filePath)
    ) {
      writeJson(request, response, context.allowedOrigins, 400, { error: 'invalid_file_path' })
      return true
    }
    const fullPath = isAbsolute(body.filePath) ? body.filePath : resolve(repoPath, body.filePath)
    const result = operation === 'file-content'
      ? await readFile(fullPath, 'utf8')
          .then((content) => ({ success: true, content }))
          .catch((error) => ({ success: false, content: null, error: error instanceof Error ? error.message : String(error) }))
      : await Promise.resolve(readFileAsBase64(fullPath))
    writeJson(request, response, context.allowedOrigins, 200, result)
    return true
  }

  if (operation === 'ref-content' || operation === 'ref-content-base64') {
    if (
      typeof body.filePath !== 'string' ||
      !validatedFilePath(context.db, repoPath, body.filePath)
    ) {
      writeJson(request, response, context.allowedOrigins, 400, { error: 'invalid_file_path' })
      return true
    }
    const result = operation === 'ref-content'
      ? await git.getRefContent(typeof body.ref === 'string' ? body.ref : '', body.filePath)
      : await git.getRefContentBase64(typeof body.ref === 'string' ? body.ref : '', body.filePath)
    writeJson(request, response, context.allowedOrigins, 200, result)
    return true
  }

  if (operation === 'branch-diff-files') {
    writeJson(request, response, context.allowedOrigins, 200, await git.getBranchDiffFiles(branchName(body) ?? ''))
    return true
  }

  if (operation === 'branch-base-content' || operation === 'branch-base-content-base64') {
    if (
      typeof body.filePath !== 'string' ||
      !validatedFilePath(context.db, repoPath, body.filePath)
    ) {
      writeJson(request, response, context.allowedOrigins, 400, { error: 'invalid_file_path' })
      return true
    }
    const branch = branchName(body) ?? ''
    const result = operation === 'branch-base-content'
      ? await git.getBranchBaseContent(branch, body.filePath)
      : await git.getBranchBaseContentBase64(branch, body.filePath)
    writeJson(request, response, context.allowedOrigins, 200, result)
    return true
  }

  if (operation === 'branch-file-diff') {
    if (
      typeof body.filePath !== 'string' ||
      !validatedFilePath(context.db, repoPath, body.filePath)
    ) {
      writeJson(request, response, context.allowedOrigins, 400, { error: 'invalid_file_path' })
      return true
    }
    writeJson(request, response, context.allowedOrigins, 200, await git.getBranchFileDiff(branchName(body) ?? '', body.filePath))
    return true
  }

  if (operation === 'stage-hunk' || operation === 'unstage-hunk' || operation === 'revert-hunk') {
    const patch = typeof body.patch === 'string' ? body.patch : ''
    const result = operation === 'stage-hunk'
      ? await git.stageHunk(patch)
      : operation === 'unstage-hunk'
        ? await git.unstageHunk(patch)
        : await git.revertHunk(patch)
    writeJson(request, response, context.allowedOrigins, 200, result)
    return true
  }

  if (operation === 'is-branch-merged') {
    writeJson(request, response, context.allowedOrigins, 200, await git.isBranchMerged(branchName(body) ?? ''))
    return true
  }

  if (operation === 'delete-branch') {
    writeJson(request, response, context.allowedOrigins, 200, await git.deleteBranch(branchName(body) ?? ''))
    return true
  }

  if (operation === 'range-diff') {
    writeJson(request, response, context.allowedOrigins, 200, await git.getRangeDiff(typeof body.baseBranch === 'string' ? body.baseBranch : ''))
    return true
  }

  if (operation === 'needs-push') {
    writeJson(request, response, context.allowedOrigins, 200, await git.needsPush())
    return true
  }

  if (operation === 'create-pr') {
    writeJson(request, response, context.allowedOrigins, 200, await git.createPullRequest({
      baseBranch: typeof body.baseBranch === 'string' ? body.baseBranch : '',
      title: typeof body.title === 'string' ? body.title : '',
      body: typeof body.body === 'string' ? body.body : ''
    }))
    return true
  }

  if (operation === 'pr-merge') {
    try {
      const repository = await githubRepositoryFor(git)
      if (!repository) throw new Error('The origin remote is not a GitHub repository.')
      const prNumber = Number(body.prNumber)
      const pull = await githubRequest<{ base: { ref: string }; head: { ref: string } }>(
        repository,
        `/pulls/${prNumber}`
      )
      await githubRequest(repository, `/pulls/${prNumber}/merge`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ merge_method: 'merge' })
      })
      await syncMergedPullRequest(repoPath, pull.base.ref, pull.head.ref)
      writeJson(request, response, context.allowedOrigins, 200, { success: true })
    } catch (error) {
      writeJson(request, response, context.allowedOrigins, 200, {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      })
    }
    return true
  }

  if (operation === 'list-prs') {
    try {
      const repository = await githubRepositoryFor(git)
      if (!repository) throw new Error('The origin remote is not a GitHub repository.')
      const raw = await githubRequest<Array<{ number: number; title: string; user: { login: string }; head: { ref: string } }>>(
        repository,
        '/pulls?state=open&per_page=100'
      )
      writeJson(request, response, context.allowedOrigins, 200, {
        success: true,
        prs: raw.map((pr) => ({ number: pr.number, title: pr.title, author: pr.user.login, headRefName: pr.head.ref }))
      })
    } catch (error) {
      writeJson(request, response, context.allowedOrigins, 200, {
        success: false,
        prs: [],
        error: error instanceof Error ? error.message : String(error)
      })
    }
    return true
  }

  if (operation === 'pr-state') {
    try {
      const repository = await githubRepositoryFor(git)
      if (!repository) throw new Error('The origin remote is not a GitHub repository.')
      const data = await githubRequest<{ state: string; title: string; merged: boolean }>(
        repository,
        `/pulls/${Number(body.prNumber)}`
      )
      const state = data.merged ? 'MERGED' : data.state.toUpperCase()
      writeJson(request, response, context.allowedOrigins, 200, { success: true, state, title: data.title })
    } catch (error) {
      writeJson(request, response, context.allowedOrigins, 200, { success: false, error: error instanceof Error ? error.message : String(error) })
    }
    return true
  }

  if (operation === 'pr-review-comments') {
    try {
      const repository = await githubRepositoryFor(git)
      if (!repository) throw new Error('The origin remote is not a GitHub repository.')
      const prNumber = Number(body.prNumber)
      const [pullRequest, rawComments] = await Promise.all([
        githubRequest<{ base: { ref: string } }>(repository, `/pulls/${prNumber}`),
        githubRequest<Array<any>>(repository, `/pulls/${prNumber}/comments?per_page=100`)
      ])
      const comments: PRReviewComment[] = rawComments.map((comment) => ({
        id: comment.id,
        body: comment.body ?? '',
        bodyHTML: comment.body_html ?? '',
        path: comment.path ?? '',
        line: comment.line ?? null,
        originalLine: comment.original_line ?? null,
        side: comment.side === 'LEFT' ? 'LEFT' : 'RIGHT',
        diffHunk: comment.diff_hunk ?? '',
        user: { login: comment.user?.login ?? 'ghost', avatarUrl: comment.user?.avatar_url ?? '' },
        createdAt: comment.created_at ?? '',
        updatedAt: comment.updated_at ?? '',
        inReplyToId: comment.in_reply_to_id ?? null,
        pullRequestReviewId: comment.pull_request_review_id ?? null,
        subjectType: comment.subject_type === 'file' ? 'file' : 'line'
      }))
      writeJson(request, response, context.allowedOrigins, 200, { success: true, comments, baseBranch: pullRequest.base.ref })
    } catch (error) {
      writeJson(request, response, context.allowedOrigins, 200, { success: false, error: error instanceof Error ? error.message : String(error) })
    }
    return true
  }

  if (operation === 'generate-pr-content') {
    const provider = typeof body.provider === 'string' ? body.provider : ''
    if (!['claude-code', 'codex', 'opencode'].includes(provider)) {
      writeJson(request, response, context.allowedOrigins, 200, { success: false, error: `Invalid provider: ${provider}` })
      return true
    }
    try {
      const rangeDiff = await git.getRangeDiff(typeof body.baseBranch === 'string' ? body.baseBranch : '')
      const branchInfo = await git.getBranchInfo()
      const { generatePRContent } = await import('../../main/services/pr-content-generator')
      const result = await generatePRContent({
        baseBranch: typeof body.baseBranch === 'string' ? body.baseBranch : '',
        headBranch: branchInfo.branch?.name ?? 'HEAD',
        commitSummary: rangeDiff.commitSummary,
        diffSummary: rangeDiff.diffSummary,
        diffPatch: rangeDiff.diffPatch,
        provider: provider as import('../../main/services/agent-sdk-types').AgentSdkId,
        cwd: repoPath
      })
      writeJson(request, response, context.allowedOrigins, 200, { success: true, title: result.title, body: result.body })
    } catch (error) {
      writeJson(request, response, context.allowedOrigins, 200, { success: false, error: error instanceof Error ? error.message : String(error) })
    }
    return true
  }

  writeJson(request, response, context.allowedOrigins, 404, { error: 'git_operation_not_found' })
  return true
}
