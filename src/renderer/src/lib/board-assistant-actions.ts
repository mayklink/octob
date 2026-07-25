import type { KanbanTicketColumn } from '../../../main/db/types'

export const BOARD_ACTION_BLOCK_CAPTURE_RE = /```board-ticket-actions\s*([\s\S]*?)```/i
export const BOARD_ACTION_BLOCK_RE = /```board-ticket-actions[\s\S]*?```/gi

export type BoardTicketActionType = 'create' | 'update' | 'move' | 'archive'

export interface ParsedBoardTicketAction {
  id: string
  actionKey: string
  type: BoardTicketActionType
  ticketId: string | null
  projectId: string | null
  title?: string
  description?: string | null
  column?: KanbanTicketColumn
  mode?: 'build' | 'plan' | 'super-plan' | null
  dependsOnTicketIds: string[]
  reason: string | null
  selected: boolean
  appliedAt: string | null
  validationIssues: string[]
}

export interface ParsedBoardTicketActionSet {
  actions: ParsedBoardTicketAction[]
  hasValidationErrors: boolean
}

const VALID_ACTION_TYPES = new Set<BoardTicketActionType>(['create', 'update', 'move', 'archive'])
const VALID_COLUMNS = new Set<KanbanTicketColumn>(['todo', 'in_progress', 'review', 'done'])
const VALID_MODES = new Set(['build', 'plan', 'super-plan'])

function normalizeActionKey(index: number, value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : `action-${index + 1}`
}

function normalizeNullableString(value: unknown): string | null | undefined {
  if (value === null) return null
  if (typeof value !== 'string') return undefined
  return value.trim() ? value.trim() : null
}

function normalizeRequiredString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

export function parseBoardTicketActionSet(content: string): ParsedBoardTicketActionSet | null {
  const match = content.match(BOARD_ACTION_BLOCK_CAPTURE_RE)
  if (!match?.[1]) return null

  try {
    const parsed = JSON.parse(match[1]) as { actions?: unknown[] }
    if (!Array.isArray(parsed.actions)) return null

    const seenKeys = new Set<string>()
    const actions = parsed.actions
      .map((item, index): ParsedBoardTicketAction | null => {
        if (!item || typeof item !== 'object') return null

        const record = item as Record<string, unknown>
        const type = typeof record.type === 'string' ? record.type : ''
        if (!VALID_ACTION_TYPES.has(type as BoardTicketActionType)) return null

        const actionKey = normalizeActionKey(index, record.actionKey)
        const validationIssues: string[] = []
        const ticketId = normalizeNullableString(record.ticketId) ?? null
        const projectId = normalizeNullableString(record.projectId) ?? null
        const title = normalizeRequiredString(record.title)
        const description = normalizeNullableString(record.description)
        const rawColumn = normalizeNullableString(record.column)
        const rawMode = normalizeNullableString(record.mode)
        const column = rawColumn && VALID_COLUMNS.has(rawColumn as KanbanTicketColumn)
          ? rawColumn as KanbanTicketColumn
          : undefined
        const mode = rawMode && VALID_MODES.has(rawMode)
          ? rawMode as 'build' | 'plan' | 'super-plan'
          : rawMode === null
            ? null
            : undefined

        if (seenKeys.has(actionKey)) {
          validationIssues.push(`Duplicate actionKey "${actionKey}".`)
        }
        seenKeys.add(actionKey)

        if (record.title !== undefined && !title) {
          validationIssues.push('Title must be a non-empty string.')
        }
        if (type === 'create' && !projectId) {
          validationIssues.push('Create action is missing projectId.')
        }
        if (type === 'create' && !title) {
          validationIssues.push('Create action is missing title.')
        }
        if (type !== 'create' && !ticketId) {
          validationIssues.push(`${type} action is missing ticketId.`)
        }
        if (record.column !== undefined && !column) {
          validationIssues.push('Column must be todo, in_progress, review, or done.')
        }
        if (record.mode !== undefined && mode === undefined) {
          validationIssues.push('Mode must be build, plan, super-plan, or null.')
        }
        if (type === 'move' && !column) {
          validationIssues.push('Move action is missing column.')
        }
        if (type === 'update' && title === undefined && description === undefined && mode === undefined) {
          validationIssues.push('Update action must change title, description, or mode.')
        }

        const dependsOnTicketIds = Array.isArray(record.dependsOnTicketIds)
          ? Array.from(
              new Set(
                record.dependsOnTicketIds
                  .filter((id): id is string => typeof id === 'string')
                  .map((id) => id.trim())
                  .filter(Boolean)
              )
            )
          : []

        return {
          id: actionKey,
          actionKey,
          type: type as BoardTicketActionType,
          ticketId,
          projectId,
          ...(title !== undefined ? { title } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(column ? { column } : {}),
          ...(mode !== undefined ? { mode } : {}),
          dependsOnTicketIds,
          reason: normalizeNullableString(record.reason) ?? null,
          selected: true,
          appliedAt: null,
          validationIssues
        }
      })
      .filter((action): action is ParsedBoardTicketAction => action !== null)

    return {
      actions,
      hasValidationErrors: actions.some((action) => action.validationIssues.length > 0)
    }
  } catch {
    return null
  }
}
