import { useEffect, useState } from 'react'
import { ArrowRight, Bell, Bot, CheckCircle2, Loader2, MessageSquarePlus, MoreHorizontal, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SessionView } from '@/components/sessions'
import { useGlobalAssistantStore } from '@/stores/useGlobalAssistantStore'
import { useProjectStore } from '@/stores/useProjectStore'
import { useSessionStore } from '@/stores/useSessionStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useWorktreeStatusStore } from '@/stores/useWorktreeStatusStore'
import { useWorktreeStore } from '@/stores/useWorktreeStore'

const GLOBAL_SCOPE_ID = '__octob_global_assistant__'

function taskStatusLabel(status: string | undefined): string {
  if (status === 'planning') return 'Elaborando plano'
  if (status === 'answering') return 'Preparando resposta'
  if (status === 'permission') return 'Aguardando permissão'
  if (status === 'command_approval') return 'Aguardando aprovação'
  if (status === 'working') return 'Agente trabalhando'
  return 'Iniciando agente'
}

function worktreeName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

async function createAssistantSession(projectId: string) {
  const settings = useSettingsStore.getState()
  const model = settings.selectedModelByProvider[settings.defaultAgentSdk] ?? settings.selectedModel
  return window.db.session.create({
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
}

function activateAssistantSession(
  session: Awaited<ReturnType<typeof createAssistantSession>>
): void {
  useSessionStore.setState((state) => {
    const sessionsByConnection = new Map(state.sessionsByConnection)
    sessionsByConnection.set(GLOBAL_SCOPE_ID, [session])
    const modeBySession = new Map(state.modeBySession)
    modeBySession.set(session.id, session.mode || 'build')
    const orphanedSessions = new Map(state.orphanedSessions)
    orphanedSessions.delete(session.id)
    return {
      sessionsByConnection,
      modeBySession,
      orphanedSessions,
      activeSessionId: session.id
    }
  })
}

export function GlobalAssistantView(): React.JSX.Element {
  const projects = useProjectStore((state) => state.projects)
  const assistantSessionId = useGlobalAssistantStore((state) => state.assistantSessionId)
  const tasks = useGlobalAssistantStore((state) => state.tasks)
  const sessionStatuses = useWorktreeStatusStore((state) => state.sessionStatuses)
  const [workspacePath, setWorkspacePath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [isStartingNewSession, setIsStartingNewSession] = useState(false)
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
          session = await createAssistantSession(projectId)
          if (cancelled) return
          useGlobalAssistantStore.getState().setAssistantSessionId(session.id)
        }

        activateAssistantSession(session)

        if (!cancelled) setWorkspacePath(rawWorkspacePath)
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      }
    }

    void prepare()
    return () => { cancelled = true }
  }, [projectId, retry])

  const handleStartNewSession = async (): Promise<void> => {
    if (!projectId || !workspacePath || isStartingNewSession) return

    setIsStartingNewSession(true)
    try {
      if (assistantSessionId) {
        const currentSession = await window.db.session.get(assistantSessionId)
        if (currentSession?.opencode_session_id) {
          try {
            await window.opencodeOps.disconnect(workspacePath, currentSession.opencode_session_id)
          } catch (cause) {
            console.warn('Failed to disconnect previous assistant session:', cause)
          }
        }
        await window.db.session.update(assistantSessionId, {
          status: 'completed',
          completed_at: new Date().toISOString()
        })
        useWorktreeStatusStore.getState().clearSessionStatus(assistantSessionId)
      }

      const nextSession = await createAssistantSession(projectId)
      activateAssistantSession(nextSession)
      useGlobalAssistantStore.getState().setAssistantSessionId(nextSession.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setIsStartingNewSession(false)
    }
  }

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
    <div className="flex h-full min-h-0 flex-1 overflow-hidden bg-background">
      <main className="flex min-w-0 flex-1 flex-col border-r border-border/70">
        <header className="shrink-0 border-b border-border/70 px-7 py-4">
          <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
                <Bot className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="truncate text-sm font-semibold">Assistente do Octob</h1>
                  <span className="rounded-full border border-border/80 px-2 py-0.5 text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
                    Global
                  </span>
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  Converse naturalmente e delegue trabalhos sem abrir um projeto primeiro.
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8 shrink-0 gap-2 px-3 text-xs"
              onClick={() => void handleStartNewSession()}
              disabled={isStartingNewSession}
              title="Encerrar esta conversa e iniciar uma sessão nova"
            >
              {isStartingNewSession ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <MessageSquarePlus className="h-3.5 w-3.5" />
              )}
              Nova conversa
            </Button>
          </div>
        </header>

        <section className="min-h-0 flex-1 overflow-hidden bg-gradient-to-b from-background to-muted/[0.08]">
          <div className="mx-auto flex h-full w-full max-w-4xl">
            <SessionView
              key={assistantSessionId}
              sessionId={assistantSessionId}
              workspacePathOverride={workspacePath}
            />
          </div>
        </section>
      </main>

      <aside className="flex w-[360px] shrink-0 flex-col bg-card/25">
        <div className="flex h-[69px] shrink-0 items-center justify-between border-b border-border/70 px-5">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">Trabalhos do assistente</h2>
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
              {tasks.length}
            </span>
          </div>
          <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          {tasks.length === 0 ? (
            <div className="flex min-h-40 flex-col items-center justify-center rounded-xl border border-dashed border-border/80 px-7 text-center">
              <Bot className="mb-3 h-6 w-6 text-muted-foreground/60" />
              <p className="text-sm font-medium">Nenhum trabalho delegado</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Quando o agente abrir uma worktree, o andamento aparecerá aqui.
              </p>
            </div>
          ) : tasks.map((task) => {
            const status = sessionStatuses[task.sessionId]?.status
            const ready = status === 'completed' || status === 'plan_ready' || status === 'unread'
            return (
              <article
                key={task.sessionId}
                className={`rounded-xl border p-3.5 transition-colors ${
                  ready
                    ? 'border-emerald-500/45 bg-emerald-500/[0.06]'
                    : 'border-border/80 bg-card/80'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                      {task.projectName}
                    </div>
                    <h3 className="mt-1 line-clamp-2 text-xs font-semibold leading-relaxed">
                      {task.title}
                    </h3>
                  </div>
                  {ready ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                  ) : (
                    <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" />
                  )}
                </div>

                <div className={`mt-3 flex items-center gap-1.5 text-[11px] font-medium ${ready ? 'text-emerald-500' : 'text-foreground/75'}`}>
                  {ready ? 'Pronto para revisar' : taskStatusLabel(status)}
                </div>

                {ready ? (
                  <div className="mt-2.5 space-y-1.5 text-[11px] text-muted-foreground">
                    <div className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-emerald-500" />Investigação concluída</div>
                    <div className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-emerald-500" />Contexto e resultado disponíveis</div>
                  </div>
                ) : (
                  <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full w-2/5 animate-pulse rounded-full bg-primary" />
                  </div>
                )}

                <div className="mt-2.5 truncate font-mono text-[10px] text-muted-foreground/80">
                  {worktreeName(task.worktreePath)}
                </div>

                {ready && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3 h-8 w-full justify-between border-emerald-500/30 bg-emerald-500/[0.04] px-3 text-xs hover:bg-emerald-500/10"
                    onClick={() => { void (async () => {
                      useGlobalAssistantStore.getState().close()
                      useProjectStore.getState().selectProject(task.projectId)
                      useWorktreeStore.getState().selectWorktree(task.worktreeId)
                      const sessionStore = useSessionStore.getState()
                      sessionStore.setActiveWorktree(task.worktreeId)
                      await sessionStore.loadSessions(task.worktreeId, task.projectId)
                      useSessionStore.getState().setActiveSession(task.sessionId)
                    })() }}
                  >
                    Abrir worktree
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                )}
              </article>
            )
          })}
        </div>

        <footer className="shrink-0 border-t border-border/70 p-4">
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <Bell className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p className="leading-relaxed">Você pode sair desta tela. Os trabalhos continuam em segundo plano.</p>
          </div>
        </footer>
      </aside>
    </div>
  )
}
