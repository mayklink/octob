import type {
  AssistantTask,
  AssistantTaskState,
  AssistantTaskWaitingReason
} from '@shared/types/assistant'
import type { SessionStatusType } from '@/stores/useWorktreeStatusStore'

export interface ResolvedAssistantTaskState {
  state: AssistantTaskState
  waitingReason: AssistantTaskWaitingReason | null
}

/**
 * Map the live renderer session status onto a delegated-task state. Returns
 * null when this renderer has seen no events for the session yet.
 */
function liveStateFromStatus(
  status: SessionStatusType | undefined
): ResolvedAssistantTaskState | null {
  switch (status) {
    case 'plan_ready':
      return { state: 'waiting_input', waitingReason: 'plan_review' }
    case 'permission':
      return { state: 'waiting_input', waitingReason: 'permission' }
    case 'command_approval':
      return { state: 'waiting_input', waitingReason: 'command_approval' }
    case 'answering':
      return { state: 'waiting_input', waitingReason: 'question' }
    case 'working':
    case 'planning':
      return { state: 'running', waitingReason: null }
    case 'completed':
    case 'unread':
      return { state: 'completed', waitingReason: null }
    default:
      return null
  }
}

/**
 * The live renderer status is the freshest signal, but it only exists while
 * this renderer has been running. The state tracked by the main process is the
 * fallback, so a job that finished before a reload still reads as finished.
 */
export function resolveAssistantTaskState(
  task: AssistantTask,
  status: SessionStatusType | undefined
): ResolvedAssistantTaskState {
  return (
    liveStateFromStatus(status) ?? {
      state: task.state,
      waitingReason: task.waitingReason
    }
  )
}

/** Jobs the user has to look at: blocked, finished, or failed. */
export function countAssistantTasksNeedingAttention(
  tasks: AssistantTask[],
  sessionStatuses: Record<string, { status: SessionStatusType } | null>
): number {
  return tasks.filter(
    (task) =>
      resolveAssistantTaskState(task, sessionStatuses[task.sessionId]?.status).state !== 'running'
  ).length
}
