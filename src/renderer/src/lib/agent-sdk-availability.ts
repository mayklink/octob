export interface AvailableAgentSdks {
  opencode: boolean
  claude: boolean
  codex: boolean
  mistralVibe: boolean
  cursorCli: boolean
  antigravity: boolean
  antigravityVersion?: string | null
}

export type SelectableAgentSdk =
  | 'opencode'
  | 'claude-code'
  | 'codex'
  | 'mistral-vibe'
  | 'cursor-cli'
  | 'antigravity'
  | 'terminal'

function getAgentSdkLabel(sdk: Exclude<SelectableAgentSdk, 'terminal'>): string {
  switch (sdk) {
    case 'opencode':
      return 'OpenCode'
    case 'claude-code':
      return 'Claude Code'
    case 'codex':
      return 'Codex'
    case 'mistral-vibe':
      return 'Mistral Vibe'
    case 'cursor-cli':
      return 'Cursor CLI'
    case 'antigravity':
      return 'Google Antigravity'
  }
}

export function isAgentSdkAvailable(
  sdk: SelectableAgentSdk,
  availableAgentSdks?: AvailableAgentSdks | null
): boolean {
  if (sdk === 'terminal' || !availableAgentSdks) return true

  switch (sdk) {
    case 'opencode':
      return availableAgentSdks.opencode
    case 'claude-code':
      return availableAgentSdks.claude
    case 'codex':
      return availableAgentSdks.codex
    case 'mistral-vibe':
      return availableAgentSdks.mistralVibe
    case 'cursor-cli':
      return availableAgentSdks.cursorCli
    case 'antigravity':
      return availableAgentSdks.antigravity
    case 'terminal':
      return true
  }
}

export function getUnavailableAgentSdkMessage(
  sdk: SelectableAgentSdk,
  availableAgentSdks?: AvailableAgentSdks | null
): string | null {
  if (sdk === 'terminal' || !availableAgentSdks || isAgentSdkAvailable(sdk, availableAgentSdks)) {
    return null
  }

  return `${getAgentSdkLabel(sdk)} is not available on this system. Install it and restart Octob, or choose another provider.`
}
