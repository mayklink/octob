import { existsSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import type { DatabaseService } from '../main/db/database'

function normalizeExistingPath(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    return resolve(path)
  }
}

function pathEqualsOrIsInside(rootPath: string, targetPath: string): boolean {
  const root = normalizeExistingPath(rootPath)
  const target = normalizeExistingPath(targetPath)
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

export function listRegisteredWorkspaceRoots(db: DatabaseService): string[] {
  const roots = new Set<string>()
  for (const project of db.getAllProjects()) roots.add(project.path)
  for (const project of db.getAllProjects()) {
    for (const worktree of db.getActiveWorktreesByProject(project.id)) {
      roots.add(worktree.path)
    }
  }
  return [...roots]
}

export function isRegisteredWorkspaceRoot(
  db: DatabaseService,
  candidatePath: string
): boolean {
  const candidate = normalizeExistingPath(candidatePath)
  return listRegisteredWorkspaceRoots(db).some(
    (root) => normalizeExistingPath(root) === candidate
  )
}

export function isPathAllowed(db: DatabaseService, candidatePath: string): boolean {
  return listRegisteredWorkspaceRoots(db).some((root) =>
    pathEqualsOrIsInside(root, candidatePath)
  )
}

export function canCreateInsideWorkspace(
  db: DatabaseService,
  rootPath: string,
  relativePath: string
): boolean {
  if (!isRegisteredWorkspaceRoot(db, rootPath)) return false
  const target = resolve(rootPath, relativePath)
  if (!pathEqualsOrIsInside(rootPath, target)) return false
  const parent = resolve(target, '..')
  return !existsSync(parent) || pathEqualsOrIsInside(rootPath, parent)
}
