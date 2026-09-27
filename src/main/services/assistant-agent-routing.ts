import type { AgentSdkId } from './agent-sdk-types'
import { APP_SETTINGS_DB_KEY } from '../../shared/types/settings'

export const DELEGATION_AGENT_SDKS = [
  'opencode', 'claude-code', 'codex', 'mistral-vibe', 'cursor-cli', 'antigravity'
] as const

export type DelegationAgentSdk = typeof DELEGATION_AGENT_SDKS[number]

export function isDelegationAgentSdk(value: unknown): value is DelegationAgentSdk {
  return typeof value === 'string' && (DELEGATION_AGENT_SDKS as readonly string[]).includes(value)
}

export function resolveDelegationAgentSdk(
  settings: { getSetting: (key: string) => string | null },
  requestedAgentSdk?: DelegationAgentSdk
): AgentSdkId {
  if (requestedAgentSdk) return requestedAgentSdk
  try {
    const raw = settings.getSetting(APP_SETTINGS_DB_KEY)
    const value = raw ? (JSON.parse(raw) as Record<string, unknown>).defaultAgentSdk : null
    if (isDelegationAgentSdk(value)) return value
  } catch {
    // Use the stable default below.
  }
  return 'opencode'
}
