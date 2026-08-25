import type { ConnectionWithMembers } from '../db/types'
import type { DatabaseService } from '../db/database'
import { addConnectionMemberOp, createConnectionOp } from './connection-ops'

export const GLOBAL_ASSISTANT_CONNECTION_SETTING = 'global_assistant_connection_id'

/**
 * The assistant is represented by a regular connection so it can reuse the
 * session/agent lifecycle, while its membership is the complete active
 * workspace rather than a project-specific selection.
 */
export async function ensureGlobalAssistantConnection(
  db: DatabaseService
): Promise<{ success: boolean; connection?: ConnectionWithMembers; error?: string }> {
  const worktrees = db.getAllActiveWorktrees()
  if (worktrees.length === 0) {
    return { success: false, error: 'Add a project before opening the assistant.' }
  }

  const storedId = db.getSetting(GLOBAL_ASSISTANT_CONNECTION_SETTING)
  let connection = storedId ? db.getConnection(storedId) : null

  if (!connection) {
    const created = await createConnectionOp(db, worktrees.map((worktree) => worktree.id))
    if (!created.success || !created.connection) return created
    db.setSetting(GLOBAL_ASSISTANT_CONNECTION_SETTING, created.connection.id)
    db.updateConnection(created.connection.id, { custom_name: 'Octob Assistant', pinned: 1 })
    connection = db.getConnection(created.connection.id)
  } else {
    const memberIds = new Set(connection.members.map((member) => member.worktree_id))
    for (const worktree of worktrees) {
      if (!memberIds.has(worktree.id)) {
        const result = await addConnectionMemberOp(db, connection.id, worktree.id)
        if (!result.success) return { success: false, error: result.error }
      }
    }
    db.updateConnection(connection.id, { custom_name: 'Octob Assistant', pinned: 1 })
    connection = db.getConnection(connection.id)
  }

  return connection
    ? { success: true, connection }
    : { success: false, error: 'Unable to create the assistant connection.' }
}

export function isGlobalAssistantConnection(db: DatabaseService, connectionId: string): boolean {
  return db.getSetting(GLOBAL_ASSISTANT_CONNECTION_SETTING) === connectionId
}
