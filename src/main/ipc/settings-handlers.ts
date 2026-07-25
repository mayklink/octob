import { ipcMain } from 'electron'
import { existsSync } from 'fs'
import { spawn } from 'child_process'
import { platform } from 'os'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { createLogger } from '../services'
import { telemetryService } from '../services/telemetry-service'
import { getDatabase } from '../db'
import { detectEditors, detectTerminals, type DetectedApp } from '../services/settings-detection'
import { APP_SETTINGS_DB_KEY } from '@shared/types/settings'
import type { McpKeyValue, McpServerConfig } from '@shared/types/mcp'
import { splitCommandLineArgs } from '../services/mcp-settings'

const log = createLogger({ component: 'SettingsHandlers' })

/**
 * Windows: `cmd /c start ...` opens the editor but often leaves a console window visible.
 * Prefer spawning `Cursor.exe` / other `.exe` directly; use `shell: true` without `detached`
 * for `.cmd` shims (avoids EINVAL from `detached` + `shell` and keeps the window hidden).
 */
function spawnEditorDetached(command: string, args: string[]): void {
  if (platform() === 'win32') {
    if (/\.exe$/i.test(command)) {
      const child = spawn(command, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      })
      child.on('error', () => {})
      child.unref()
      return
    }
    const child = spawn(command, args, {
      shell: true,
      stdio: 'ignore',
      windowsHide: true
    })
    child.on('error', () => {})
    child.unref()
    return
  }
  const child = spawn(command, args, { detached: true, stdio: 'ignore' })
  child.on('error', () => {})
  child.unref()
}

function resolveEditorCommand(
  editorId: string,
  customCommand?: string
): { command: string } | { error: string } {
  if (editorId === 'custom' && customCommand) {
    return { command: customCommand }
  }
  const editors = detectEditors()
  const editor = editors.find((e) => e.id === editorId)
  if (!editor?.available) {
    return { error: `Editor ${editorId} not found` }
  }
  return { command: editor.command }
}

function keyValuesToRecord(rows: McpKeyValue[]): Record<string, string> {
  const record: Record<string, string> = {}
  for (const row of rows) {
    const name = row.name.trim()
    if (name) record[name] = row.value
  }
  return record
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timeout depois de ${ms / 1000}s`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timeout)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timeout)
        reject(error)
      }
    )
  })
}

function isAuthRequired(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /unauthorized|authorization|auth|oauth|401|403/i.test(message)
}

async function testMcpServer(
  server: McpServerConfig
): Promise<{ success: boolean; message: string; toolCount?: number }> {
  const name = server.name.trim() || 'MCP'
  let transport: StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport | null = null
  const client = new Client({ name: 'octob-mcp-test', version: '1.0.0' }, { capabilities: {} })

  try {
    if (server.transport === 'stdio') {
      const command = server.command.trim()
      if (!command) return { success: false, message: 'Informe o comando do MCP.' }

      transport = new StdioClientTransport({
        command,
        args: splitCommandLineArgs(server.args),
        env: {
          ...process.env,
          ...keyValuesToRecord(server.env)
        },
        stderr: 'pipe'
      })
    } else {
      const url = server.url.trim()
      if (!url) return { success: false, message: 'Informe a URL do MCP.' }
      const headers = keyValuesToRecord(server.headers)
      const requestInit = Object.keys(headers).length > 0 ? { headers } : undefined

      transport =
        server.transport === 'sse'
          ? new SSEClientTransport(new URL(url), { requestInit })
          : new StreamableHTTPClientTransport(new URL(url), { requestInit })
    }

    await withTimeout(client.connect(transport), 15000)
    const tools = await withTimeout(client.listTools(), 15000)
    const toolCount = tools.tools.length
    return {
      success: true,
      toolCount,
      message: `${name} conectado. ${toolCount} tool${toolCount === 1 ? '' : 's'} disponível${toolCount === 1 ? '' : 's'}.`
    }
  } catch (error) {
    if (isAuthRequired(error)) {
      return {
        success: false,
        message:
          'O servidor respondeu, mas exige autenticação/OAuth. Faça a autenticação pelo agente compatível ou configure token/header.'
      }
    }
    return {
      success: false,
      message: error instanceof Error ? error.message : String(error)
    }
  } finally {
    try {
      await client.close()
    } catch {
      // ignore
    }
    try {
      await transport?.close()
    } catch {
      // ignore
    }
  }
}

/** Fire-and-forget spawn: suppress errors and fully detach from parent event loop. */
function spawnDetached(...args: Parameters<typeof spawn>): void {
  const child = spawn(...args)
  child.on('error', () => {})
  child.unref()
}

/**
 * Launch a terminal at the given path using the specified terminal ID.
 * Contains all platform-specific terminal launch logic in one place.
 */
function launchTerminal(
  targetPath: string,
  terminalId: string,
  customCommand?: string
): { success: boolean; error?: string } {
  const currentPlatform = platform()

  if (terminalId === 'custom' && customCommand) {
    spawnDetached(customCommand, [targetPath], { detached: true, stdio: 'ignore' })
    return { success: true }
  }

  if (currentPlatform === 'darwin') {
    switch (terminalId) {
      case 'terminal':
        spawnDetached('open', ['-a', 'Terminal', targetPath], { detached: true })
        break
      case 'iterm':
        spawnDetached('open', ['-a', 'iTerm', targetPath], { detached: true })
        break
      case 'warp':
        spawnDetached('open', ['-a', 'Warp', targetPath], { detached: true })
        break
      case 'alacritty':
        spawnDetached('alacritty', ['--working-directory', targetPath], {
          detached: true,
          stdio: 'ignore'
        })
        break
      case 'kitty':
        spawnDetached('kitty', ['--directory', targetPath], { detached: true, stdio: 'ignore' })
        break
      case 'ghostty':
        spawnDetached('open', ['-a', 'Ghostty', targetPath], { detached: true })
        break
      default:
        spawnDetached('open', ['-a', 'Terminal', targetPath], { detached: true })
    }
  } else if (currentPlatform === 'win32') {
    switch (terminalId) {
      case 'terminal': {
        // Windows Terminal may not be installed; fall back to PowerShell
        const terminals = detectTerminals()
        const wt = terminals.find((t) => t.id === 'terminal')
        if (wt?.available) {
          spawnDetached('wt.exe', ['-d', targetPath], { detached: true, stdio: 'ignore' })
        } else {
          spawnDetached('powershell.exe', ['-NoExit', '-Command', `Set-Location '${targetPath.replace(/'/g, "''")}'`], {
            detached: true,
            stdio: 'ignore'
          })
        }
        break
      }
      case 'powershell':
        spawnDetached('powershell.exe', ['-NoExit', '-Command', `Set-Location '${targetPath.replace(/'/g, "''")}'`], {
          detached: true,
          stdio: 'ignore'
        })
        break
      case 'cmd':
        spawnDetached('cmd.exe', ['/k', `cd /d "${targetPath}"`], {
          detached: true,
          stdio: 'ignore'
        })
        break
      default: {
        const terminals = detectTerminals()
        const terminal = terminals.find((t) => t.id === terminalId)
        if (terminal?.available) {
          spawnDetached(terminal.command, [], { cwd: targetPath, detached: true, stdio: 'ignore' })
        } else {
          return { success: false, error: 'Terminal not found' }
        }
      }
    }
  } else {
    // Fallback for Linux and other platforms
    const terminals = detectTerminals()
    const terminal = terminals.find((t) => t.id === terminalId)
    if (terminal?.available) {
      spawnDetached(terminal.command, [], { cwd: targetPath, detached: true, stdio: 'ignore' })
    } else {
      return { success: false, error: 'Terminal not found' }
    }
  }

  return { success: true }
}

/**
 * Open a path with the user's preferred editor (reads defaultEditor and customEditorCommand from DB).
 * Used by worktree, connection, and git "Open in Editor" handlers.
 */
export function openPathWithPreferredEditor(
  path: string
): Promise<{ success: boolean; error?: string }> {
  if (!existsSync(path)) {
    return Promise.resolve({ success: false, error: 'Path does not exist' })
  }
  let editorId = 'vscode'
  let customCommand = ''
  try {
    const raw = getDatabase().getSetting(APP_SETTINGS_DB_KEY)
    if (raw) {
      const settings = JSON.parse(raw) as { defaultEditor?: string; customEditorCommand?: string }
      if (settings.defaultEditor) editorId = settings.defaultEditor
      if (settings.customEditorCommand != null) customCommand = settings.customEditorCommand
    }
  } catch {
    // Use defaults
  }
  const resolved = resolveEditorCommand(editorId, customCommand || undefined)
  if ('error' in resolved) {
    return Promise.resolve({ success: false, error: resolved.error })
  }
  try {
    spawnEditorDetached(resolved.command, [path])
    return Promise.resolve({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return Promise.resolve({ success: false, error: message })
  }
}

/**
 * Open a path with the user's preferred terminal (reads defaultTerminal and customTerminalCommand from DB).
 * Used by worktree, connection, and keyboard shortcut "Open in Terminal" handlers.
 */
export function openPathWithPreferredTerminal(
  path: string
): Promise<{ success: boolean; error?: string }> {
  if (!existsSync(path)) {
    return Promise.resolve({ success: false, error: 'Path does not exist' })
  }
  let terminalId = 'terminal'
  let customCommand = ''
  try {
    const raw = getDatabase().getSetting(APP_SETTINGS_DB_KEY)
    if (raw) {
      const settings = JSON.parse(raw) as { defaultTerminal?: string; customTerminalCommand?: string }
      if (settings.defaultTerminal) terminalId = settings.defaultTerminal
      if (settings.customTerminalCommand != null) customCommand = settings.customTerminalCommand
    }
  } catch {
    // Use defaults
  }
  try {
    return Promise.resolve(launchTerminal(path, terminalId, customCommand || undefined))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return Promise.resolve({ success: false, error: message })
  }
}

export function registerSettingsHandlers(): void {
  log.info('Registering settings handlers')

  // Detect installed editors
  ipcMain.handle('settings:detectEditors', async (): Promise<DetectedApp[]> => {
    try {
      return detectEditors()
    } catch (error) {
      log.error(
        'Failed to detect editors',
        error instanceof Error ? error : new Error(String(error))
      )
      return []
    }
  })

  // Detect installed terminals
  ipcMain.handle('settings:detectTerminals', async (): Promise<DetectedApp[]> => {
    try {
      return detectTerminals()
    } catch (error) {
      log.error(
        'Failed to detect terminals',
        error instanceof Error ? error : new Error(String(error))
      )
      return []
    }
  })

  // Open a path with a specific editor command (explicit editorId/customCommand from renderer)
  ipcMain.handle(
    'settings:openWithEditor',
    async (
      _event,
      worktreePath: string,
      editorId: string,
      customCommand?: string
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        if (!existsSync(worktreePath)) {
          return { success: false, error: 'Path does not exist' }
        }
        const resolved = resolveEditorCommand(editorId, customCommand)
        if ('error' in resolved) {
          return { success: false, error: resolved.error }
        }

        spawnEditorDetached(resolved.command, [worktreePath])
        telemetryService.track('worktree_opened_in_editor')
        return { success: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    }
  )

  // Open a path with a specific terminal (explicit terminalId/customCommand from renderer)
  ipcMain.handle(
    'settings:openWithTerminal',
    async (
      _event,
      worktreePath: string,
      terminalId: string,
      customCommand?: string
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        if (!existsSync(worktreePath)) {
          return { success: false, error: 'Path does not exist' }
        }
        return launchTerminal(worktreePath, terminalId, customCommand)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    }
  )

  // Get all settings as a batch
  ipcMain.handle('settings:getAll', async (): Promise<Record<string, string>> => {
    try {
      const db = getDatabase()
      const allSettings = db.getAllSettings()
      const result: Record<string, string> = {}
      for (const setting of allSettings) {
        result[setting.key] = setting.value
      }
      return result
    } catch (error) {
      log.error(
        'Failed to get all settings',
        error instanceof Error ? error : new Error(String(error))
      )
      return {}
    }
  })

  ipcMain.handle(
    'settings:mcp:test',
    async (
      _event,
      server: McpServerConfig
    ): Promise<{ success: boolean; message: string; toolCount?: number }> => {
      try {
        return await testMcpServer(server)
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : String(error)
        }
      }
    }
  )
}
