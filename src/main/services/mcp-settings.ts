import type { McpServer } from '@agentclientprotocol/sdk/dist/schema'
import type { McpServerConfig as ClaudeMcpServerConfig } from '@anthropic-ai/claude-agent-sdk'
import type { JsonValue } from '@shared/codex-schemas/serde_json/JsonValue'
import { APP_SETTINGS_DB_KEY } from '@shared/types/settings'
import type { McpKeyValue, McpServerConfig, McpTransport } from '@shared/types/mcp'
import type { DatabaseService } from '../db/database'

function normalizeKeyValues(value: unknown): McpKeyValue[] {
  if (!Array.isArray(value)) return []
  return value
    .map((row) => {
      if (!row || typeof row !== 'object') return null
      const typed = row as Record<string, unknown>
      const name = typeof typed.name === 'string' ? typed.name.trim() : ''
      const rowValue = typeof typed.value === 'string' ? typed.value : ''
      if (!name) return null
      return { name, value: rowValue }
    })
    .filter((row): row is McpKeyValue => row !== null)
}

function normalizeMcpServers(value: unknown): McpServerConfig[] {
  if (!Array.isArray(value)) return []
  return value
    .map((row) => {
      if (!row || typeof row !== 'object') return null
      const typed = row as Record<string, unknown>
      const transport: McpTransport =
        typed.transport === 'http' || typed.transport === 'sse' || typed.transport === 'stdio'
          ? typed.transport
          : 'stdio'

      return {
        id: typeof typed.id === 'string' ? typed.id : '',
        enabled: typed.enabled !== false,
        name: typeof typed.name === 'string' ? typed.name : '',
        transport,
        command: typeof typed.command === 'string' ? typed.command : '',
        args: typeof typed.args === 'string' ? typed.args : '',
        env: normalizeKeyValues(typed.env),
        url: typeof typed.url === 'string' ? typed.url : '',
        headers: normalizeKeyValues(typed.headers)
      }
    })
    .filter((server): server is McpServerConfig => server !== null)
}

const INHERITED_MCP_ENV_NAMES = new Set([
  'PATH',
  'Path',
  'PATHEXT',
  'HOME',
  'HOMEDRIVE',
  'HOMEPATH',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA'
])

export function splitCommandLineArgs(input: string): string[] {
  const args: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaping = false

  for (const char of input) {
    if (escaping) {
      current += char
      escaping = false
      continue
    }

    if (char === '\\') {
      escaping = true
      continue
    }

    if (quote) {
      if (char === quote) {
        quote = null
      } else {
        current += char
      }
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      continue
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        args.push(current)
        current = ''
      }
      continue
    }

    current += char
  }

  if (escaping) current += '\\'
  if (current.length > 0) args.push(current)
  return args
}

function pickAllowedInheritedMcpEnvironment(
  source: Record<string, string | undefined>
): Record<string, string> {
  const env: Record<string, string> = {}

  for (const [name, value] of Object.entries(source)) {
    if (typeof value !== 'string') continue
    if (INHERITED_MCP_ENV_NAMES.has(name) || INHERITED_MCP_ENV_NAMES.has(name.toUpperCase())) {
      env[name] = value
    }
  }

  return env
}

function isAzureDevOpsMcpServer(server: McpServerConfig): boolean {
  const haystack = `${server.name} ${server.command} ${server.args} ${server.url}`.toLowerCase()
  return haystack.includes('@azure-devops/mcp') || haystack.includes('azure-devops')
}

function normalizeAzureDevOpsPersonalAccessTokenEnv(raw: string): string {
  const value = raw.trim().replace(/^["']|["']$/g, '')
  if (!value) return value

  try {
    const decoded = Buffer.from(value, 'base64').toString('utf8')
    if (decoded.startsWith(':') && decoded.length > 1) return value
  } catch {
    // Fall through and encode the raw PAT.
  }

  return Buffer.from(`:${value}`).toString('base64')
}

function getBaseMcpEnvironment(): Record<string, string> {
  return pickAllowedInheritedMcpEnvironment(process.env)
}

function keyValuesToRecord(rows: McpKeyValue[]): Record<string, string> {
  const record: Record<string, string> = {}
  for (const row of rows) {
    const name = row.name.trim()
    if (name) record[name] = row.value
  }
  return record
}

function getStdioMcpEnvironment(
  server: McpServerConfig,
  rows: McpKeyValue[]
): Record<string, string> {
  const env = {
    ...getBaseMcpEnvironment(),
    ...keyValuesToRecord(rows)
  }

  if (isAzureDevOpsMcpServer(server)) {
    const pat = env.PERSONAL_ACCESS_TOKEN
    if (pat) {
      env.PERSONAL_ACCESS_TOKEN = normalizeAzureDevOpsPersonalAccessTokenEnv(pat)
    }
  }

  return env
}

function recordToKeyValues(record: Record<string, string>): McpKeyValue[] {
  return Object.entries(record).map(([name, value]) => ({ name, value }))
}

export function getConfiguredMcpServers(dbService: DatabaseService | null): McpServer[] {
  if (!dbService) return []

  try {
    const raw = dbService.getSetting(APP_SETTINGS_DB_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Record<string, unknown>

    return normalizeMcpServers(parsed.mcpServers)
      .filter((server) => server.enabled)
      .map((server): McpServer | null => {
        const name = server.name.trim()
        if (!name) return null

        if (server.transport === 'stdio') {
          const command = server.command.trim()
          if (!command) return null
          return {
            name,
            command,
            args: splitCommandLineArgs(server.args),
            env: recordToKeyValues(getStdioMcpEnvironment(server, server.env))
          }
        }

        const url = server.url.trim()
        if (!url) return null
        return {
          type: server.transport,
          name,
          url,
          headers: server.headers.filter((row) => row.name.trim()).map((row) => ({
            name: row.name.trim(),
            value: row.value
          }))
        }
      })
      .filter((server): server is McpServer => server !== null)
  } catch {
    return []
  }
}

export function getConfiguredCodexMcpServers(
  dbService: DatabaseService | null
): { [key in string]?: JsonValue } | null {
  if (!dbService) return null

  try {
    const raw = dbService.getSetting(APP_SETTINGS_DB_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const entries: Array<[string, { [key in string]?: JsonValue }]> = []

    for (const server of normalizeMcpServers(parsed.mcpServers)) {
      if (!server.enabled) continue

      const name = server.name.trim()
      if (!name) continue

      if (server.transport === 'stdio') {
        const command = server.command.trim()
        if (!command) continue

        const config: { [key in string]?: JsonValue } = {
          command,
          args: splitCommandLineArgs(server.args)
        }
        const env = getStdioMcpEnvironment(server, server.env)
        if (Object.keys(env).length > 0) config.env = env

        entries.push([name, config])
        continue
      }

      const url = server.url.trim()
      if (!url) continue

      const config: { [key in string]?: JsonValue } = { url }
      const headers = keyValuesToRecord(server.headers)
      if (Object.keys(headers).length > 0) config.http_headers = headers

      entries.push([name, config])
    }

    return entries.length > 0 ? Object.fromEntries(entries) : null
  } catch {
    return null
  }
}

export function getConfiguredClaudeMcpServers(
  dbService: DatabaseService | null
): Record<string, ClaudeMcpServerConfig> {
  if (!dbService) return {}

  try {
    const raw = dbService.getSetting(APP_SETTINGS_DB_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const entries: Array<[string, ClaudeMcpServerConfig]> = []

    for (const server of normalizeMcpServers(parsed.mcpServers)) {
      if (!server.enabled) continue

      const name = server.name.trim()
      if (!name) continue

      if (server.transport === 'stdio') {
        const command = server.command.trim()
        if (!command) continue

        const config: ClaudeMcpServerConfig = {
          type: 'stdio',
          command,
          args: splitCommandLineArgs(server.args)
        }
        const env = getStdioMcpEnvironment(server, server.env)
        if (Object.keys(env).length > 0) config.env = env

        entries.push([name, config])
        continue
      }

      const url = server.url.trim()
      if (!url) continue

      const config: ClaudeMcpServerConfig = {
        type: server.transport,
        url
      }
      const headers = keyValuesToRecord(server.headers)
      if (Object.keys(headers).length > 0) config.headers = headers

      entries.push([name, config])
    }

    return Object.fromEntries(entries)
  } catch {
    return {}
  }
}
