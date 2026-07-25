import { randomUUID } from 'node:crypto'

type JsonPart = Record<string, unknown>
type SynthMsg = Record<string, unknown>

function isoNow(): string {
  return new Date().toISOString()
}

/** Append a synthetic user bubble (ACP providers do not echo user prompts over the protocol). */
export function acpTranscriptAppendUserTurn(messages: unknown[], text: string): void {
  const t = text.trim()
  if (!t.length) return
  messages.push({
    id: randomUUID(),
    role: 'user',
    timestamp: isoNow(),
    parts: [{ type: 'text', text }]
  })
}

/** Returns the mutable last assistant row or creates one. */
export function acpTranscriptEnsureAssistantTurn(messages: unknown[]): SynthMsg {
  const last = messages[messages.length - 1] as SynthMsg | undefined
  if (last?.role === 'assistant') return last

  const m: SynthMsg = {
    id: randomUUID(),
    role: 'assistant',
    timestamp: isoNow(),
    parts: []
  }
  messages.push(m)
  return m
}

function assistantParts(messages: unknown[]): JsonPart[] {
  const assistant = acpTranscriptEnsureAssistantTurn(messages)
  const existing = assistant.parts as JsonPart[] | undefined
  if (!Array.isArray(existing)) {
    assistant.parts = []
    return assistant.parts as JsonPart[]
  }
  return existing
}

/**
 * Incoming assistant text deltas (mirrors SSE `agent_message_chunk` mapped in implementers).
 */
export function acpTranscriptAppendAssistantTextChunk(
  messages: unknown[],
  delta: string,
  contentType?: string | null
): void {
  if (!delta.length) return
  if (
    typeof contentType === 'string' &&
    contentType.length > 0 &&
    contentType !== 'text' &&
    contentType !== 'markdown'
  ) {
    return
  }

  const parts = assistantParts(messages)
  const lastPart = parts[parts.length - 1]
  if (lastPart && lastPart.type === 'text') {
    lastPart.text = ((lastPart.text as string) ?? '') + delta
  } else {
    parts.push({ type: 'text', text: delta })
  }
}

/**
 * Reasoning / thought stream (shown as reasoning parts in SessionView).
 */
export function acpTranscriptAppendAssistantReasoningChunk(messages: unknown[], delta: string): void {
  if (!delta.length) return
  const parts = assistantParts(messages)
  const lastPart = parts[parts.length - 1]
  if (lastPart && lastPart.type === 'reasoning') {
    lastPart.text = ((lastPart.text as string) ?? '') + delta
  } else {
    parts.push({ type: 'reasoning', text: delta })
  }
}

function findToolPart(parts: JsonPart[], callId: string): JsonPart | undefined {
  for (const p of parts) {
    if (p.type !== 'tool') continue
    const id =
      typeof p.callID === 'string'
        ? p.callID
        : typeof (p.state as Record<string, unknown> | undefined)?.toolCallId === 'string'
          ? String((p.state as Record<string, unknown>).toolCallId)
          : undefined
    if (id === callId) return p
  }
  return undefined
}

export function acpTranscriptRecordToolCall(
  messages: unknown[],
  toolCallId: string,
  title: string,
  rawInput?: unknown
): void {
  if (!toolCallId) return
  const parts = assistantParts(messages)
  if (findToolPart(parts, toolCallId)) return

  const state: Record<string, unknown> = { status: 'running' }
  if (rawInput !== undefined) {
    state.input = rawInput
  }

  parts.push({
    type: 'tool',
    callID: toolCallId,
    tool: title || 'tool',
    state
  })
}

export function acpTranscriptUpdateToolCall(
  messages: unknown[],
  toolCallId: string,
  title: string,
  terminalStatus: 'completed' | 'failed' | 'running',
  rawOutput?: unknown,
  rawInput?: unknown
): void {
  if (!toolCallId) return
  const parts = assistantParts(messages)
  const existing = findToolPart(parts, toolCallId)
  const statusMap = { completed: 'completed', failed: 'error', running: 'running' } as const
  const stateStatus = statusMap[terminalStatus]

  if (!existing) {
    const state: Record<string, unknown> = { status: stateStatus }
    if (rawInput !== undefined) {
      state.input = rawInput
    }
    if (rawOutput !== undefined) {
      state.output = rawOutput
    }
    parts.push({
      type: 'tool',
      callID: toolCallId,
      tool: title || 'tool',
      state
    })
    return
  }

  existing.tool = title || (existing.tool as string) || 'tool'
  const prevState = (existing.state as Record<string, unknown>) ?? {}
  const next: Record<string, unknown> = { ...prevState, status: stateStatus }
  if (rawInput !== undefined) {
    next.input = rawInput
  }
  if (terminalStatus === 'failed') {
    next.error = rawOutput ?? prevState.error
  } else if (rawOutput !== undefined) {
    next.output = rawOutput
  }
  existing.state = next
}
