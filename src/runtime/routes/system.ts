import type { IncomingMessage, ServerResponse } from 'node:http'
import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import type { DatabaseService } from '../../main/db/database'
import { detectEditors, detectTerminals } from '../../main/services/settings-detection'
import { testMcpServer } from '../../main/services/mcp-test-service'
import { configure as configureCodexDebugLogger } from '../../main/services/codex-debug-logger'
import { APP_SETTINGS_DB_KEY } from '../../shared/types/settings'
import type { McpServerConfig } from '../../shared/types/mcp'
import { readJsonBody, writeJson, type JsonRecord } from '../http'
import { isPathAllowed } from '../path-guard'
import type { RuntimeAgentService } from '../agent-runtime'
import { appendFileSync, mkdirSync } from 'node:fs'
import * as v8 from 'node:v8'

interface SystemRouteContext {
  db: DatabaseService
  agents: RuntimeAgentService
  allowedOrigins: Set<string>
}

let perfDiagnosticsEnabled = false
let perfDiagnosticsInterval: NodeJS.Timeout | null = null
let previousCpuUsage: NodeJS.CpuUsage | null = null
let previousCpuTimestamp = 0

type WebUpdateState = {
  status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  version: string | null
  error: string | null
  percent: number | null
  url?: string | null
}

let webUpdateState: WebUpdateState = {
  status: 'idle',
  version: null,
  error: null,
  percent: null,
  url: null
}

function webVersion(): string {
  return process.env.OCTOB_WEB_VERSION?.trim() || 'web-runtime'
}

function compareVersions(left: string, right: string): number {
  const parse = (value: string): number[] => value.replace(/^v/i, '').split('.').map((part) => Number.parseInt(part, 10) || 0)
  const a = parse(left)
  const b = parse(right)
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) > (b[index] ?? 0) ? 1 : -1
  }
  return 0
}

async function checkWebUpdates(): Promise<WebUpdateState> {
  const manifestUrl = process.env.OCTOB_WEB_UPDATE_URL?.trim()
  if (!manifestUrl) {
    webUpdateState = {
      status: 'not-available',
      version: webVersion(),
      error: 'Web update manifest is not configured.',
      percent: null,
      url: null
    }
    return webUpdateState
  }

  webUpdateState = { ...webUpdateState, status: 'checking', error: null, percent: null }
  try {
    const result = await fetch(manifestUrl)
    if (!result.ok) throw new Error(`Update manifest returned ${result.status}.`)
    const manifest = await result.json() as { version?: string; url?: string }
    const availableVersion = typeof manifest.version === 'string' ? manifest.version : null
    const available = Boolean(availableVersion && compareVersions(availableVersion, webVersion()) > 0)
    webUpdateState = {
      status: available ? 'available' : 'not-available',
      version: availableVersion ?? webVersion(),
      error: null,
      percent: null,
      url: manifest.url ?? null
    }
  } catch (error) {
    webUpdateState = {
      status: 'error',
      version: null,
      error: error instanceof Error ? error.message : String(error),
      percent: null,
      url: null
    }
  }
  return webUpdateState
}

function performanceSnapshot(): Record<string, unknown> {
  const now = Date.now()
  const memory = process.memoryUsage()
  const cpu = process.cpuUsage()
  const elapsedMicros = previousCpuTimestamp ? Math.max(1, (now - previousCpuTimestamp) * 1000) : 0
  const cpuPercent = elapsedMicros
    ? ((cpu.user - (previousCpuUsage?.user ?? cpu.user) + cpu.system - (previousCpuUsage?.system ?? cpu.system)) / elapsedMicros) * 100
    : 0
  previousCpuUsage = cpu
  previousCpuTimestamp = now
  const handles = (process as NodeJS.Process & { _getActiveHandles?: () => unknown[] })
    ._getActiveHandles?.() ?? []
  const byType: Record<string, number> = {}
  for (const handle of handles) {
    const type = (handle as { constructor?: { name?: string } })?.constructor?.name ?? 'Unknown'
    byType[type] = (byType[type] ?? 0) + 1
  }
  const heap = v8.getHeapStatistics()
  return {
    perfVersion: 'v6',
    timestamp: new Date(now).toISOString(),
    uptimeMs: process.uptime() * 1000,
    cpu: {
      userMs: Math.round(cpu.user / 1000),
      systemMs: Math.round(cpu.system / 1000),
      percentSinceLastSample: Math.round(cpuPercent * 100) / 100
    },
    memory: {
      rss: memory.rss,
      heapUsed: memory.heapUsed,
      heapTotal: memory.heapTotal,
      external: memory.external,
      arrayBuffers: memory.arrayBuffers,
      nativeEstimate: Math.max(0, memory.rss - memory.heapTotal - memory.external)
    },
    heap: {
      sizeLimit: heap.heap_size_limit,
      totalPhysical: heap.total_physical_size,
      mallocedMemory: heap.malloced_memory,
      numberOfGcContexts: heap.number_of_native_contexts
    },
    processes: { ptyActive: -1, scriptsActive: -1, scriptsTotalOpened: -1, scriptsTotalClosed: -1 },
    watchers: { fileTree: -1, worktree: -1, branch: -1 },
    sessions: { active: -1 },
    handles: { active: handles.length, requests: -1, byType },
    electron: { windows: -1, webContents: -1 },
    eventLoopLagMs: -1
  }
}

function writePerformanceSnapshot(): void {
  try {
    const logDir = join(homedir(), '.octob', 'logs')
    mkdirSync(logDir, { recursive: true })
    appendFileSync(join(logDir, 'perf-diagnostics.jsonl'), `${JSON.stringify(performanceSnapshot())}\n`)
  } catch {
    // Diagnostics must never affect the application.
  }
}

function setPerformanceDiagnostics(enabled: boolean): void {
  perfDiagnosticsEnabled = enabled
  if (perfDiagnosticsInterval) clearInterval(perfDiagnosticsInterval)
  perfDiagnosticsInterval = null
  if (enabled) {
    writePerformanceSnapshot()
    perfDiagnosticsInterval = setInterval(writePerformanceSnapshot, 30_000)
  }
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

  const userData = join(homedir(), '.octob')
  const logs = join(userData, 'logs')
  if (request.method === 'GET' && url.pathname === '/v1/system/log-dir') {
    writeJson(request, response, context.allowedOrigins, 200, { path: logs })
    return true
  }
  if (request.method === 'GET' && url.pathname === '/v1/system/app-paths') {
    writeJson(request, response, context.allowedOrigins, 200, {
      userData,
      home: homedir(),
      logs
    })
    return true
  }
  if (request.method === 'GET' && url.pathname === '/v1/system/log-mode') {
    writeJson(request, response, context.allowedOrigins, 200, {
      enabled: process.argv.includes('--log')
    })
    return true
  }
  if (request.method === 'GET' && url.pathname === '/v1/system/version') {
    writeJson(request, response, context.allowedOrigins, 200, { version: webVersion() })
    return true
  }
  if (request.method === 'GET' && url.pathname === '/v1/system/updates/state') {
    writeJson(request, response, context.allowedOrigins, 200, webUpdateState)
    return true
  }

  if (request.method === 'GET' && url.pathname === '/v1/system/analytics') {
    writeJson(request, response, context.allowedOrigins, 200, {
      enabled: context.db.getSetting('telemetry_enabled') !== 'false'
    })
    return true
  }

  if (request.method === 'GET' && url.pathname === '/v1/system/perf-snapshot') {
    writeJson(request, response, context.allowedOrigins, 200, {
      enabled: perfDiagnosticsEnabled,
      snapshot: performanceSnapshot()
    })
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

  if (url.pathname === '/v1/system/configure-codex') {
    const binaryPath = typeof body.binaryPath === 'string' ? body.binaryPath : ''
    writeJson(
      request,
      response,
      context.allowedOrigins,
      200,
      context.agents.configureCodexBinaryPath(binaryPath)
    )
    return true
  }

  if (url.pathname === '/v1/system/analytics') {
    const enabled = body.enabled === true
    context.db.setSetting('telemetry_enabled', enabled ? 'true' : 'false')
    writeJson(request, response, context.allowedOrigins, 200, { success: true, enabled })
    return true
  }

  if (url.pathname === '/v1/system/analytics/track') {
    writeJson(request, response, context.allowedOrigins, 200, {
      success: true,
      sent: false,
      reason: 'browser_runtime_local_only'
    })
    return true
  }

  if (url.pathname === '/v1/system/perf-enable') {
    setPerformanceDiagnostics(body.enabled === true)
    writeJson(request, response, context.allowedOrigins, 200, {
      success: true,
      enabled: perfDiagnosticsEnabled
    })
    return true
  }

  if (url.pathname === '/v1/system/codex-debug') {
    configureCodexDebugLogger({
      enabled: body.enabled === true,
      resetPerSession: body.resetPerSession !== false
    })
    writeJson(request, response, context.allowedOrigins, 200, { success: true })
    return true
  }

  if (url.pathname === '/v1/system/updates/check') {
    writeJson(request, response, context.allowedOrigins, 200, await checkWebUpdates())
    return true
  }

  if (url.pathname === '/v1/system/updates/download') {
    if (webUpdateState.status !== 'available') {
      writeJson(request, response, context.allowedOrigins, 200, webUpdateState)
      return true
    }
    webUpdateState = { ...webUpdateState, status: 'downloaded', percent: 100 }
    writeJson(request, response, context.allowedOrigins, 200, webUpdateState)
    return true
  }

  if (url.pathname === '/v1/system/updates/install') {
    writeJson(request, response, context.allowedOrigins, 200, { success: true, action: 'reload' })
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
