export interface AssistantSkillSummary {
  id: string
  name: string
  description: string
  scope: 'global' | 'project' | 'builtin'
  projectId?: string
}

export interface AssistantSkillList {
  skills: AssistantSkillSummary[]
  errors: Array<{ path: string; error: string }>
}

export interface CreateAssistantSkillInput {
  name: string
  description: string
  instructions: string
  projectId?: string
}
