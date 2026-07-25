import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { UsageData, UsageResult } from '@shared/types/usage'

const CACHE_PATH = join(homedir(), '.gemini', 'antigravity-cli', 'octob-usage.json')
let latestUsage: UsageData | null = null

interface QuotaWindow {
  remaining_fraction?: number
  reset_time?: string
}

function findQuota(value: unknown, depth = 0): Record<string, QuotaWindow> | null {
  if (!value || typeof value !== 'object' || depth > 5) return null
  const record = value as Record<string, unknown>
  if (record.quota && typeof record.quota === 'object') {
    return record.quota as Record<string, QuotaWindow>
  }
  for (const child of Object.values(record)) {
    const found = findQuota(child, depth + 1)
    if (found) return found
  }
  return null
}

function toUsageWindow(window: QuotaWindow | undefined): { utilization: number; resets_at: string } {
  const remaining = typeof window?.remaining_fraction === 'number' ? window.remaining_fraction : 1
  return {
    utilization: Math.max(0, Math.min(100, (1 - remaining) * 100)),
    resets_at: typeof window?.reset_time === 'string' ? window.reset_time : ''
  }
}

/** Capture quota state when AGY includes its status payload in a trajectory event. */
export function captureAntigravityUsagePayload(value: unknown): void {
  const quota = findQuota(value)
  if (!quota) return
  const isClaude = quota['3p-5h'] || quota['3p-weekly']
  const fiveHour = isClaude ? quota['3p-5h'] : quota['gemini-5h']
  const weekly = isClaude ? quota['3p-weekly'] : quota['gemini-weekly']
  if (!fiveHour && !weekly) return
  latestUsage = {
    five_hour: toUsageWindow(fiveHour),
    seven_day: toUsageWindow(weekly)
  }
  void writeFile(CACHE_PATH, JSON.stringify(latestUsage), 'utf-8').catch(() => {})
}

export async function fetchAntigravityUsage(): Promise<UsageResult> {
  if (latestUsage) return { success: true, data: latestUsage }
  if (existsSync(CACHE_PATH)) {
    try {
      const parsed = JSON.parse(await readFile(CACHE_PATH, 'utf-8')) as UsageData
      if (parsed?.five_hour && parsed?.seven_day) {
        latestUsage = parsed
        return { success: true, data: parsed }
      }
    } catch { /* stale or malformed cache */ }
  }
  return {
    success: false,
    error: 'Antigravity usage becomes available after AGY publishes quota state for a session.'
  }
}
