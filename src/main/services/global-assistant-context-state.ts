import { createHash } from 'node:crypto'
import type { DatabaseService } from '../db/database'

const SETTING_KEY_PREFIX = 'global_assistant_context_session_v1:'

/** The Octob session ID survives backend reconnects and backend-specific ID changes. */
export function globalAssistantContextSessionKey(worktreePath: string, octobSessionId: string): string {
  return JSON.stringify([worktreePath, octobSessionId])
}

export function hasGlobalAssistantContext(db: DatabaseService, sessionKey: string): boolean {
  return db.getSetting(settingKey(sessionKey)) === '1'
}

export function markGlobalAssistantContext(db: DatabaseService, sessionKey: string): void {
  db.setSetting(settingKey(sessionKey), '1')
}

function settingKey(sessionKey: string): string {
  const digest = createHash('sha256').update(sessionKey).digest('hex')
  return `${SETTING_KEY_PREFIX}${digest}`
}
