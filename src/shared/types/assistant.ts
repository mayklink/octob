export type AssistantTaskKind = 'worktree' | 'connection'

export type AssistantTaskState =
  | 'running'
  | 'waiting_input'
  | 'completed'
  | 'error'

export type AssistantTaskWaitingReason =
  | 'plan_review'
  | 'permission'
  | 'question'
  | 'command_approval'

export interface AssistantTaskTarget {
  projectId: string
  projectName: string
  worktreeId: string
  worktreePath: string
}

export interface AssistantTask {
  /** Single worktree job, or a connection joining two or more repositories. */
  kind: AssistantTaskKind
  /** Primary project (first member for connection tasks). */
  projectId: string
  /** Display name — "A + B" for connection tasks. */
  projectName: string
  /** Primary worktree (first member for connection tasks). */
  worktreeId: string
  worktreePath: string
  /** Working directory the delegated agent runs in (worktree or connection dir). */
  workspacePath: string
  connectionId: string | null
  /** Every repository the delegated agent can touch. */
  targets: AssistantTaskTarget[]
  sessionId: string
  title: string
  state: AssistantTaskState
  waitingReason: AssistantTaskWaitingReason | null
  /** Short human-readable detail for the current state, when available. */
  stateDetail: string | null
  createdAt: string
  updatedAt: string
}

export interface AssistantProjectChoice {
  id: string
  name: string
  description: string | null
  language: string | null
}

export interface AssistantProjectSelectionRequest {
  id: string
  question: string
  projects: AssistantProjectChoice[]
}
