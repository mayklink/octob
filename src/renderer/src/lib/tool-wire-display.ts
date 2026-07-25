/**
 * Tool wire payloads (Cursor ACP, etc.) may use objects like `{ content: string }` instead of raw strings.
 * Use these helpers before rendering into JSX or measuring string length.
 */
export function wireValueToPrettyString(raw: unknown): string {
  if (raw === null || raw === undefined) return ''
  if (typeof raw === 'string') return raw
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw)
  try {
    return JSON.stringify(raw, null, 2)
  } catch {
    return String(raw)
  }
}

export function truncateText(s: string, maxLen: number): string {
  return s.length > maxLen ? s.slice(0, maxLen) + '...' : s
}
