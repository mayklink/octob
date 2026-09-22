export const OCTOB_RUNTIME_PROTOCOL_VERSION = 1 as const

export type OctobRuntimeKind = 'local' | 'cloud'

export interface RuntimeHealth {
  status: 'ok'
  runtime: OctobRuntimeKind
  protocolVersion: typeof OCTOB_RUNTIME_PROTOCOL_VERSION
  pid: number
  platform: string
  uptimeSeconds: number
}

export interface RuntimeCapabilities {
  runtime: OctobRuntimeKind
  protocolVersion: typeof OCTOB_RUNTIME_PROTOCOL_VERSION
  transport: {
    http: boolean
    websocket: boolean
  }
  features: {
    database: boolean
    filesystem: boolean
    git: boolean
    worktrees: boolean
    terminal: boolean
    agents: boolean
    mcp: boolean
  }
}
