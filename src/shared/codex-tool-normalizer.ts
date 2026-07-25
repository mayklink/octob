/**
 * Shared normalizer for Codex tool names and command text.
 *
 * Codex uses internal item types (e.g. `commandExecution`, `fileChange`) that
 * differ from the standard tool names the Octob UI expects (`Bash`, `fileChange`,
 * `Read`, etc.). This module provides a canonical mapping so every layer —
 * event mapper, activity mapper, timeline merger, and thread-snapshot parser —
 * produces consistent names that the renderer's ToolCard can match.
 */

import type { CommandAction } from './codex-schemas/v2/CommandAction'

// ── Tool name normalization ──────────────────────────────────────

const CODEX_TOOL_NAME_MAP: Record<string, string> = {
  commandexecution: 'Bash',
  command_execution: 'Bash',
  run_shell: 'Bash',
  filechange: 'fileChange',
  file_change: 'fileChange',
  apply_patch: 'fileChange',
  fileread: 'Read',
  file_read: 'Read',
  dynamictoolcall: 'Tool',
  dynamic_tool_call: 'Tool',
  collabagenttoolcall: 'Task',
  collab_agent_tool_call: 'Task',
  mcptoolcall: 'MCP',
  mcp_tool_call: 'MCP',
  websearch: 'WebSearch',
  web_search: 'WebSearch'
}

/**
 * Normalize a Codex-specific tool/item-type name to the canonical name the
 * Octob UI expects. Unknown names pass through unchanged.
 */
export function normalizeCodexToolName(rawName: string): string {
  const lower = rawName.toLowerCase()
  return CODEX_TOOL_NAME_MAP[lower] ?? rawName
}

// ── Shell prefix stripping ───────────────────────────────────────

/**
 * Regex matching a shell invocation wrapper that Codex prepends to commands.
 *
 * Handles patterns like:
 *   /bin/zsh -lc 'actual command'
 *   /usr/bin/bash -c "actual command"
 *   /bin/sh -lc actual command (unquoted)
 */
const SHELL_PREFIX_QUOTED_RE =
  /^\/(?:bin|usr\/bin)\/(?:zsh|bash|sh)\s+(?:-\w+\s+)+(?:'([\s\S]*)'|"([\s\S]*)")$/

const SHELL_PREFIX_UNQUOTED_RE =
  /^\/(?:bin|usr\/bin)\/(?:zsh|bash|sh)\s+(?:-\w+\s+)+(.+)$/

/**
 * Strip shell invocation prefixes (e.g. `/bin/zsh -lc '...'`) from a command
 * string, returning just the inner command. Non-matching strings pass through.
 */
export function stripShellPrefix(command: string): string {
  const trimmed = command.trim()

  const quotedMatch = SHELL_PREFIX_QUOTED_RE.exec(trimmed)
  if (quotedMatch) {
    return (quotedMatch[1] ?? quotedMatch[2] ?? trimmed).trim()
  }

  const unquotedMatch = SHELL_PREFIX_UNQUOTED_RE.exec(trimmed)
  if (unquotedMatch) {
    return (unquotedMatch[1] ?? trimmed).trim()
  }

  return command
}

// ── Command execution normalization ──────────────────────────────

export interface NormalizedCommandExecutionTool {
  toolName: string
  input: Record<string, unknown>
}

interface ParsedLineRange {
  start: number
  end: number
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function normalizeCommandValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }

  if (!Array.isArray(value)) return null

  const parts = value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0)

  return parts.length > 0 ? parts.join(' ') : null
}

function stripMatchingQuotes(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length < 2) return trimmed

  const first = trimmed[0]
  const last = trimmed[trimmed.length - 1]
  if ((first === "'" || first === '"') && first === last) {
    return trimmed.slice(1, -1)
  }

  return trimmed
}

function parseSedPrintScript(script: string): ParsedLineRange[] | null {
  const clauses = script
    .split(';')
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0)

  if (clauses.length === 0) return null

  const ranges: ParsedLineRange[] = []

  for (const clause of clauses) {
    const rangeMatch = /^(\d+),(\d+)p$/.exec(clause)
    if (rangeMatch) {
      const start = Number.parseInt(rangeMatch[1] ?? '', 10)
      const end = Number.parseInt(rangeMatch[2] ?? '', 10)
      if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end < start) {
        return null
      }
      ranges.push({ start, end })
      continue
    }

    const singleLineMatch = /^(\d+)p$/.exec(clause)
    if (singleLineMatch) {
      const line = Number.parseInt(singleLineMatch[1] ?? '', 10)
      if (!Number.isFinite(line) || line <= 0) return null
      ranges.push({ start: line, end: line })
      continue
    }

    return null
  }

  return ranges
}

function mapCommandActionToTool(action: CommandAction): NormalizedCommandExecutionTool | null {
  switch (action.type) {
    case 'read':
      return {
        toolName: 'Read',
        input: { file_path: action.path }
      }
    case 'listFiles':
      return {
        toolName: 'Glob',
        input: {
          pattern: '*',
          path: action.path ?? '.'
        }
      }
    case 'search':
      return {
        toolName: 'Grep',
        input: {
          pattern: action.query ?? '',
          path: action.path ?? '.'
        }
      }
    default:
      return null
  }
}

function tryParseSedRead(command: string): NormalizedCommandExecutionTool | null {
  const match = /^sed\s+-n\s+(?:(['"])(\d+),(\d+)p\1|(\d+),(\d+)p)\s+(.+)$/.exec(command)
  if (!match) return null

  const startLine = Number.parseInt(match[2] ?? match[4] ?? '', 10)
  const endLine = Number.parseInt(match[3] ?? match[5] ?? '', 10)
  const rawPath = stripMatchingQuotes(match[6] ?? '')
  if (!Number.isFinite(startLine) || !Number.isFinite(endLine) || !rawPath) return null
  if (startLine <= 0 || endLine < startLine) return null

  const input: Record<string, unknown> = { file_path: rawPath }
  if (endLine > startLine) {
    input.offset = startLine
    // ReadToolView currently renders the range as offset + limit.
    input.limit = endLine - startLine
  }

  return {
    toolName: 'Read',
    input
  }
}

function tryParseNumberedRead(command: string): NormalizedCommandExecutionTool | null {
  const match =
    /^nl\s+-ba\s+(.+?)\s*\|\s*sed\s+-n\s+(?:(['"])([\s\S]*?)\2|([^'"\s][\s\S]*))$/.exec(command)
  if (!match) return null

  const rawPath = stripMatchingQuotes(match[1] ?? '')
  const rawScript = stripMatchingQuotes(match[3] ?? match[4] ?? '')
  const lineRanges = parseSedPrintScript(rawScript)
  if (!rawPath || !lineRanges) return null

  return {
    toolName: 'Read',
    input: {
      file_path: rawPath,
      line_ranges: lineRanges
    }
  }
}

function tryParseRgFiles(command: string): NormalizedCommandExecutionTool | null {
  const match = /^rg\s+--files(?:\s+(.+))?$/.exec(command)
  if (!match) return null

  const path = stripMatchingQuotes(match[1] ?? '.')

  return {
    toolName: 'Glob',
    input: {
      pattern: '*',
      path: path || '.'
    }
  }
}

function extractNormalizedCommand(
  command: unknown,
  inputRecord: Record<string, unknown>
): string | null {
  const rawCommand =
    normalizeCommandValue(command) ??
    normalizeCommandValue(inputRecord.command) ??
    normalizeCommandValue(inputRecord.cmd) ??
    normalizeCommandValue(inputRecord.argv)

  return rawCommand ? stripShellPrefix(rawCommand) : null
}

export function normalizeCommandExecutionTool(options: {
  command?: unknown
  input?: unknown
  commandActions?: CommandAction[] | null
}): NormalizedCommandExecutionTool {
  const inputRecord = asRecord(options.input) ?? {}
  const command = extractNormalizedCommand(options.command, inputRecord)
  const parsedTool = command
    ? tryParseNumberedRead(command) ?? tryParseSedRead(command) ?? tryParseRgFiles(command)
    : null
  const actions = Array.isArray(options.commandActions)
    ? options.commandActions
        .map(mapCommandActionToTool)
        .filter((tool): tool is NormalizedCommandExecutionTool => tool !== null)
    : []

  if (actions.length === 1 && options.commandActions?.length === 1) {
    const enrichedInput =
      parsedTool?.toolName === actions[0].toolName
        ? { ...actions[0].input, ...parsedTool.input }
        : actions[0].input
    return {
      toolName: actions[0].toolName,
      input: { ...inputRecord, ...enrichedInput }
    }
  }

  if (parsedTool) {
    return {
      toolName: parsedTool.toolName,
      input: { ...inputRecord, ...parsedTool.input }
    }
  }

  return {
    toolName: 'Bash',
    input: {
      ...inputRecord,
      ...(command ? { command } : {})
    }
  }
}
