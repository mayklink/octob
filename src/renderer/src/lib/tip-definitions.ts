export type TipTriggerType = 'mount' | 'action'

export interface TipDefinition {
  id: string
  description: string
  trigger: TipTriggerType
  priority: number // Lower = higher priority
  side?: 'top' | 'bottom' | 'left' | 'right'
  align?: 'start' | 'center' | 'end'
}

export const TIP_DEFINITIONS: Record<string, TipDefinition> = {
  'worktree-connect': {
    id: 'worktree-connect',
    description: 'Right-click any workspace to connect it with others for multi-repo sessions.',
    trigger: 'mount',
    priority: 3,
    side: 'right'
  },
  'provider-right-click': {
    id: 'provider-right-click',
    description: 'Click to choose which provider starts the new session.',
    trigger: 'mount',
    priority: 4,
    side: 'bottom',
    align: 'start'
  },
  'settings-default-provider': {
    id: 'settings-default-provider',
    description: 'You can permanently change your default provider from the settings.',
    trigger: 'action',
    priority: 5,
    side: 'bottom',
    align: 'end'
  },
  'super-plan-shortcut': {
    id: 'super-plan-shortcut',
    description: 'Press Shift+Tab to toggle Super Plan mode.',
    trigger: 'action',
    priority: 6,
    side: 'top'
  }
}
