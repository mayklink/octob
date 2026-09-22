import type { IncomingMessage, ServerResponse } from 'node:http'
import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import type { DatabaseService } from '../../main/db/database'
import { detectEditors, detectTerminals } from '../../main/services/settings-detection'
import { testMcpServer } from '../../main/services/mcp-test-service'
import { APP_SETTINGS_DB_KEY } from '../../shared/types/settings'
import type { McpServerConfig } from '../../shared/types/mcp'
import { readJsonBody, writeJson, type JsonRecord } from '../http'
import { isPathAllowed } from '../path-guard'

interface SystemRouteContext {
  db: DatabaseService
  allowedOrigins: Set<string>
}

function spawnDetached(command: string, args: string[], cwd?: string): void {
  const isWindowsShim = process.platform === 'win32' && /\.cmd$/i.test(command)
  const child = spawn(command, args, {
    cwd,
    detached: !isWindowsShim,
    shell: isWindowsShim,
    stdio: 'ignore',
    windowsHide: true
  })
  child.on('error', () => {})
  child.unref()
}

function openNativePath(targetPath: string): { success: boolean; error?: string } {
  try {
    if (process.platform === 'win32') {
      spawnDetached('explorer.exe', [targetPath])
    } else if (process.platform === 'darwin') {
      spawnDetached('open', [targetPath])
    } else {
      spawnDetached('xdg-open', [targetPath])
    }
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function showNativeFolder(targetPath: string): { success: boolean; error?: string } {
  try {
    const folder = statSync(targetPath).isDirectory() ? targetPath : dirname(targetPath)
    if (process.platform === 'win32') {
      if (statSync(targetPath).isDirectory()) spawnDetached('explorer.exe', [targetPath])
      else spawnDetached('explorer.exe', ['/select,', targetPath])
    } else if (process.platform === 'darwin') {
      if (statSync(targetPath).isDirectory()) spawnDetached('open', [targetPath])
      else spawnDetached('open', ['-R', targetPath])
    } else {
      spawnDetached('xdg-open', [folder])
    }
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function openAndroidStudio(targetPath: string): { success: boolean; error?: string } {
  const candidates = process.platform === 'win32'
    ? [
        process.env.LOCALAPPDATA
          ? `${process.env.LOCALAPPDATA}\\Programs\\Android Studio\\bin\\studio64.exe`
          : '',
        process.env.PROGRAMFILES
          ? `${process.env.PROGRAMFILES}\\Android\\Android Studio\\bin\\studio64.exe`
          : '',
        'studio64.exe'
      ]
    : process.platform === 'darwin'
      ? ['/Applications/Android Studio.app/Contents/MacOS/studio', 'studio']
      : ['studio', '/opt/android-studio/bin/studio.sh']

  const command = candidates.find((candidate) => candidate && existsSync(candidate)) ??
    candidates[candidates.length - 1]
  if (!command) return { success: false, error: 'Android Studio not found' }
  try {
    spawnDetached(command, [targetPath])
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function appSettings(db: DatabaseService): Record<string, unknown> {
  try {
    const raw = db.getSetting(APP_SETTINGS_DB_KEY)
    return raw ? JSON.parse(raw) as Record<string, unknown> : {}
  } catch {
    return {}
  }
}
function openEditor(
  db: DatabaseService,
  targetPath: string,
  requestedEditorId?: string,
  requestedCommand?: string
): { success: boolean; error?: string } {
  const settings = appSettings(db)
  const editorId = requestedEditorId ||
    (typeof settings.defaultEditor === 'string' ? settings.defaultEditor : 'vscode')
  const custom = requestedCommand?.trim() ||
    (typeof settings.customEditorCommand === 'string'
      ? settings.customEditorCommand.trim()
      : '')

  if (editorId === 'custom' && custom) {
    spawnDetached(custom, [targetPath])
    return { success: true }
  }

  const editor = detectEditors().find((item) => item.id === editorId && item.available)
  if (!editor) return { success: false, error: `Editor ${editorId} not found` }
  spawnDetached(editor.command, [targetPath])
  return { success: true }
}

function openTerminal(
  db: DatabaseService,
  targetPath: string,
  requestedTerminalId?: string,
  requestedCommand?: string
): { success: boolean; error?: string } {
  const settings = appSettings(db)
  const terminalId = requestedTerminalId ||
    (typeof settings.defaultTerminal === 'string'
      ? settings.defaultTerminal
      : 'terminal')
  const custom = requestedCommand?.trim() ||
    (typeof settings.customTerminalCommand === 'string'
      ? settings.customTerminalCommand.trim()
      : '')

  if (terminalId === 'custom' && custom) {
    spawnDetached(custom, [targetPath], targetPath)
    return { success: true }
  }

  if (process.platform === 'win32') {
    if (terminalId === 'terminal') {
      const wt = detectTerminals().find((item) => item.id === 'terminal' && item.available)
      if (wt) spawnDetached(wt.command, ['-d', targetPath])
      else spawnDetached('powershell.exe', ['-NoExit', '-Command', `Set-Location '${targetPath.replace(/'/g, "''")}'`])
      return { success: true }
    }
    if (terminalId === 'powershell') {
      spawnDetached('powershell.exe', ['-NoExit', '-Command', `Set-Location '${targetPath.replace(/'/g, "''")}'`])
      return { success: true }
    }
    if (terminalId === 'cmd') {
      spawnDetached('cmd.exe', ['/k', `cd /d "${targetPath}"`])
      return { success: true }
    }
  }

  const terminal = detectTerminals().find((item) => item.id === terminalId && item.available)
  if (!terminal) return { success: false, error: `Terminal ${terminalId} not found` }
  spawnDetached(terminal.command, [], targetPath)
  return { success: true }
}
export async function handleSystemRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  context: SystemRouteContext
): Promise<boolean> {
  if (!url.pathname.startsWith('/v1/system/')) return false

  if (request.method === 'GET' && url.pathname === '/v1/system/editors') {
    writeJson(request, response, context.allowedOrigins, 200, detectEditors())
    return true
  }

  if (request.method === 'GET' && url.pathname === '/v1/system/terminals') {
    writeJson(request, response, context.allowedOrigins, 200, detectTerminals())
    return true
  }

  if (request.method !== 'POST') return false

  const body = await readJsonBody<JsonRecord>(request)

  if (url.pathname === '/v1/system/mcp-test') {
    const server = body.server
    if (!server || typeof server !== 'object') {
      writeJson(request, response, context.allowedOrigins, 400, { error: 'server_required' })
      return true
    }
    const result = await testMcpServer(server as unknown as McpServerConfig)
    writeJson(request, response, context.allowedOrigins, 200, result)
    return true
  }

  const targetPath = typeof body.path === 'string' ? body.path : ''
  if (!targetPath || !existsSync(targetPath) || !isPathAllowed(context.db, targetPath)) {
    writeJson(request, response, context.allowedOrigins, 403, { error: 'path_not_allowed' })
    return true
  }

  const result =
    url.pathname === '/v1/system/open-editor'
      ? openEditor(
          context.db,
          targetPath,
          typeof body.editorId === 'string' ? body.editorId : undefined,
          typeof body.customCommand === 'string' ? body.customCommand : undefined
        )
      : url.pathname === '/v1/system/open-terminal'
        ? openTerminal(
            context.db,
            targetPath,
            typeof body.terminalId === 'string' ? body.terminalId : undefined,
            typeof body.customCommand === 'string' ? body.customCommand : undefined
          )
        : url.pathname === '/v1/system/open-path'
          ? openNativePath(targetPath)
          : url.pathname === '/v1/system/show-in-folder'
            ? showNativeFolder(targetPath)
            : url.pathname === '/v1/system/open-android-studio'
              ? openAndroidStudio(targetPath)
              : null

  if (!result) return false
  writeJson(request, response, context.allowedOrigins, result.success ? 200 : 404, result)
  return true
}
