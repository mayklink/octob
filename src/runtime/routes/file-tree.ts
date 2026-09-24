import type { IncomingMessage, ServerResponse } from 'node:http'
import { promises as fs } from 'node:fs'
import { basename, extname, join, relative } from 'node:path'
import type { DatabaseService } from '../../main/db/database'
import { isPathAllowed } from '../path-guard'
import { readJsonBody, writeJson, type JsonRecord } from '../http'

interface FileTreeContext {
  db: DatabaseService
  allowedOrigins: Set<string>
}

interface TreeNode {
  name: string
  path: string
  relativePath: string
  isDirectory: boolean
  extension: string | null
  children?: TreeNode[]
}

const ignored = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
  'coverage', '.cache', 'tmp'
])

async function scan(dirPath: string, rootPath: string, depth = 0): Promise<TreeNode[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  const nodes: TreeNode[] = []
  for (const entry of entries) {
    if (entry.isDirectory() && ignored.has(entry.name)) continue
    if (entry.name === '.DS_Store' || entry.name === 'Thumbs.db') continue
    const path = join(dirPath, entry.name)
    const isDirectory = entry.isDirectory()
    nodes.push({
      name: entry.name,
      path,
      relativePath: relative(rootPath, path),
      isDirectory,
      extension: isDirectory ? null : extname(entry.name).toLowerCase() || null,
      children: isDirectory && depth < 1
        ? await scan(path, rootPath, depth + 1).catch(() => [])
        : undefined
    })
  }
  return nodes.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

async function scanFlat(dirPath: string, rootPath: string, out: TreeNode[]): Promise<void> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isDirectory() && ignored.has(entry.name)) continue
    const path = join(dirPath, entry.name)
    if (entry.isDirectory()) {
      await scanFlat(path, rootPath, out).catch(() => {})
      continue
    }
    out.push({
      name: basename(path),
      path,
      relativePath: relative(rootPath, path),
      isDirectory: false,
      extension: extname(path).toLowerCase() || null
    })
  }
}

export async function handleFileTreeRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  context: FileTreeContext
): Promise<boolean> {
  if (!url.pathname.startsWith('/v1/file-tree/')) return false
  if (request.method !== 'POST') return false
  const body = await readJsonBody<JsonRecord>(request)
  const path = typeof body.path === 'string' ? body.path : ''
  const rootPath = typeof body.rootPath === 'string' ? body.rootPath : path

  if (!path || !isPathAllowed(context.db, path) || !isPathAllowed(context.db, rootPath)) {
    writeJson(request, response, context.allowedOrigins, 403, { error: 'path_not_allowed' })
    return true
  }

  if (url.pathname === '/v1/file-tree/scan') {
    const tree = await scan(path, rootPath)
    writeJson(request, response, context.allowedOrigins, 200, { success: true, tree })
    return true
  }
  if (url.pathname === '/v1/file-tree/children') {
    const children = await scan(path, rootPath, 1)
    writeJson(request, response, context.allowedOrigins, 200, { success: true, children })
    return true
  }

  if (url.pathname === '/v1/file-tree/flat') {
    const files: TreeNode[] = []
    await scanFlat(path, rootPath, files)
    writeJson(request, response, context.allowedOrigins, 200, { success: true, files })
    return true
  }

  if (
    url.pathname === '/v1/file-tree/watch' ||
    url.pathname === '/v1/file-tree/unwatch'
  ) {
    writeJson(request, response, context.allowedOrigins, 200, { success: true })
    return true
  }

  return false
}
