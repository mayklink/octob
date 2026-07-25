import type { SelectedModel } from '@/stores/useSettingsStore'

export type PullRequestReviewAgentSdk = 'opencode' | 'claude-code' | 'codex'

export interface PullRequestReviewRepositorySettings {
  agentSdk: PullRequestReviewAgentSdk
  model: SelectedModel | null
  promptPresetId: string
  automaticReviewEnabled?: boolean
}

const DB_KEY = 'pull_request_review_settings'
const LOCAL_KEY = 'octob-pull-request-review-settings'

export async function loadPullRequestReviewSettings(): Promise<
  Record<string, PullRequestReviewRepositorySettings>
> {
  let result: Record<string, PullRequestReviewRepositorySettings> = {}
  try {
    const local = localStorage.getItem(LOCAL_KEY)
    if (local) result = JSON.parse(local) as Record<string, PullRequestReviewRepositorySettings>
  } catch {
    // Ignore malformed legacy values.
  }

  try {
    const persisted = await window.db.setting.get(DB_KEY)
    if (persisted) {
      result = JSON.parse(persisted) as Record<string, PullRequestReviewRepositorySettings>
      localStorage.setItem(LOCAL_KEY, JSON.stringify(result))
    }
  } catch {
    // Local storage remains the fallback when the database is unavailable.
  }
  return result
}

export async function savePullRequestReviewSettings(
  settings: Record<string, PullRequestReviewRepositorySettings>
): Promise<void> {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(settings))
  await window.db.setting.set(DB_KEY, JSON.stringify(settings))
}
