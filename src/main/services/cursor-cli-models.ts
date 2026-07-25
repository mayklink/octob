/**
 * Cursor CLI (`agent`) model catalog for Octob's ModelSelector and
 * {@link unstable_setSessionModel}.
 *
 * Curated static catalog (same strategy as {@link codex-models} / Claude Code):
 * authoritative list shipped with Octob with indicative limits for the context badge.
 */

export interface CursorCliModelRow {
  id: string
  name: string
  limit: { context: number; output: number }
}

/** Canonical default aligned with Cursor CLI `/model auto`. */
export const CURSOR_CLI_DEFAULT_MODEL_ID = 'auto'

/** Same variant map shape as Codex models for renderer parity (effort tiers are placeholders). */
const CURSOR_CLI_VARIANTS: Record<string, Record<string, never>> = {
  xhigh: {},
  high: {},
  medium: {},
  low: {}
}

/**
 * Curated list (CLI UI + Cursor docs slash-command examples).
 * Limits are indicative for the context badge; authoritative windows come from Cursor.
 */
export const CURSOR_CLI_STATIC_MODEL_ROWS: CursorCliModelRow[] = [
  {
    id: 'auto',
    name: 'Auto',
    limit: { context: 512_000, output: 128_000 }
  },
  {
    id: 'composer-2',
    name: 'Composer 2',
    limit: { context: 256_000, output: 64_000 }
  },
  {
    id: 'composer-1.5',
    name: 'Composer 1.5',
    limit: { context: 256_000, output: 64_000 }
  },
  {
    id: 'codex-5.3',
    name: 'Codex 5.3',
    limit: { context: 272_000, output: 128_000 }
  },
  {
    id: 'gpt-5.5',
    name: 'GPT-5.5',
    limit: { context: 272_000, output: 128_000 }
  },
  {
    id: 'gpt-5.4',
    name: 'GPT-5.4',
    limit: { context: 272_000, output: 128_000 }
  },
  {
    id: 'gpt-5.3',
    name: 'GPT-5.3',
    limit: { context: 272_000, output: 128_000 }
  },
  {
    id: 'gpt-5.2',
    name: 'GPT-5.2',
    limit: { context: 272_000, output: 128_000 }
  },
  {
    id: 'sonnet-4.6-thinking',
    name: 'Sonnet 4.6 (thinking)',
    limit: { context: 200_000, output: 64_000 }
  },
  {
    id: 'sonnet-4.5-thinking',
    name: 'Sonnet 4.5 (thinking)',
    limit: { context: 200_000, output: 64_000 }
  },
  {
    id: 'opus-4.7-thinking',
    name: 'Opus 4.7 (thinking)',
    limit: { context: 300_000, output: 96_000 }
  },
  {
    id: 'opus-4.6-thinking',
    name: 'Opus 4.6 (thinking)',
    limit: { context: 200_000, output: 96_000 }
  },
  {
    id: 'opus-4.5-thinking',
    name: 'Opus 4.5 (thinking)',
    limit: { context: 200_000, output: 96_000 }
  },
  {
    id: 'haiku-4.5-thinking',
    name: 'Haiku 4.5 (thinking)',
    limit: { context: 200_000, output: 32_000 }
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    limit: { context: 1_000_000, output: 64_000 }
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    limit: { context: 1_000_000, output: 64_000 }
  },
  {
    id: 'grok-4',
    name: 'Grok 4',
    limit: { context: 128_000, output: 32_000 }
  }
]

/** @deprecated Prefer {@link CURSOR_CLI_STATIC_MODEL_ROWS}. */
export const CURSOR_CLI_MODELS = CURSOR_CLI_STATIC_MODEL_ROWS

/** Map legacy Octob placeholder slug to Cursor's live default id. */
export function normalizeCursorCliModelIdentity(modelId: string | null | undefined): string | null {
  const t = modelId?.trim()
  if (!t) return null
  return t === 'cursor-default' ? CURSOR_CLI_DEFAULT_MODEL_ID : t
}

function dedupePreserveOrder(rows: CursorCliModelRow[]): CursorCliModelRow[] {
  const seen = new Set<string>()
  const out: CursorCliModelRow[] = []
  for (const r of rows) {
    if (seen.has(r.id)) continue
    seen.add(r.id)
    out.push(r)
  }
  return out
}

function sortModelsForUi(rows: CursorCliModelRow[]): CursorCliModelRow[] {
  return [...rows].sort((a, b) => {
    if (a.id === 'auto') return -1
    if (b.id === 'auto') return 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
}

/**
 * Resolved rows for selectors (static catalog).
 * `agentBinaryPath` is retained for signature compatibility but ignored.
 */
export function resolveCursorCliModelRows(_agentBinaryPath: string | null): CursorCliModelRow[] {
  return sortModelsForUi(dedupePreserveOrder([...CURSOR_CLI_STATIC_MODEL_ROWS]))
}

export function invalidateCursorCliModelResolutionCache(): void {
  // No-op — catalog is fully static (same strategy as Codex models).
}

/**
 * Returns Cursor CLI models in the format expected by the renderer.
 * Shape matches {@link getAvailableCodexModels} / ClaudeCodeImplementer.getAvailableModels().
 */
export function getAvailableCursorCliModels(): Array<{
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
  const models: Record<
    string,
    {
      id: string
      name: string
      limit: { context: number; output: number }
      variants: Record<string, Record<string, never>>
    }
  > = {}
  for (const row of resolveCursorCliModelRows(null)) {
    models[row.id] = {
      id: row.id,
      name: row.name,
      limit: { context: row.limit.context, output: row.limit.output },
      variants: CURSOR_CLI_VARIANTS
    }
  }
  return [
    {
      id: 'cursor-cli',
      name: 'Cursor CLI',
      models
    }
  ]
}

export function getCursorCliModelInfo(
  modelId: string | null | undefined,
  _agentBinaryPath: string | null = null
): CursorCliModelRow | null {
  const id = normalizeCursorCliModelIdentity(modelId)
  if (!id) return null
  const row = resolveCursorCliModelRows(null).find((m) => m.id === id)
  return row ?? null
}
