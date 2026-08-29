import { useEffect, useState } from 'react'
import { ArrowRight, Bell, Bot, CheckCircle2, CircleCheckBig, FileText, FolderGit2, GitPullRequest, Lightbulb, Loader2, MessageSquare, MessageSquarePlus, MoreHorizontal, Play, RefreshCw, Search, Sparkles, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { SessionView } from '@/components/sessions'
import { OctobMark } from '@/components/brand/OctoBMark'
import { useGlobalAssistantStore } from '@/stores/useGlobalAssistantStore'
import { useProjectStore } from '@/stores/useProjectStore'
import { useSessionStore } from '@/stores/useSessionStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useWorktreeStatusStore } from '@/stores/useWorktreeStatusStore'
import { useWorktreeStore } from '@/stores/useWorktreeStore'
import { toast } from '@/lib/toast'
import type {
  AssistantProjectSelectionRequest,
  AssistantTask
} from '@shared/types/assistant'

const GLOBAL_SCOPE_ID = '__octob_global_assistant__'

const assistantActions = [
  { label: 'Listar tarefas pendentes', prompt: 'Mostre as tarefas pendentes atribuídas a mim.', icon: CircleCheckBig },
  { label: 'Investigar problema', prompt: 'Investigue os problemas abertos mais importantes dos meus projetos.', icon: Search },
  { label: 'Criar plano', prompt: 'Crie um plano para melhorar a cobertura de testes do repositório.', icon: FileText },
  { label: 'Revisar PR', prompt: 'Quais pull requests estão aguardando revisão?', icon: GitPullRequest }
]

const assistantExamples = [
  'Quais PRs estão aguardando revisão?',
  'Resuma os problemas abertos da API.',
  'Crie um plano para melhorar a cobertura de testes do repositório.',
  'Investigue falhas nos jobs do CI dos últimos 7 dias.',
  'Mostre tarefas pendentes atribuídas a mim.'
]

function AssistantWelcome({ onSelect }: { onSelect: (prompt: string) => void }): React.JSX.Element {
  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col justify-center px-7 py-7">
      <div className="text-center">
        <div className="mb-2 flex items-center justify-center gap-3">
          <Sparkles className="h-8 w-8 text-violet-400" />
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">Assistente do Octob</h1>
        </div>
        <p className="text-sm text-muted-foreground">Converse naturalmente e delegue trabalhos sem abrir um projeto primeiro.</p>
      </div>

      <div className="mt-7 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {assistantActions.map(({ label, prompt, icon: Icon }) => (
          <button key={label} type="button" onClick={() => onSelect(prompt)} className="group flex min-h-16 items-center gap-3 rounded-lg border border-border/45 bg-card/35 px-3.5 text-left transition-colors hover:border-border hover:bg-muted/45">
            <Icon className="h-5 w-5 shrink-0 text-primary" />
            <span className="text-sm font-medium leading-snug">{label}</span>
          </button>
        ))}
      </div>

      <div className="mt-4 grid overflow-hidden rounded-xl border border-border/45 bg-card/20 md:grid-cols-[205px_1fr]">
        <div className="relative hidden min-h-60 border-r border-border/40 md:flex md:items-center md:justify-center">
          <div className="absolute h-28 w-28 rounded-full bg-violet-500/12 blur-3xl" />
          <OctobMark className="relative h-36 w-36 opacity-90 drop-shadow-[0_10px_20px_rgba(76,29,149,0.16)]" />
        </div>
        <div className="px-7 py-5">
          <h2 className="text-lg font-semibold">Como posso ajudar hoje?</h2>
          <p className="mt-1 text-xs text-muted-foreground">Aqui estão alguns exemplos do que você pode pedir:</p>
          <div className="mt-4 space-y-1">
            {assistantExamples.map((example) => (
              <button key={example} type="button" onClick={() => onSelect(example)} className="group flex w-full items-center gap-3 rounded-lg px-1 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:text-foreground">
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-primary/80 transition-transform group-hover:translate-x-0.5" />{example}
              </button>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-2 border-t border-border/50 pt-4 text-xs text-muted-foreground"><Lightbulb className="h-4 w-4 text-primary" /><span><strong className="font-medium text-foreground">Dica:</strong> descreva o que você precisa e eu executo para você.</span></div>
        </div>
      </div>
    </div>
  )
}

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
  const [taskPendingRemoval, setTaskPendingRemoval] = useState<AssistantTask | null>(null)
  const [isRemovingTask, setIsRemovingTask] = useState(false)
  const [projectSelectionRequests, setProjectSelectionRequests] = useState<AssistantProjectSelectionRequest[]>([])
  const [resolvingProjectId, setResolvingProjectId] = useState<string | null>(null)
  const projectId = projects[0]?.id

  useEffect(() => {
    let cancelled = false
    const unsubscribe = window.assistantOps.onTaskCreated((task) => {
      useGlobalAssistantStore.getState().addTask(task)
    })
    const unsubscribeTasksChanged = window.assistantOps.onTasksChanged((updatedTasks) => {
      useGlobalAssistantStore.getState().replaceTasks(updatedTasks)
    })

    void window.assistantOps.listTasks().then((persistedTasks) => {
      if (!cancelled) useGlobalAssistantStore.getState().replaceTasks(persistedTasks)
    }).catch((cause) => {
      console.warn('Failed to load delegated assistant tasks:', cause)
    })

    return () => {
      cancelled = true
      unsubscribe()
      unsubscribeTasksChanged()
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const unsubscribe = window.assistantOps.onProjectSelectionRequested((request) => {
      setProjectSelectionRequests((current) => [
        ...current.filter((item) => item.id !== request.id),
        request
      ])
    })

    void window.assistantOps.listProjectSelectionRequests().then((requests) => {
      if (!cancelled) setProjectSelectionRequests(requests)
    }).catch((cause) => {
      console.warn('Failed to load project selection requests:', cause)
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

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

  const handleOpenTask = async (task: AssistantTask): Promise<void> => {
    useProjectStore.getState().selectProject(task.projectId)
    useWorktreeStore.getState().selectWorktree(task.worktreeId)

    const sessionStore = useSessionStore.getState()
    sessionStore.setActiveWorktree(task.worktreeId)
    await sessionStore.loadSessions(task.worktreeId, task.projectId)
    useSessionStore.getState().setActiveSession(task.sessionId)
  }

  const handleRemoveTask = async (removeResources: boolean): Promise<void> => {
    const task = taskPendingRemoval
    if (!task || isRemovingTask) return

    setIsRemovingTask(true)
    try {
      if (removeResources) {
        const project = projects.find((item) => item.id === task.projectId)
        if (!project) throw new Error('Projeto do trabalho não encontrado.')
        const worktree = await window.db.worktree.get(task.worktreeId)
        if (!worktree) throw new Error('Workspace do trabalho não encontrado.')

        const session = await window.db.session.get(task.sessionId)
        if (session?.opencode_session_id) {
          try {
            await window.opencodeOps.abort(task.worktreePath, session.opencode_session_id)
          } catch {
            // The agent may already be stopped or disconnected.
          }
        }

        await window.db.session.delete(task.sessionId)
        const result = await useWorktreeStore.getState().unbranchWorktree(
          task.worktreeId,
          task.worktreePath,
          worktree.branch_name,
          project.path
        )
        if (!result.success) {
          throw new Error(result.error || 'Não foi possível remover o workspace.')
        }
      }

      const remainingTasks = await window.assistantOps.removeTask(task.sessionId)
      useGlobalAssistantStore.getState().replaceTasks(remainingTasks)
      setTaskPendingRemoval(null)
      toast.success(removeResources ? 'Trabalho, sessão e workspace removidos.' : 'Trabalho removido desta lista.')
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Não foi possível remover o trabalho.')
    } finally {
      setIsRemovingTask(false)
    }
  }

  const activeProjectSelection = projectSelectionRequests[0] ?? null

  const handleProjectSelection = async (projectId: string | null): Promise<void> => {
    if (!activeProjectSelection || resolvingProjectId) return
    setResolvingProjectId(projectId ?? '__cancel__')
    try {
      const resolved = await window.assistantOps.resolveProjectSelection(
        activeProjectSelection.id,
        projectId
      )
      if (resolved) {
        setProjectSelectionRequests((current) => current.filter(
          (request) => request.id !== activeProjectSelection.id
        ))
      }
    } finally {
      setResolvingProjectId(null)
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
    <>
      <Dialog
        open={Boolean(activeProjectSelection)}
        onOpenChange={(open) => {
          if (!open) void handleProjectSelection(null)
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Selecionar projeto</DialogTitle>
            <DialogDescription>
              {activeProjectSelection?.question}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-1">
            {activeProjectSelection?.projects.map((project) => (
              <button
                key={project.id}
                type="button"
                disabled={Boolean(resolvingProjectId)}
                onClick={() => void handleProjectSelection(project.id)}
                className="flex w-full items-start gap-3 rounded-lg border border-border bg-card px-3.5 py-3 text-left transition-colors hover:border-primary/45 hover:bg-muted/40 disabled:opacity-60"
              >
                {resolvingProjectId === project.id ? (
                  <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" />
                ) : (
                  <FolderGit2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                )}
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{project.name}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {project.description || project.language || 'Projeto registrado no Octob'}
                  </span>
                </span>
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={Boolean(resolvingProjectId)}
              onClick={() => void handleProjectSelection(null)}
            >
              Cancelar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(taskPendingRemoval)}
        onOpenChange={(open) => {
          if (!open && !isRemovingTask) setTaskPendingRemoval(null)
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Remover trabalho do painel?</DialogTitle>
            <DialogDescription>
              {taskPendingRemoval?.title}
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Você pode apenas ocultar este trabalho ou também apagar sua sessão e remover o workspace. A remoção do workspace mantém a branch.
          </p>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              disabled={isRemovingTask}
              onClick={() => setTaskPendingRemoval(null)}
            >
              Cancelar
            </Button>
            <Button
              variant="secondary"
              disabled={isRemovingTask}
              onClick={() => void handleRemoveTask(false)}
            >
              Somente remover
            </Button>
            <Button
              variant="destructive"
              disabled={isRemovingTask}
              onClick={() => void handleRemoveTask(true)}
            >
              {isRemovingTask && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Remover tudo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex h-full min-h-0 flex-1 overflow-hidden bg-background">
      <main className="flex min-w-0 flex-1 flex-col border-r border-border/70">
        <header className="shrink-0 border-b border-border/70 px-7 py-3">
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
                <p className="mt-0.5 truncate text-xs text-muted-foreground">Espaço global de trabalho</p>
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

        <section className="min-h-0 flex-1 overflow-hidden">
          <div className="mx-auto flex h-full w-full max-w-5xl">
            <SessionView
              key={assistantSessionId}
              sessionId={assistantSessionId}
              workspacePathOverride={workspacePath}
              layoutVariant="global-assistant"
              emptyState={(selectPrompt) => <AssistantWelcome onSelect={selectPrompt} />}
            />
          </div>
        </section>
      </main>

      <aside className="flex w-[320px] shrink-0 flex-col bg-muted/[0.12]">
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
            <div className="flex min-h-40 flex-col items-center justify-center rounded-xl bg-muted/25 px-7 text-center">
              <div className="mb-3 rounded-xl bg-background/60 p-3"><Bot className="h-6 w-6 text-muted-foreground/70" /></div>
              <p className="text-sm font-medium">Nenhum trabalho delegado</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Quando o agente abrir uma worktree, o andamento aparecerá aqui.
              </p>
              <Button variant="secondary" size="sm" className="mt-4 h-8 text-xs" onClick={() => void handleStartNewSession()}>
                Novo trabalho
              </Button>
            </div>
          ) : tasks.map((task) => {
            const status = sessionStatuses[task.sessionId]?.status
            const ready = status === 'completed' || status === 'plan_ready' || status === 'unread'
            return (
              <article
                key={task.sessionId}
                role="link"
                tabIndex={0}
                title={`Abrir ${worktreeName(task.worktreePath)} nesta sessão`}
                onClick={() => void handleOpenTask(task)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    void handleOpenTask(task)
                  }
                }}
                className={`cursor-pointer rounded-xl border p-3.5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${
                  ready
                    ? 'border-emerald-500/45 bg-emerald-500/[0.06] hover:border-emerald-500/70 hover:bg-emerald-500/[0.1]'
                    : 'border-border/80 bg-card/80 hover:border-primary/45 hover:bg-card'
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
                  <div className="flex shrink-0 items-center gap-1">
                    {ready ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      title="Remover trabalho do painel"
                      aria-label="Remover trabalho do painel"
                      onClick={(event) => {
                        event.stopPropagation()
                        setTaskPendingRemoval(task)
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
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
                    onClick={(event) => {
                      event.stopPropagation()
                      void handleOpenTask(task)
                    }}
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
          <div className="rounded-xl bg-muted/25 p-3.5">
            <p className="mb-3 text-xs font-semibold text-foreground">Como funciona</p>
            {[
              { icon: MessageSquare, title: 'Você pede', description: 'Descreva a tarefa em linguagem natural.' },
              { icon: Play, title: 'O agente executa', description: 'Ele cria a worktree, faz mudanças e valida.' },
              { icon: CheckCircle2, title: 'Você revisa', description: 'Acompanhe o progresso e revise os resultados.' }
            ].map(({ icon: Icon, title, description }) => (
              <div key={title} className="mb-3 flex items-start gap-3 last:mb-0">
                <div className="rounded-lg bg-background/60 p-2 text-primary"><Icon className="h-4 w-4" /></div>
                <div><p className="text-xs font-medium text-foreground">{title}</p><p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">{description}</p></div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-start gap-2 text-[10px] text-muted-foreground">
            <Bell className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p className="leading-relaxed">Os trabalhos continuam em segundo plano quando você sai desta tela.</p>
          </div>
        </footer>
      </aside>
      </div>
    </>
  )
}
