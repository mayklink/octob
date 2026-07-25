export interface AntigravityModelInfo {
  id: string
  name: string
  limit: { context: number; output: number }
}

export const ANTIGRAVITY_DEFAULT_MODEL_ID = 'Gemini 3.5 Flash (High)'

export const ANTIGRAVITY_MODELS: AntigravityModelInfo[] = [
  { id: 'Gemini 3.5 Flash (Low)', name: 'Gemini 3.5 Flash (Low)', limit: { context: 1048576, output: 65536 } },
  { id: 'Gemini 3.5 Flash (Medium)', name: 'Gemini 3.5 Flash (Medium)', limit: { context: 1048576, output: 65536 } },
  { id: 'Gemini 3.5 Flash (High)', name: 'Gemini 3.5 Flash (High)', limit: { context: 1048576, output: 65536 } },
  { id: 'Gemini 3.1 Pro (Low)', name: 'Gemini 3.1 Pro (Low)', limit: { context: 1048576, output: 65536 } },
  { id: 'Gemini 3.1 Pro (High)', name: 'Gemini 3.1 Pro (High)', limit: { context: 1048576, output: 65536 } },
  { id: 'Claude Sonnet 4.6 (Thinking)', name: 'Claude Sonnet 4.6 (Thinking)', limit: { context: 200000, output: 64000 } },
  { id: 'Claude Opus 4.6 (Thinking)', name: 'Claude Opus 4.6 (Thinking)', limit: { context: 200000, output: 64000 } },
  { id: 'GPT-OSS 120B (Medium)', name: 'GPT-OSS 120B (Medium)', limit: { context: 131072, output: 32768 } }
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
