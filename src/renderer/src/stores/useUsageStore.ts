import { create } from 'zustand'
import type {
  DisplayUsageData,
  DisplayUsageWindow,
  UsageData,
  OpenAIUsageData,
  UsageProvider
} from '@shared/types/usage'

export type { UsageData, UsageProvider }

interface UsageState {
  anthropicUsage: UsageData | null
  anthropicLastFetchedAt: number | null
  anthropicIsLoading: boolean

  openaiUsage: OpenAIUsageData | null
  openaiLastFetchedAt: number | null
  openaiIsLoading: boolean

  googleUsage: UsageData | null
  googleLastFetchedAt: number | null
  googleIsLoading: boolean

  activeProvider: UsageProvider

  fetchUsageForProvider: (provider: UsageProvider) => Promise<void>
  forceRefreshProvider: (provider: UsageProvider) => Promise<void>
  setActiveProvider: (provider: UsageProvider) => void
  fetchUsage: () => Promise<void>
}

const DEBOUNCE_MS = 180_000 // 3 minutes

export const useUsageStore = create<UsageState>()((set, get) => ({
  anthropicUsage: null,
  anthropicLastFetchedAt: null,
  anthropicIsLoading: false,

  openaiUsage: null,
  openaiLastFetchedAt: null,
  openaiIsLoading: false,

  googleUsage: null,
  googleLastFetchedAt: null,
  googleIsLoading: false,

  activeProvider: 'anthropic',

  fetchUsageForProvider: async (provider: UsageProvider) => {
    const state = get()

    if (provider === 'none') return

    if (provider === 'anthropic') {
      if (state.anthropicIsLoading) return
      if (state.anthropicLastFetchedAt && Date.now() - state.anthropicLastFetchedAt < DEBOUNCE_MS)
        return

      set({ anthropicIsLoading: true })
      try {
        const result = await window.usageOps.fetch()
        if (result.success) {
          set({ anthropicUsage: result.data ?? null })
        }
      } finally {
        set({ anthropicIsLoading: false, anthropicLastFetchedAt: Date.now() })
      }
    } else if (provider === 'openai') {
      if (state.openaiIsLoading) return
      if (state.openaiLastFetchedAt && Date.now() - state.openaiLastFetchedAt < DEBOUNCE_MS) return

      set({ openaiIsLoading: true })
      try {
        const result = await window.usageOps.fetchOpenai()
        if (result.success) {
          set({ openaiUsage: result.data ?? null })
        }
      } finally {
        set({ openaiIsLoading: false, openaiLastFetchedAt: Date.now() })
      }
    } else {
      if (state.googleIsLoading) return
      if (state.googleLastFetchedAt && Date.now() - state.googleLastFetchedAt < DEBOUNCE_MS) return
      set({ googleIsLoading: true })
      try {
        const result = await window.usageOps.fetchAntigravity()
        if (result.success) set({ googleUsage: result.data ?? null })
      } finally {
        set({ googleIsLoading: false, googleLastFetchedAt: Date.now() })
      }
    }
  },

  forceRefreshProvider: async (provider: UsageProvider) => {
    const state = get()

    if (provider === 'none') return

    if (provider === 'anthropic') {
      if (state.anthropicIsLoading) return

      set({ anthropicIsLoading: true })
      try {
        const result = await window.usageOps.fetch()
        if (result.success) {
          set({ anthropicUsage: result.data ?? null })
        }
      } finally {
        set({ anthropicIsLoading: false, anthropicLastFetchedAt: Date.now() })
      }
    } else if (provider === 'openai') {
      if (state.openaiIsLoading) return

      set({ openaiIsLoading: true })
      try {
        const result = await window.usageOps.fetchOpenai()
        if (result.success) {
          set({ openaiUsage: result.data ?? null })
        }
      } finally {
        set({ openaiIsLoading: false, openaiLastFetchedAt: Date.now() })
      }
    } else {
      if (state.googleIsLoading) return
      set({ googleIsLoading: true })
      try {
        const result = await window.usageOps.fetchAntigravity()
        if (result.success) set({ googleUsage: result.data ?? null })
      } finally {
        set({ googleIsLoading: false, googleLastFetchedAt: Date.now() })
      }
    }
  },

  setActiveProvider: (provider: UsageProvider) => {
    set({ activeProvider: provider })

    if (provider === 'none') return

    const state = get()
    const lastFetched = provider === 'anthropic'
      ? state.anthropicLastFetchedAt
      : provider === 'openai'
        ? state.openaiLastFetchedAt
        : state.googleLastFetchedAt
    const isStale = !lastFetched || Date.now() - lastFetched >= DEBOUNCE_MS

    if (isStale) {
      state.fetchUsageForProvider(provider).catch(() => {})
    }
  },

  fetchUsage: async () => {
    const { activeProvider, fetchUsageForProvider } = get()
    await fetchUsageForProvider(activeProvider)
  }
}))

// --- Exported helpers ---

interface SessionLike {
  agent_sdk?: string | null
  model_provider_id?: string | null
  model_id?: string | null
}

export function resolveUsageProvider(session: SessionLike): UsageProvider {
  if (session.agent_sdk === 'terminal') return 'none'
  if (session.agent_sdk === 'mistral-vibe') return 'none'
  if (session.agent_sdk === 'cursor-cli') return 'none'
  if (session.agent_sdk === 'antigravity') return 'google'
  if (session.agent_sdk === 'claude-code') return 'anthropic'
  if (session.model_provider_id === 'openai') return 'openai'
  if (session.model_id?.startsWith('gpt')) return 'openai'
  return 'anthropic'
}

export function resolveDefaultUsageProvider(
  agentSdk:
    | 'opencode'
    | 'claude-code'
    | 'codex'
    | 'mistral-vibe'
    | 'cursor-cli'
    | 'antigravity'
    | 'terminal'
): UsageProvider {
  if (agentSdk === 'codex') return 'openai'
  if (agentSdk === 'antigravity') return 'google'
  if (agentSdk === 'mistral-vibe' || agentSdk === 'terminal' || agentSdk === 'cursor-cli')
    return 'none'
  return 'anthropic'
}

function hasUsageWindow(value: unknown): value is { utilization: number; resets_at: string } {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.utilization === 'number' && typeof record.resets_at === 'string'
}

function isAnthropicUsageData(value: unknown): value is UsageData {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return hasUsageWindow(record.five_hour) && hasUsageWindow(record.seven_day)
}

export function normalizeUsage(
  provider: UsageProvider,
  anthropicUsage: UsageData | null | undefined,
  openaiUsage: OpenAIUsageData | null | undefined,
  googleUsage?: UsageData | null
): DisplayUsageData | null {
  if (provider === 'none') return null

  if (provider === 'anthropic') {
    return isAnthropicUsageData(anthropicUsage)
      ? { windows: legacyUsageWindows(anthropicUsage), extra_usage: anthropicUsage.extra_usage }
      : null
  }

  if (provider === 'google') {
    return isAnthropicUsageData(googleUsage) ? { windows: legacyUsageWindows(googleUsage) } : null
  }

  if (!openaiUsage) return null

  const rateLimit = openaiUsage.rate_limit
  const primary = rateLimit?.primary_window
  const secondary = rateLimit?.secondary_window

  const windows: DisplayUsageWindow[] = []
  if (primary) windows.push(openAIUsageWindow('primary', primary))
  if (secondary) windows.push(openAIUsageWindow('secondary', secondary))
  return windows.length > 0 ? { windows } : null
}

function formatWindowLabel(seconds: number): string {
  if (seconds > 0 && seconds % 604800 === 0) return `${seconds / 604800}w`
  if (seconds > 0 && seconds % 86400 === 0) return `${seconds / 86400}d`
  if (seconds > 0 && seconds % 3600 === 0) return `${seconds / 3600}h`
  return 'Usage'
}

function openAIUsageWindow(
  id: string,
  window: NonNullable<OpenAIUsageData['rate_limit']['primary_window']>
): DisplayUsageWindow {
  return {
    id,
    label: formatWindowLabel(window.limit_window_seconds),
    utilization: window.used_percent,
    resets_at: new Date(window.reset_at * 1000).toISOString(),
    window_seconds: window.limit_window_seconds
  }
}

function legacyUsageWindows(usage: UsageData): DisplayUsageWindow[] {
  return [
    { id: 'five_hour', label: '5h', window_seconds: 18000, ...usage.five_hour },
    { id: 'seven_day', label: '7d', window_seconds: 604800, ...usage.seven_day }
  ]
}
