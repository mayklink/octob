/**
 * Mistral Vibe resolves models primarily via ~/.vibe/config.toml.
 *
 * IDs here are forwarded to {@link unstable_setSessionModel} when supported by vibe-acp;
 * callers should treat unknown slugs gracefully.
 */

export interface MistralVibeModelInfo {
  id: string
  name: string
  limit: { context: number; output: number }
}

/** Same variant map shape as Codex models for renderer parity (effort tiers are placeholders). */
const MISTRAL_VIBE_VARIANTS: Record<string, Record<string, never>> = {
  xhigh: {},
  high: {},
  medium: {},
  low: {}
}

export const MISTRAL_VIBE_DEFAULT_MODEL_ID = 'devstral-medium-latest'

export const MISTRAL_VIBE_MODELS: MistralVibeModelInfo[] = [
  {
    id: 'mistral-medium-3.5',
    name: 'Mistral Medium 3.5',
    limit: { context: 262144, output: 65536 }
  },
  {
    id: 'devstral-small',
    name: 'Devstral Small',
    limit: { context: 262144, output: 65536 }
  },
  {
    id: 'local',
    name: 'Local',
    limit: { context: 131072, output: 8192 }
  },
  {
    id: 'devstral-medium-latest',
    name: 'Devstral Medium (latest)',
    limit: { context: 262144, output: 65536 }
  },
  {
    id: 'devstral-small-latest',
    name: 'Devstral Small (latest)',
    limit: { context: 262144, output: 65536 }
  },
  {
    id: 'mistral-large-latest',
    name: 'Mistral Large (latest)',
    limit: { context: 131072, output: 8192 }
  }
]

/**
 * Returns Mistral Vibe models in the format expected by the renderer.
 * Shape matches {@link getAvailableCodexModels} / ClaudeCodeImplementer.getAvailableModels().
 */
export function getAvailableMistralVibeModels(): Array<{
  id: string
  name: string
  models: Record<
    string,
    {
      id: string
      name: string
      limit: { context: number; output: number }
      variants: Record<string, Record<string, never>>
    }
  >
}> {
  return [
    {
      id: 'mistral-vibe',
      name: 'Mistral Vibe',
      models: Object.fromEntries(
        MISTRAL_VIBE_MODELS.map((m) => [
          m.id,
          {
            id: m.id,
            name: m.name,
            limit: { context: m.limit.context, output: m.limit.output },
            variants: MISTRAL_VIBE_VARIANTS
          }
        ])
      )
    }
  ]
}

export function getMistralVibeModelInfo(
  modelId: string | null | undefined
): MistralVibeModelInfo | null {
  const id = modelId?.trim()
  if (!id) return null
  const row = MISTRAL_VIBE_MODELS.find((m) => m.id === id)
  return row ?? null
}
