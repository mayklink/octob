import { randomUUID } from 'node:crypto'
import type { AssistantProjectSelectionRequest } from '../../shared/types/assistant'

export const PROJECT_SELECTION_TIMEOUT_MS = 5 * 60_000
const SELECTION_GRANT_TTL_MS = 10 * 60_000

interface PendingSelection {
  request: AssistantProjectSelectionRequest
  resolve: (selection: SelectedProject | null) => void
  timeout: ReturnType<typeof setTimeout>
  signal?: AbortSignal
  onAbort?: () => void
}

interface SelectionGrant {
  projectId: string
  expiresAt: number
}

export interface SelectedProject {
  projectId: string
  selectionToken: string
}

/** Binds explicit UI project choices to one delegated operation. */
export class AssistantProjectSelectionManager {
  private readonly pending = new Map<string, PendingSelection>()
  private readonly grants = new Map<string, SelectionGrant>()

  listPending(): AssistantProjectSelectionRequest[] {
    return Array.from(this.pending.values(), (entry) => entry.request)
  }

  request(
    request: AssistantProjectSelectionRequest,
    publish: (request: AssistantProjectSelectionRequest) => void,
    options: { signal?: AbortSignal; timeoutMs?: number } = {}
  ): Promise<SelectedProject | null> {
    if (options.signal?.aborted) return Promise.resolve(null)

    return new Promise((resolve) => {
      const timeoutMs = options.timeoutMs ?? PROJECT_SELECTION_TIMEOUT_MS
      const timeout = setTimeout(() => this.finish(request.id, null), timeoutMs)
      timeout.unref?.()
      const pending: PendingSelection = {
        request,
        resolve,
        timeout,
        signal: options.signal
      }
      if (options.signal) {
        pending.onAbort = () => this.finish(request.id, null)
        options.signal.addEventListener('abort', pending.onAbort, { once: true })
      }
      this.pending.set(request.id, pending)

      try {
        publish(request)
      } catch {
        this.finish(request.id, null)
      }
    })
  }

  resolve(requestId: string, projectId: string | null): boolean {
    const pending = this.pending.get(requestId)
    if (!pending) return false
    if (projectId && !pending.request.projects.some((project) => project.id === projectId)) {
      return false
    }

    let selected: SelectedProject | null = null
    if (projectId) {
      const selectionToken = randomUUID()
      this.grants.set(selectionToken, {
        projectId,
        expiresAt: Date.now() + SELECTION_GRANT_TTL_MS
      })
      selected = { projectId, selectionToken }
    }
    this.finish(requestId, selected)
    return true
  }

  /** Consume all grants atomically only when they match the complete target set. */
  consume(selectionTokens: string[], projectIds: string[]): boolean {
    this.pruneExpiredGrants()
    const uniqueTokens = new Set(selectionTokens)
    const uniqueProjects = new Set(projectIds)
    if (
      selectionTokens.length === 0 ||
      uniqueTokens.size !== selectionTokens.length ||
      uniqueProjects.size !== projectIds.length ||
      uniqueTokens.size !== uniqueProjects.size
    ) return false

    const grants = selectionTokens.map((token) => this.grants.get(token))
    if (grants.some((grant) => !grant)) return false
    const grantedProjects = new Set(grants.map((grant) => grant!.projectId))
    if (
      grantedProjects.size !== uniqueProjects.size ||
      [...uniqueProjects].some((projectId) => !grantedProjects.has(projectId))
    ) return false

    for (const token of selectionTokens) this.grants.delete(token)
    return true
  }

  cancelAll(): void {
    for (const requestId of this.pending.keys()) this.finish(requestId, null)
    this.grants.clear()
  }

  private finish(requestId: string, selection: SelectedProject | null): void {
    const pending = this.pending.get(requestId)
    if (!pending) return
    this.pending.delete(requestId)
    clearTimeout(pending.timeout)
    if (pending.signal && pending.onAbort) {
      pending.signal.removeEventListener('abort', pending.onAbort)
    }
    pending.resolve(selection)
  }

  private pruneExpiredGrants(): void {
    const now = Date.now()
    for (const [token, grant] of this.grants) {
      if (grant.expiresAt <= now) this.grants.delete(token)
    }
  }
}
