import type { ModelInfo } from '@agentclientprotocol/sdk'

export interface DiscoveredModel {
  id: string
  name: string
  description?: string
  limit: { context: number; output: number }
  variants: Record<string, Record<string, never>>
}

const catalogs = new Map<string, DiscoveredModel[]>()

/** Keep only metadata the model picker understands; ACP model state is experimental. */
export function rememberDiscoveredModels(providerId: string, models: ModelInfo[] | undefined): void {
  if (!models?.length) return
  const seen = new Set<string>()
  const normalized = models
    .filter((model) => typeof model.modelId === 'string' && model.modelId.length > 0)
    .filter((model) => {
      if (seen.has(model.modelId)) return false
      seen.add(model.modelId)
      return true
    })
    .map((model) => ({
      id: model.modelId,
      name: model.name || model.modelId,
      ...(model.description ? { description: model.description } : {}),
      // ACP currently does not standardize context/output limits.
      limit: { context: 0, output: 0 },
      variants: {}
    }))
  if (normalized.length) catalogs.set(providerId, normalized)
}

export function getDiscoveredModels(providerId: string): DiscoveredModel[] | undefined {
  return catalogs.get(providerId)
}

export function toProviderCatalog(providerId: string, name: string, models: DiscoveredModel[]) {
  return [{
    id: providerId,
    name,
    models: Object.fromEntries(models.map((model) => [model.id, model]))
  }]
}
