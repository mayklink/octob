import { useEffect, useState } from 'react'
import { ArrowRight, Bot, CheckCircle2, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SessionView } from '@/components/sessions'
import { useGlobalAssistantStore } from '@/stores/useGlobalAssistantStore'
import { useProjectStore } from '@/stores/useProjectStore'
import { useSessionStore } from '@/stores/useSessionStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useWorktreeStatusStore } from '@/stores/useWorktreeStatusStore'
import { useWorktreeStore } from '@/stores/useWorktreeStore'

const GLOBAL_SCOPE_ID = '__octob_global_assistant__'

export function GlobalAssistantView(): React.JSX.Element {
  const projects = useProjectStore((state) => state.projects)
  const assistantSessionId = useGlobalAssistantStore((state) => state.assistantSessionId)
  const tasks = useGlobalAssistantStore((state) => state.tasks)
  const sessionStatuses = useWorktreeStatusStore((state) => state.sessionStatuses)
  const [workspacePath, setWorkspacePath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const projectId = projects[0]?.id

  useEffect(() => window.assistantOps.onTaskCreated((task) => {
    useGlobalAssistantStore.getState().addTask(task)
  }), [])

  useEffect(() => {
    let cancelled = false

    const prepare = async (): Promise<void> => {
      setError(null)
      try {
        if (!projectId) {
          throw new Error('Adicione pelo menos um projeto para habilitar as ferramentas do agente.')
        }
        const rawWorkspacePath = await window.assistantOps.getWorkspacePath()
        if (cancelled) return

        const storedSessionId = useGlobalAssistantStore.getState().assistantSessionId
        let session = storedSessionId
          ? await window.db.session.get(storedSessionId)
          : null
        if (cancelled) return
        if (session?.worktree_id || session?.connection_id) {
          session = null
        }

        if (!session) {
          const settings = useSettingsStore.getState()
          const model = settings.selectedModelByProvider[settings.defaultAgentSdk] ?? settings.selectedModel
          session = await window.db.session.create({
            worktree_id: null,
            project_id: projectId,
            name: 'Assistente Global',
            agent_sdk: settings.defaultAgentSdk,
            ...(model
              ? {
                  model_provider_id: model.providerID,
                  model_id: model.modelID,
                  model_variant: model.variant ?? null
                }
              : {})
          })
          if (cancelled) return
          useGlobalAssistantStore.getState().setAssistantSessionId(session.id)
        }

        useSessionStore.setState((state) => {
          const sessionsByConnection = new Map(state.sessionsByConnection)
          sessionsByConnection.set(GLOBAL_SCOPE_ID, [session!])
          const modeBySession = new Map(state.modeBySession)
          modeBySession.set(session!.id, session!.mode || 'build')
          const orphanedSessions = new Map(state.orphanedSessions)
          orphanedSessions.delete(session!.id)
          return {
            sessionsByConnection,
            modeBySession,
            orphanedSessions,
            activeSessionId: session!.id
          }
        })

        if (!cancelled) setWorkspacePath(rawWorkspacePath)
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      }
    }

    void prepare()
    return () => { cancelled = true }
  }, [projectId, retry])

  if (error) {
    return (
      <div className="flex h-full flex-1 items-center justify-center">
        <div className="max-w-md text-center">
          <Bot className="mx-auto h-9 w-9 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" className="mt-4" onClick={() => setRetry((value) => value + 1)}>
            <RefreshCw className="mr-2 h-4 w-4" />Tentar novamente
          </Button>
        </div>
      </div>
    )
  }

  if (!assistantSessionId || !workspacePath) {
    return <div className="flex h-full flex-1 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Preparando o agente global…</div>
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="border-b px-8 py-5">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary"><Bot className="h-5 w-5" /></div>
          <div>
            <div className="flex items-center gap-2"><h1 className="font-semibold">Assistente do Octob</h1><span className="rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">Global</span></div>
            <p className="text-xs text-muted-foreground">Converse naturalmente e delegue trabalhos sem abrir um projeto primeiro.</p>
          </div>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 px-8 py-6">
        <div className="mx-auto grid min-h-0 w-full max-w-5xl gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="min-h-0 overflow-hidden rounded-2xl border bg-card shadow-sm">
            <SessionView key={assistantSessionId} sessionId={assistantSessionId} workspacePathOverride={workspacePath} />
          </section>
          <aside className="min-h-0 space-y-3 overflow-auto">
            <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Trabalhos do assistente</h2><span className="text-xs text-muted-foreground">{tasks.length}</span></div>
            {tasks.length === 0 ? <div className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">As worktrees e tarefas delegadas pelo agente aparecerão aqui.</div> : tasks.map((task) => {
              const status = sessionStatuses[task.sessionId]?.status
              const ready = status === 'completed' || status === 'plan_ready' || status === 'unread'
              return <div key={task.sessionId} className={`rounded-xl border bg-card p-4 ${ready ? 'shadow-[0_0_0_1px_hsl(var(--primary)/.25)]' : ''}`}>
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{task.projectName}</div>
                <div className="mt-1 line-clamp-2 text-sm font-medium">{task.title}</div>
                <div className={`mt-3 flex items-center gap-1.5 text-xs font-medium ${ready ? 'text-emerald-500' : 'text-sky-500'}`}>{ready ? <CheckCircle2 className="h-4 w-4" /> : <Loader2 className="h-4 w-4 animate-spin" />}{ready ? 'Pronto para você' : 'Trabalhando'}</div>
                <Button variant="ghost" size="sm" className="mt-2 h-7 w-full justify-between px-2" onClick={() => { void (async () => {
                  useGlobalAssistantStore.getState().close()
                  useProjectStore.getState().selectProject(task.projectId)
                  useWorktreeStore.getState().selectWorktree(task.worktreeId)
                  const sessionStore = useSessionStore.getState()
                  sessionStore.setActiveWorktree(task.worktreeId)
                  await sessionStore.loadSessions(task.worktreeId, task.projectId)
                  useSessionStore.getState().setActiveSession(task.sessionId)
                })() }}>Abrir worktree<ArrowRight className="h-3.5 w-3.5" /></Button>
              </div>
            })}
          </aside>
        </div>
      </div>
    </div>
  )
}
