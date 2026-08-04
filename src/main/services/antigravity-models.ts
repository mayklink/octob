export interface AntigravityModelInfo {
  id: string
  name: string
  limit: { context: number; output: number }
}

export const ANTIGRAVITY_DEFAULT_MODEL_ID = 'gemini-3.6-flash-high'

export const ANTIGRAVITY_MODELS: AntigravityModelInfo[] = [
  { id: 'gemini-3.6-flash-high', name: 'Gemini 3.6 Flash (High)', limit: { context: 1048576, output: 65536 } },
  { id: 'gemini-3.6-flash-medium', name: 'Gemini 3.6 Flash (Medium)', limit: { context: 1048576, output: 65536 } },
  { id: 'gemini-3.6-flash-low', name: 'Gemini 3.6 Flash (Low)', limit: { context: 1048576, output: 65536 } },
  { id: 'gemini-3.5-flash-high', name: 'Gemini 3.5 Flash (High)', limit: { context: 1048576, output: 65536 } },
  { id: 'gemini-3.5-flash-medium', name: 'Gemini 3.5 Flash (Medium)', limit: { context: 1048576, output: 65536 } },
  { id: 'gemini-3.5-flash-low', name: 'Gemini 3.5 Flash (Low)', limit: { context: 1048576, output: 65536 } },
  { id: 'gemini-3.1-pro-high', name: 'Gemini 3.1 Pro (High)', limit: { context: 1048576, output: 65536 } },
  { id: 'gemini-3.1-pro-low', name: 'Gemini 3.1 Pro (Low)', limit: { context: 1048576, output: 65536 } },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', limit: { context: 200000, output: 64000 } },
  { id: 'claude-opus-4-6-thinking', name: 'Claude Opus 4.6 (Thinking)', limit: { context: 200000, output: 64000 } },
  { id: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B (Medium)', limit: { context: 131072, output: 32768 } }
]

export function getAvailableAntigravityModels(): unknown[] {
  return [{
    id: 'antigravity',
    name: 'Google Antigravity',
    models: Object.fromEntries(ANTIGRAVITY_MODELS.map((model) => [model.id, {
      ...model,
      variants: {}
    }]))
  }]
}

export function getAntigravityModelInfo(modelId: string): AntigravityModelInfo | null {
  return ANTIGRAVITY_MODELS.find((model) => model.id === modelId) ?? null
}
