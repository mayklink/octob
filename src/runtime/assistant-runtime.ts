import type { AssistantWindowLike } from '../main/services/assistant-mcp-service'

export interface RuntimeAssistantEvent {
  channel: string
  args: unknown[]
}

class RuntimeAssistantWindow implements AssistantWindowLike {
  private destroyed = false
  private readonly listeners = new Set<(event: RuntimeAssistantEvent) => void>()

  readonly webContents = {
    send: (channel: string, ...args: unknown[]): void => {
      if (this.destroyed) return
      const event: RuntimeAssistantEvent = { channel, args }
      for (const listener of this.listeners) {
        try {
          listener(event)
        } catch {
          // A broken browser stream must not break assistant execution.
        }
      }
    }
  }

  isDestroyed(): boolean {
    return this.destroyed
  }

  onEvent(listener: (event: RuntimeAssistantEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  destroy(): void {
    this.destroyed = true
    this.listeners.clear()
  }
}

export const runtimeAssistantWindow = new RuntimeAssistantWindow()
