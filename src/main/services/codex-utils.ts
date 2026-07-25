// ── Shared type-narrowing helpers for Codex JSON-RPC payloads ────

export function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  return value as Record<string, unknown>
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

export function toJsonSnapshot(value: unknown, maxLength: number): string {
  let snapshot: string

  if (value === undefined) {
    snapshot = 'undefined'
  } else {
    try {
      snapshot = JSON.stringify(value) ?? String(value)
    } catch {
      snapshot = String(value)
    }
  }

  return snapshot.length > maxLength ? snapshot.slice(0, maxLength) : snapshot
}
