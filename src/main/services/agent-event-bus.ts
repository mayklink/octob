import { EventEmitter } from 'events'

export interface AgentStreamEvent {
  type: string
  sessionId: string
  data?: unknown
  statusPayload?: { type?: string }
}

const emitter = new EventEmitter()
emitter.setMaxListeners(50)

export function emitAgentStreamEvent(event: AgentStreamEvent): void {
  emitter.emit('stream', event)
}

export function onAgentStreamEvent(listener: (event: AgentStreamEvent) => void): () => void {
  emitter.on('stream', listener)
  return () => emitter.off('stream', listener)
}
