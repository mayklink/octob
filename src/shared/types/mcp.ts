export type McpTransport = 'stdio' | 'http' | 'sse'

export interface McpKeyValue {
  name: string
  value: string
}

export interface McpServerConfig {
  id: string
  enabled: boolean
  name: string
  transport: McpTransport
  command: string
  args: string
  env: McpKeyValue[]
  url: string
  headers: McpKeyValue[]
}
