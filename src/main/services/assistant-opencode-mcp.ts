import { resolve } from 'node:path'

interface OpenCodeMcpClient {
  mcp: {
    add: (options: {
      query: { directory: string }
      body: { name: string; config: { type: 'remote'; url: string; enabled: true; oauth: false } }
    }) => Promise<{ data?: Record<string, { status: string; error?: string }>; error?: unknown }>
  }
}

export async function bindAssistantMcpToOpenCode(
  client: OpenCodeMcpClient,
  worktreePath: string,
  assistantWorkspacePath: string,
  url: string
): Promise<boolean> {
  if (resolve(worktreePath) !== resolve(assistantWorkspacePath)) return false
  const result = await client.mcp.add({
    query: { directory: worktreePath },
    body: { name: 'octob', config: { type: 'remote', url, enabled: true, oauth: false } }
  })
  if (result.error) throw new Error(`OpenCode could not add Octob MCP: ${String(result.error)}`)
  const status = result.data?.octob
  if (status?.status !== 'connected') {
    throw new Error(`OpenCode could not connect Octob MCP: ${status?.error ?? status?.status ?? 'unknown status'}`)
  }
  return true
}
