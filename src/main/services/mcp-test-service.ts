import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import type { McpKeyValue, McpServerConfig } from '../../shared/types/mcp'
import { splitCommandLineArgs } from './mcp-settings'

function keyValuesToRecord(rows: McpKeyValue[]): Record<string, string> {
  const record: Record<string, string> = {}
  for (const row of rows) {
    const name = row.name.trim()
    if (name) record[name] = row.value
  }
  return record
}

function processEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  )
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

export async function testMcpServer(
  server: McpServerConfig
): Promise<{ success: boolean; message: string; toolCount?: number }> {
  const name = server.name.trim() || 'MCP'
  let transport: StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport | null = null
  const client = new Client(
    { name: 'octob-mcp-test', version: '1.0.0' },
    { capabilities: {} }
  )

  try {
    if (server.transport === 'stdio') {
      const command = server.command.trim()
      if (!command) return { success: false, message: 'Informe o comando do MCP.' }

      transport = new StdioClientTransport({
        command,
        args: splitCommandLineArgs(server.args),
        env: {
          ...processEnvironment(),
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

    await withTimeout(client.connect(transport), 15_000)
    const tools = await withTimeout(client.listTools(), 15_000)
    const toolCount = tools.tools.length
    return {
      success: true,
      toolCount,
      message: `${name} conectado. ${toolCount} ${toolCount === 1 ? 'tool disponível' : 'tools disponíveis'}.`
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
