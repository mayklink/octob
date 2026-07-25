import { existsSync } from 'fs'
import { basename, join } from 'path'
import { createGitService, isAutoNamedBranch } from './git-service'
import { type BreedType } from './breed-names'
import { normalizeWorktreePath } from './path-utils'
import { scriptRunner } from './script-runner'
import { assignPort, releasePort } from './port-registry'
import { createLogger } from './logger'
import type { DatabaseService } from '../db/database'
import { APP_SETTINGS_DB_KEY } from '@shared/types/settings'

const log = createLogger({ component: 'WorktreeOps' })

/** True if `path` looks like a linked git worktree / checkout (file or dir `.git`). */
function worktreeDirectoryHasGitMetadata(worktreePath: string): boolean {
  return existsSync(join(worktreePath, '.git'))
}

// ── Parameter types ─────────────────────────────────────────────

export interface CreateWorktreeParams {
  projectId: string
  projectPath: string
  projectName: string
}

export interface DeleteWorktreeParams {
  worktreeId: string
  worktreePath: string
  branchName: string
  projectPath: string
  archive: boolean // true = Archive (delete branch), false = Unbranch (keep branch)
}

export interface SyncWorktreesParams {
  projectId: string
  projectPath: string
}

export interface DuplicateWorktreeParams {
  projectId: string
  projectPath: string
  projectName: string
  sourceBranch: string
  sourceWorktreePath: string
  nameHint?: string
}

export interface RenameBranchParams {
  worktreeId: string
  worktreePath: string
  oldBranch: string
  newBranch: string
}

export interface CreateFromBranchParams {
  projectId: string
  projectPath: string
  projectName: string
  branchName: string
  prNumber?: number
  nameHint?: string
  fetchRemoteUrl?: string
  fetchRef?: string
}

// ── Result types ────────────────────────────────────────────────

export interface WorktreeResult {
  success: boolean
  worktree?: {
    id: string
    project_id: string
    name: string
    branch_name: string
    path: string
    status: string
    created_at: string
    last_accessed_at: string
  }
  error?: string
  pullInfo?: {
    pulled: boolean
    updated: boolean
  }
}

export interface SimpleResult {
  success: boolean
  error?: string
  warning?: string
}

function getImportedWorktreeName(branch: string, worktreePath: string): string {
  return branch || basename(worktreePath)
}

// ── Helpers ─────────────────────────────────────────────────────

export function getBreedType(db: DatabaseService): BreedType {
  try {
    const settingsJson = db.getSetting(APP_SETTINGS_DB_KEY)
    if (settingsJson) {
      const settings = JSON.parse(settingsJson)
      if (settings.breedType === 'cats') {
        return 'cats'
      }
    }
  } catch {
    // Fall back to dogs
  }
  return 'dogs'
}

export function getAutoPullSetting(db: DatabaseService): boolean {
  try {
    const settingsJson = db.getSetting(APP_SETTINGS_DB_KEY)
    if (settingsJson) {
      const settings = JSON.parse(settingsJson)
      return settings.autoPullBeforeWorktree !== false
    }
  } catch {
    // Default to true if settings can't be read
  }
  return true
}

/** Copy context from the most recently accessed worktree in this project (if any has context). */
function copyContextFromProject(
  db: DatabaseService,
  projectId: string,
  targetWorktreeId: string
): void {
  const existingWorktrees = db.getActiveWorktreesByProject(projectId)
  const sourceWithContext = existingWorktrees.find((w) => w.id !== targetWorktreeId && w.context)
  if (sourceWithContext) {
    db.updateWorktreeContext(targetWorktreeId, sourceWithContext.context)
  }
}

// ── Operations ──────────────────────────────────────────────────

export async function createWorktreeOp(
  db: DatabaseService,
  params: CreateWorktreeParams
): Promise<WorktreeResult> {
  log.info('Creating worktree', {
    projectName: params.projectName,
    projectId: params.projectId
  })
  try {
    const gitService = createGitService(params.projectPath)

    // Read breed type preference from settings
    const breedType = getBreedType(db)

    // Read autoPullBeforeWorktree setting (defaults to true)
    const autoPullEnabled = getAutoPullSetting(db)

    const result = await gitService.createWorktree(params.projectName, breedType, {
      autoPull: autoPullEnabled
    })

    if (!result.success || !result.name || !result.path || !result.branchName) {
      log.warn('Worktree creation failed', {
        error: result.error,
        projectName: params.projectName
      })
      return {
        success: false,
        error: result.error || 'Failed to create worktree'
      }
    }

    // Create database entry
    const worktree = db.createWorktree({
      project_id: params.projectId,
      name: result.name,
      branch_name: result.branchName,
      path: result.path,
      base_branch: result.baseBranch
    })

    // Copy context from the most recently accessed worktree in this project
    copyContextFromProject(db, params.projectId, worktree.id)

    // Auto-assign port if project has it enabled
    const project = db.getProject(params.projectId)
    if (project && project.auto_assign_port) {
      const port = assignPort(worktree.path)
      log.info('Auto-assigned port to new worktree', {
        worktreeId: worktree.id,
        path: worktree.path,
        port
      })
    }

    log.info('Worktree created successfully', { name: result.name, path: result.path })
    return {
      success: true,
      worktree,
      pullInfo: result.pullInfo
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    log.error('Worktree creation error', error instanceof Error ? error : new Error(message), {
      params
    })
    return {
      success: false,
      error: message
    }
  }
}

export async function deleteWorktreeOp(
  db: DatabaseService,
  params: DeleteWorktreeParams
): Promise<SimpleResult> {
  try {
    // Guard: block delete/archive of default worktrees
    const worktree = db.getWorktree(params.worktreeId)
    if (worktree?.is_default) {
      return {
        success: false,
        error: 'Cannot archive or delete the default worktree'
      }
    }

    // Run archive script if configured (before git operations)
    const project = worktree?.project_id ? db.getProject(worktree.project_id) : null
    if (project?.archive_script) {
      // Pass raw script lines -- scriptRunner.parseCommands handles splitting/filtering
      const commands = [project.archive_script]
      log.info('Running archive script before worktree deletion', {
        worktreeId: params.worktreeId
      })
      const scriptResult = await scriptRunner.runAndWait(commands, params.worktreePath, 30000)
      if (scriptResult.success) {
        log.info('Archive script completed successfully', { output: scriptResult.output })
      } else {
        log.warn('Archive script failed, proceeding with archival anyway', {
          error: scriptResult.error,
          output: scriptResult.output
        })
      }
    }

    const gitService = createGitService(params.projectPath)

    let primary = params.archive
      ? await gitService.archiveWorktree(params.worktreePath, params.branchName)
      : await gitService.removeWorktree(params.worktreePath)

    if (!primary.success) {
      log.warn('Primary worktree removal failed; attempting forced cleanup', {
        worktreeId: params.worktreeId,
        error: primary.error
      })
      const forced = await gitService.forceFinalizeWorktreeRemoval(params.worktreePath, {
        branchName: params.branchName,
        archive: params.archive
      })
      if (forced.success) {
        primary = { success: true }
      } else {
        log.error('Forced worktree cleanup did not remove folder; archiving Octob entry anyway', {
          worktreePath: params.worktreePath,
          error: forced.error
        })
      }
    }

    let warning: string | undefined
    if (!primary.success) {
      warning =
        'Archived in Octob, but the worktree folder could not be fully deleted (another app may have files open). Close terminals or editors using that folder and delete it manually if it remains.'
    }

    // Release any assigned port for this worktree
    releasePort(params.worktreePath)

    // Always archive in DB when the user asked to archive/delete — avoids orphaned UI sessions
    db.archiveWorktree(params.worktreeId)

    return warning ? { success: true, warning } : { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return {
      success: false,
      error: message
    }
  }
}

export async function syncWorktreesOp(
  db: DatabaseService,
  params: SyncWorktreesParams
): Promise<SimpleResult> {
  try {
    const gitService = createGitService(params.projectPath)
    const normalizedProjectPath = normalizeWorktreePath(params.projectPath)
    const project = db.getProject(params.projectId)

    // Get actual worktrees from git
    const gitWorktrees = await gitService.listWorktrees()
    const normalizedGitWorktrees = gitWorktrees.map((worktree) => ({
      ...worktree,
      normalizedPath: normalizeWorktreePath(worktree.path)
    }))
    const gitWorktreePaths = new Set(normalizedGitWorktrees.map((w) => w.normalizedPath))

    // Get database worktrees
    const dbWorktrees = db.getActiveWorktreesByProject(params.projectId)
    const dbWorktreePaths = new Set(dbWorktrees.map((w) => normalizeWorktreePath(w.path)))

    for (const gitWorktree of normalizedGitWorktrees) {
      if (
        gitWorktree.normalizedPath === normalizedProjectPath ||
        dbWorktreePaths.has(gitWorktree.normalizedPath)
      ) {
        continue
      }

      if (!existsSync(gitWorktree.path)) {
        log.info('Skipping missing git worktree during sync', {
          projectId: params.projectId,
          path: gitWorktree.path,
          branch: gitWorktree.branch
        })
        continue
      }

      const importedName = getImportedWorktreeName(gitWorktree.branch, gitWorktree.path)

      log.info('Importing git worktree into database', {
        projectId: params.projectId,
        path: gitWorktree.path,
        branch: gitWorktree.branch,
        name: importedName
      })

      const importedWorktree = db.createWorktree({
        project_id: params.projectId,
        name: importedName,
        branch_name: gitWorktree.branch,
        path: gitWorktree.path
      })

      if (project?.auto_assign_port) {
        const port = assignPort(importedWorktree.path)
        log.info('Auto-assigned port to imported worktree', {
          worktreeId: importedWorktree.id,
          path: importedWorktree.path,
          port
        })
      }
    }

    // Build a map of git worktree path -> branch for quick lookup
    const gitBranchByPath = new Map(normalizedGitWorktrees.map((w) => [w.normalizedPath, w.branch]))

    // Check each database worktree
    for (const dbWorktree of dbWorktrees) {
      // If worktree path doesn't exist in git worktrees or on disk
      const normalizedDbWorktreePath = normalizeWorktreePath(dbWorktree.path)

      if (!gitWorktreePaths.has(normalizedDbWorktreePath) && !existsSync(dbWorktree.path)) {
        if (dbWorktree.is_default) {
          continue
        }

        // Mark as archived (worktree was removed outside of Octob)
        db.archiveWorktree(dbWorktree.id)
        continue
      }

      // Folder still exists but git does not register this path — typical broken archive (EPERM / partial git cleanup)
      if (!gitWorktreePaths.has(normalizedDbWorktreePath) && existsSync(dbWorktree.path)) {
        if (dbWorktree.is_default) {
          continue
        }
        if (!worktreeDirectoryHasGitMetadata(dbWorktree.path)) {
          log.warn('Archiving orphaned worktree folder (exists on disk but not a git checkout)', {
            worktreeId: dbWorktree.id,
            path: dbWorktree.path
          })
          try {
            await gitService.forceFinalizeWorktreeRemoval(dbWorktree.path, {
              branchName: dbWorktree.branch_name || undefined,
              archive: false
            })
          } catch (e) {
            log.warn('Could not delete orphaned worktree folder during sync; archived in Octob anyway', {
              path: dbWorktree.path,
              error: e instanceof Error ? e.message : String(e)
            })
          }
          releasePort(dbWorktree.path)
          db.archiveWorktree(dbWorktree.id)
          continue
        }
      }
      // Sync branch name if git reports a different one.
      // branch_name is always updated to match git (source of truth).
      // Display name is only updated when it's a breed/city placeholder or
      // still matches the old branch name (never meaningfully customised).
      const gitBranch = gitBranchByPath.get(normalizedDbWorktreePath)
      if (
        gitBranch !== undefined &&
        gitBranch !== dbWorktree.branch_name
      ) {
        log.info('Branch renamed externally, updating DB', {
          worktreeId: dbWorktree.id,
          oldBranch: dbWorktree.branch_name,
          newBranch: gitBranch
        })
        const nameMatchesBranch = dbWorktree.name === dbWorktree.branch_name
        const worktreeName = dbWorktree.name.toLowerCase()
        const isAutoName = isAutoNamedBranch(worktreeName)
        const shouldUpdateName = nameMatchesBranch || isAutoName
        const syncedName = getImportedWorktreeName(gitBranch, dbWorktree.path)
        db.updateWorktree(dbWorktree.id, {
          branch_name: gitBranch,
          ...(shouldUpdateName ? { name: syncedName } : {})
        })
      } else if (gitBranch !== undefined && dbWorktree.name !== dbWorktree.branch_name) {
        // branch_name already matches git, but display name is stale (e.g. a
        // breed/city placeholder left behind by a rename that didn't update it).
        const isAutoName = isAutoNamedBranch(dbWorktree.name.toLowerCase())
        if (isAutoName) {
          const healedName = getImportedWorktreeName(dbWorktree.branch_name, dbWorktree.path)
          db.updateWorktree(dbWorktree.id, { name: healedName })
        }
      }
    }

    // Prune any stale git worktree entries
    await gitService.pruneWorktrees()

    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return {
      success: false,
      error: message
    }
  }
}

export async function duplicateWorktreeOp(
  db: DatabaseService,
  params: DuplicateWorktreeParams
): Promise<WorktreeResult> {
  log.info('Duplicating worktree', {
    sourceBranch: params.sourceBranch,
    projectName: params.projectName
  })

  if (!params.sourceBranch) {
    return {
      success: false,
      error: 'Detached HEAD worktrees cannot be duplicated'
    }
  }

  try {
    const gitService = createGitService(params.projectPath)
    const result = await gitService.duplicateWorktree(
      params.sourceBranch,
      params.sourceWorktreePath,
      params.projectName,
      params.nameHint
    )

    if (!result.success || !result.name || !result.path || !result.branchName) {
      log.warn('Worktree duplication failed', { error: result.error })
      return {
        success: false,
        error: result.error || 'Failed to duplicate worktree'
      }
    }

    // Create database entry
    const worktree = db.createWorktree({
      project_id: params.projectId,
      name: result.name,
      branch_name: result.branchName,
      path: result.path,
      base_branch: result.baseBranch
    })

    // Copy context from source worktree
    const sourceWorktree = db.getWorktreeByPath(params.sourceWorktreePath)
    if (sourceWorktree?.context) {
      db.updateWorktreeContext(worktree.id, sourceWorktree.context)
    }

    // Auto-assign port if project has it enabled
    const project = db.getProject(params.projectId)
    if (project && project.auto_assign_port) {
      const port = assignPort(worktree.path)
      log.info('Auto-assigned port to duplicated worktree', {
        worktreeId: worktree.id,
        path: worktree.path,
        port
      })
    }

    log.info('Worktree duplicated successfully', { name: result.name, path: result.path })
    return {
      success: true,
      worktree
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    log.error('Worktree duplication error', error instanceof Error ? error : new Error(message), {
      params
    })
    return {
      success: false,
      error: message
    }
  }
}

export async function renameWorktreeBranchOp(
  db: DatabaseService,
  params: RenameBranchParams
): Promise<SimpleResult> {
  log.info('Renaming worktree branch', {
    worktreePath: params.worktreePath,
    oldBranch: params.oldBranch,
    newBranch: params.newBranch
  })

  if (!params.oldBranch) {
    return {
      success: false,
      error: 'Detached HEAD worktrees cannot be renamed'
    }
  }

  try {
    const gitService = createGitService(params.worktreePath)
    const result = await gitService.renameBranch(
      params.worktreePath,
      params.oldBranch,
      params.newBranch
    )
    if (result.success) {
      // Also update display name if it still matches the old branch or is a
      // breed/city placeholder (never meaningfully customised by the user).
      const worktree = db.getWorktree(params.worktreeId)
      const nameMatchesBranch = worktree?.name === params.oldBranch
      const isAutoName = worktree ? isAutoNamedBranch(worktree.name.toLowerCase()) : false
      const shouldUpdateName = nameMatchesBranch || isAutoName

      db.updateWorktree(params.worktreeId, {
        branch_name: params.newBranch,
        branch_renamed: 1,
        ...(shouldUpdateName
          ? { name: getImportedWorktreeName(params.newBranch, params.worktreePath) }
          : {})
      })
    }
    return result
  } catch (error) {
    log.error(
      'Rename worktree branch failed',
      error instanceof Error ? error : new Error('Unknown error')
    )
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

export async function createWorktreeFromBranchOp(
  db: DatabaseService,
  params: CreateFromBranchParams
): Promise<WorktreeResult> {
  log.info('Creating worktree from branch', {
    projectName: params.projectName,
    branchName: params.branchName
  })
  try {
    // Read breed type preference from settings
    const breedType = getBreedType(db)

    // Read autoPullBeforeWorktree setting (defaults to true)
    const autoPullEnabled = getAutoPullSetting(db)

    const gitService = createGitService(params.projectPath)
    const result = await gitService.createWorktreeFromBranch(
      params.projectName,
      params.branchName,
      breedType,
      params.prNumber,
      {
        autoPull: autoPullEnabled,
        nameHint: params.nameHint,
        fetchRemoteUrl: params.fetchRemoteUrl,
        fetchRef: params.fetchRef
      }
    )
    if (!result.success || !result.path) {
      return { success: false, error: result.error || 'Failed to create worktree from branch' }
    }
    const worktree = db.createWorktree({
      project_id: params.projectId,
      name: result.name || params.branchName,
      branch_name: result.branchName || params.branchName,
      path: result.path,
      base_branch: result.baseBranch
    })

    // Mark branch as renamed when created from a ticket title hint
    // to prevent autoRenameWorktreeBranch from overwriting it later
    if (params.nameHint) {
      db.updateWorktree(worktree.id, { branch_renamed: 1 })
    }

    // Copy context from the most recently accessed worktree in this project
    copyContextFromProject(db, params.projectId, worktree.id)

    // Auto-assign port if project has it enabled
    const project = db.getProject(params.projectId)
    if (project && project.auto_assign_port) {
      const port = assignPort(worktree.path)
      log.info('Auto-assigned port to worktree from branch', {
        worktreeId: worktree.id,
        path: worktree.path,
        port
      })
    }

    return {
      success: true,
      worktree,
      pullInfo: result.pullInfo
    }
  } catch (error) {
    log.error(
      'Create worktree from branch failed',
      error instanceof Error ? error : new Error('Unknown error')
    )
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}
