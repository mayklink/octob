import type { IncomingMessage, ServerResponse } from 'node:http'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, extname, join, resolve } from 'node:path'
import type { DatabaseService } from '../../main/db/database'
import { detectProjectFavicon, detectProjectLanguage } from '../../main/services/language-detector'
import { readFileAsBase64 } from '../../main/services/file-ops'
import { isPathAllowed } from '../path-guard'
import { readJsonBody, writeJson, type JsonRecord } from '../http'

interface ProjectRouteContext {
  db: DatabaseService
  allowedOrigins: Set<string>
}

const PROJECT_ICON_EXTENSIONS = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp'])
const projectIconDir = (): string => join(homedir(), '.octob', 'project-icons')

function ensureProjectIconDir(): string {
  const dir = projectIconDir()
  mkdirSync(dir, { recursive: true })
  return dir
}

function projectIconPath(filename: string): string | null {
  const safeName = basename(filename)
  if (safeName !== filename || !PROJECT_ICON_EXTENSIONS.has(extname(safeName).toLowerCase())) {
    return null
  }
  const dir = resolve(projectIconDir())
  const candidate = resolve(dir, safeName)
  return candidate.startsWith(dir) ? candidate : null
}

function removeProjectIcons(projectId: string): void {
  const dir = ensureProjectIconDir()
  for (const file of readdirSync(dir)) {
    if (!file.startsWith(`${projectId}.`)) continue
    try {
      unlinkSync(join(dir, file))
    } catch {
      // Best-effort cleanup.
    }
  }
}

function isDirectory(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory()
  } catch {
    return false
  }
}

function isGitRepository(path: string): boolean {
  return isDirectory(path) && existsSync(join(path, '.git'))
}

function pickDirectory(): string | null {
  try {
    if (process.platform === 'win32') {
      const script = [
        'Add-Type -AssemblyName System.Windows.Forms',
        '$d=New-Object System.Windows.Forms.FolderBrowserDialog',
        "if($d.ShowDialog() -eq 'OK'){[Console]::Out.Write($d.SelectedPath)}"
      ].join(';')
      return execFileSync('powershell.exe', ['-NoProfile', '-STA', '-Command', script], {
        encoding: 'utf8',
        timeout: 120_000,
        windowsHide: true
      }).trim() || null
    }
    if (process.platform === 'darwin') {
      return execFileSync(
        'osascript',
        ['-e', 'POSIX path of (choose folder with prompt "Select project")'],
        { encoding: 'utf8', timeout: 120_000 }
      ).trim() || null
    }
    return execFileSync('zenity', ['--file-selection', '--directory'], {
      encoding: 'utf8',
      timeout: 120_000
    }).trim() || null
  } catch {
    return null
  }
}

export async function handleProjectRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  context: ProjectRouteContext
): Promise<boolean> {
  if (!url.pathname.startsWith('/v1/project/')) return false

  if (request.method === 'POST' && url.pathname === '/v1/project/pick-directory') {
    writeJson(request, response, context.allowedOrigins, 200, { path: pickDirectory() })
    return true
  }

  const body = request.method === 'POST'
    ? await readJsonBody<JsonRecord>(request)
    : {}
  const path = typeof body.path === 'string' ? body.path : ''

  if (url.pathname === '/v1/project/custom-icon-save' && request.method === 'POST') {
    const projectId = typeof body.projectId === 'string' ? body.projectId : ''
    const originalName = typeof body.originalName === 'string' ? body.originalName : ''
    const data = typeof body.data === 'string' ? body.data : ''
    const project = projectId ? context.db.getProject(projectId) : null
    const ext = extname(originalName).toLowerCase()
    if (!project || !data || !PROJECT_ICON_EXTENSIONS.has(ext)) {
      writeJson(request, response, context.allowedOrigins, 400, {
        success: false,
        error: 'invalid_project_icon'
      })
      return true
    }
    try {
      removeProjectIcons(projectId)
      const filename = `${projectId}${ext}`
      writeFileSync(join(ensureProjectIconDir(), filename), Buffer.from(data, 'base64'))
      writeJson(request, response, context.allowedOrigins, 200, { success: true, filename })
    } catch (error) {
      writeJson(request, response, context.allowedOrigins, 500, {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      })
    }
    return true
  }

  if (url.pathname === '/v1/project/custom-icon-remove' && request.method === 'POST') {
    const projectId = typeof body.projectId === 'string' ? body.projectId : ''
    if (!projectId || !context.db.getProject(projectId)) {
      writeJson(request, response, context.allowedOrigins, 404, {
        success: false,
        error: 'project_not_found'
      })
      return true
    }
    removeProjectIcons(projectId)
    writeJson(request, response, context.allowedOrigins, 200, { success: true })
    return true
  }

  if (url.pathname === '/v1/project/custom-icon-data' && request.method === 'POST') {
    const filename = typeof body.filename === 'string' ? body.filename : ''
    const iconPath = projectIconPath(filename)
    if (!iconPath || !existsSync(iconPath)) {
      writeJson(request, response, context.allowedOrigins, 200, { value: null })
      return true
    }
    const result = readFileAsBase64(iconPath)
    writeJson(request, response, context.allowedOrigins, 200, {
      value: result.success && result.data && result.mimeType
        ? `data:${result.mimeType};base64,${result.data}`
        : null
    })
    return true
  }

  if (url.pathname === '/v1/project/validate' && request.method === 'POST') {
    const success = isGitRepository(path)
    writeJson(request, response, context.allowedOrigins, 200, success
      ? { success: true, path, name: basename(path) }
      : { success: false, error: isDirectory(path)
        ? 'The selected folder is not a Git repository.'
        : 'The selected path is not a valid directory.' })
    return true
  }

  if (url.pathname === '/v1/project/is-git' && request.method === 'POST') {
    writeJson(request, response, context.allowedOrigins, 200, { value: isGitRepository(path) })
    return true
  }

  if (url.pathname === '/v1/project/init' && request.method === 'POST') {
    if (!isDirectory(path)) {
      writeJson(request, response, context.allowedOrigins, 400, {
        success: false,
        error: 'The selected path is not a valid directory.'
      })
      return true
    }
    try {
      execFileSync('git', ['init'], {
        cwd: path,
        encoding: 'utf8',
        timeout: 30_000,
        windowsHide: true
      })
      writeJson(request, response, context.allowedOrigins, 200, { success: true })
    } catch (error) {
      writeJson(request, response, context.allowedOrigins, 500, {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      })
    }
    return true
  }

  if (url.pathname === '/v1/project/language' && request.method === 'POST') {
    writeJson(request, response, context.allowedOrigins, 200, {
      value: isDirectory(path) ? await detectProjectLanguage(path) : null
    })
    return true
  }

  if (url.pathname === '/v1/project/favicon' && request.method === 'POST') {
    writeJson(request, response, context.allowedOrigins, 200, {
      value: isDirectory(path) ? detectProjectFavicon(path) : null
    })
    return true
  }

  if (url.pathname === '/v1/project/icon-data' && request.method === 'POST') {
    if (!isPathAllowed(context.db, path)) {
      writeJson(request, response, context.allowedOrigins, 403, { error: 'path_not_allowed' })
      return true
    }
    const result = readFileAsBase64(path)
    writeJson(request, response, context.allowedOrigins, 200, {
      value: result.success && result.data && result.mimeType
        ? `data:${result.mimeType};base64,${result.data}`
        : null
    })
    return true
  }

  if (url.pathname === '/v1/project/xcworkspace' && request.method === 'POST') {
    const value = isDirectory(path)
      ? readdirSync(path).find((name) => extname(name) === '.xcworkspace')
      : undefined
    writeJson(request, response, context.allowedOrigins, 200, {
      value: value ? join(path, value) : null
    })
    return true
  }

  if (url.pathname === '/v1/project/android' && request.method === 'POST') {
    writeJson(request, response, context.allowedOrigins, 200, {
      value: isDirectory(path) &&
        (existsSync(join(path, 'settings.gradle')) ||
          existsSync(join(path, 'settings.gradle.kts')))
    })
    return true
  }

  return false
}
