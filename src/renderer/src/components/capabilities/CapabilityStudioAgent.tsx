import { useEffect, useState } from 'react'
import { Loader2, MessageSquarePlus } from 'lucide-react'
import { SessionView } from '@/components/sessions'
import { useProjectStore } from '@/stores/useProjectStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useSessionStore } from '@/stores/useSessionStore'

const STORAGE_KEY = 'octob-capability-studio-session'
const SCOPE_ID = '__octob_capability_studio__'

export function CapabilityStudioAgent(): React.JSX.Element {
  const projectId = useProjectStore((state) => state.projects[0]?.id)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [workspacePath, setWorkspacePath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    const prepare = async (): Promise<void> => {
      try {
        const path = await window.assistantOps.getWorkspacePath()
        if (!path) throw new Error('Workspace do assistente indisponível.')
        const savedId = localStorage.getItem(STORAGE_KEY)
        let session = savedId ? await window.db.session.get(savedId) : null
        if (session && (session.worktree_id || session.connection_id || session.name !== 'Experimentos')) {
          session = null
        }
        if (!session) {
          const settings = useSettingsStore.getState()
          const model = settings.selectedModelByProvider[settings.defaultAgentSdk] ?? settings.selectedModel
          const data = {
            worktree_id: null,
            project_id: projectId,
            name: 'Experimentos',
            agent_sdk: settings.defaultAgentSdk,
            ...(model ? {
              model_provider_id: model.providerID,
              model_id: model.modelID,
              model_variant: model.variant ?? null
            } : {})
          }
          if ((window as typeof window & { __OCTOB_WEB_RUNTIME__?: boolean }).__OCTOB_WEB_RUNTIME__ && window.assistantOps.createSession) {
            session = await window.assistantOps.createSession({ ...data, id: crypto.randomUUID() }) as Awaited<ReturnType<typeof window.db.session.create>> | null
          } else {
            session = await window.db.session.create(data)
          }
          if (!session) throw new Error('Não foi possível criar a conversa de experimentos.')
          localStorage.setItem(STORAGE_KEY, session.id)
        }
        if (cancelled) return
        useSessionStore.setState((state) => {
          const sessionsByConnection = new Map(state.sessionsByConnection)
          sessionsByConnection.set(SCOPE_ID, [session])
          const modeBySession = new Map(state.modeBySession)
          modeBySession.set(session.id, session.mode || 'build')
          return { sessionsByConnection, modeBySession }
        })
        setWorkspacePath(path)
        setSessionId(session.id)
        setError(null)
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      }
    }
    void prepare()
    return () => { cancelled = true }
  }, [projectId, retry])

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex h-[69px] shrink-0 items-center justify-between border-b border-border px-4">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">Conversa do experimento</h2>
          <p className="text-xs text-muted-foreground">Peça ajustes e teste a prévia ao lado.</p>
        </div>
        <button
          type="button"
          title="Nova conversa"
          aria-label="Nova conversa do experimento"
          onClick={() => { localStorage.removeItem(STORAGE_KEY); setSessionId(null); setRetry((value) => value + 1) }}
          className="rounded p-2 hover:bg-muted"
        >
          <MessageSquarePlus className="h-4 w-4" />
        </button>
      </header>
      {error ? <div role="alert" className="p-4 text-sm text-destructive">{error}</div>
        : !projectId ? <div className="m-auto p-4 text-sm text-muted-foreground">Adicione um projeto para usar o agente de experimentos.</div>
          : sessionId && workspacePath ? <SessionView key={sessionId} sessionId={sessionId} workspacePathOverride={workspacePath} layoutVariant="global-assistant" />
            : <div className="m-auto flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Preparando conversa…</div>}
    </div>
  )
}
