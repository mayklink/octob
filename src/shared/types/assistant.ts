export interface AssistantTask {
  projectId: string
  projectName: string
  worktreeId: string
  worktreePath: string
  sessionId: string
  title: string
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
