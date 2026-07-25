import type { KanbanTicketColumn } from '../../../main/db/types'
import type { FollowUpTriggerColumn } from '@/stores/useSettingsStore'

export function isBlockerSatisfied(
  blockerColumn: KanbanTicketColumn,
  blockerMode: 'build' | 'plan' | 'super-plan' | null,
  triggerColumn: FollowUpTriggerColumn
): boolean {
  if (triggerColumn === 'review') {
    if (blockerColumn === 'done') return true
    if (blockerColumn === 'review' && blockerMode === 'build') return true
    return false
  }
  return blockerColumn === 'done'
}
