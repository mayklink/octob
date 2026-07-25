import type { SubtaskInfo } from '@/lib/opencode-transcript'

export type ToolStatus = 'pending' | 'running' | 'success' | 'error'

export type ToolViewSubtask = SubtaskInfo

export interface ToolViewProps {
  name: string
  input: Record<string, unknown>
  /** May be plain text or structured wire payloads from some backends (e.g. `{ content }`). */
  output?: unknown
  error?: unknown
  status: ToolStatus
  subtasks?: ToolViewSubtask[]
}
