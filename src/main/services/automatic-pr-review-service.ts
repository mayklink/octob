import { randomUUID } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import type { DatabaseService } from '../db/database'
import type { AutomaticPullRequestReviewRunRow } from '../db/types'
import type { AgentSdkManager } from './agent-sdk-manager'
import type {
  AutomaticPullRequestReviewEvent,
  AutomaticPullRequestReviewSettings,
  AutomaticPullRequestReviewSnapshot,
  PullRequestInboxItem
} from '@shared/types/pull-request-inbox'
import { listPullRequestInbox } from './pull-request-inbox-service'
import { createWorktreeFromBranchOp } from './worktree-ops'
import { createGitService } from './git-service'
import { openCodeService } from './opencode-service'
import { onAgentStreamEvent, type AgentStreamEvent } from './agent-event-bus'
import { createLogger } from './logger'

const log = createLogger({ component: 'AutomaticPRReview' })
const SETTINGS_KEY = 'automatic_pr_review_settings'
const REPOSITORY_SETTINGS_KEY = 'pull_request_review_settings'
const PROVIDER_SETTINGS_KEY = 'provider_settings'
const AZURE_CONFIGS_KEY = 'azure_devops_saved_configs'
const APP_SETTINGS_KEY = 'app_settings'
const DEFAULT_SETTINGS: AutomaticPullRequestReviewSettings = {
  enabled: true,
  pollIntervalMinutes: 5,
  maxConcurrentReviews: 1
}

type SupportedAgentSdk = 'opencode' | 'claude-code' | 'codex'

interface RepositoryReviewSettings {
  agentSdk: SupportedAgentSdk
  model: { providerID: string; modelID: string; variant?: string } | null
  promptPresetId: string
  automaticReviewEnabled?: boolean
}

interface ActiveRun {
  runId: string
  sessionId: string
  sawBusy: boolean
  timeout: ReturnType<typeof setTimeout>
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function clampSettings(value: Partial<AutomaticPullRequestReviewSettings>): AutomaticPullRequestReviewSettings {
  return {
    enabled: value.enabled !== false,
    pollIntervalMinutes: Math.max(1, Math.min(1440, Math.round(value.pollIntervalMinutes ?? 5))),
    maxConcurrentReviews: Math.max(1, Math.min(10, Math.round(value.maxConcurrentReviews ?? 1)))
  }
}

function resolvePrompt(db: DatabaseService, config: RepositoryReviewSettings, pull: PullRequestInboxItem): string {
  const appSettings = parseJson<{
    codeReviewPromptTemplates?: Array<{ id: string; body: string }>
  }>(db.getSetting(APP_SETTINGS_KEY), {})
  const custom = appSettings.codeReviewPromptTemplates?.find(
    (template) => template.id === config.promptPresetId
  )?.body.trim()
  let opening = custom
  if (!opening) {
    if (config.promptPresetId === 'builtin:superpowers') {
      opening = 'Please review the changes on the current branch. Use the superpowers:code-reviewer skill. Focus on bugs, logic errors, and code quality.'
    } else if (config.promptPresetId === 'builtin:adversarial') {
      opening = 'Perform an adversarial code review. Try to break the changed code and report only concrete, reproducible defects. Do not modify files and do not ask the user questions.'
    } else {
      opening = 'Please review the changes on the current branch. Focus on bugs, logic errors, and code quality. Do not modify files and do not ask the user questions.'
    }
  }
  return [
    opening,
    '',
    '---',
    '',
    `Pull request: #${pull.number} — ${pull.title}`,
    `URL: ${pull.url}`,
    `Revision: ${pull.headSha}`,
    '',
    `Compare the current branch (${pull.headRefName}) against origin/${pull.baseRefName}.`,
    `Use \`git diff origin/${pull.baseRefName}...HEAD\` to see all changes.`,
    'This is an automatic read-only review. Never edit, commit, push, approve, or comment on the pull request.'
  ].join('\n')
}

export class AutomaticPRReviewService {
  private window: BrowserWindow | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private polling = false
  private stopped = true
  private lastPollAt: string | null = null
  private lastError: string | null = null
  private activeBySession = new Map<string, ActiveRun>()
  private unsubscribeAgentEvents: (() => void) | null = null

  constructor(
    private readonly db: DatabaseService,
    private readonly sdkManager: AgentSdkManager
  ) {}

  setMainWindow(window: BrowserWindow): void {
    this.window = window
  }

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.recoverInterruptedRuns()
    this.unsubscribeAgentEvents = onAgentStreamEvent((event) => this.handleAgentEvent(event))
    this.schedule(1000)
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.unsubscribeAgentEvents?.()
    this.unsubscribeAgentEvents = null
    for (const active of this.activeBySession.values()) clearTimeout(active.timeout)
    this.activeBySession.clear()
  }

  getSettings(): AutomaticPullRequestReviewSettings {
    return clampSettings(
      parseJson<Partial<AutomaticPullRequestReviewSettings>>(
        this.db.getSetting(SETTINGS_KEY),
        DEFAULT_SETTINGS
      )
    )
  }

  updateSettings(settings: AutomaticPullRequestReviewSettings): AutomaticPullRequestReviewSettings {
    const normalized = clampSettings(settings)
    this.db.setSetting(SETTINGS_KEY, JSON.stringify(normalized))
    this.schedule(250)
    this.emit({ type: 'snapshot-updated' })
    return normalized
  }

  getSnapshot(): AutomaticPullRequestReviewSnapshot {
    const runs = this.db.listAutomaticPullRequestReviewRuns(100)
    return {
      settings: this.getSettings(),
      activeCount: this.activeBySession.size,
      queuedCount: runs.filter((run) => run.status === 'queued').length,
      lastPollAt: this.lastPollAt,
      lastError: this.lastError,
      runs: runs.map(({ payload_json: _payload, ...run }) => run)
    }
  }

  async pollNow(): Promise<void> {
    await this.poll()
  }

  private schedule(delayMs?: number): void {
    if (this.stopped) return
    if (this.timer) clearTimeout(this.timer)
    const delay = delayMs ?? this.getSettings().pollIntervalMinutes * 60_000
    this.timer = setTimeout(() => void this.poll(), delay)
  }

  private async poll(): Promise<void> {
    if (this.stopped || this.polling) return
    const settings = this.getSettings()
    if (!settings.enabled) {
      this.schedule()
      return
    }
    this.polling = true
    try {
      const projects = this.db.getAllProjects().map(({ id, name, path }) => ({ id, name, path }))
      const repositorySettings = this.getRepositorySettings()
      this.cancelDisabledQueuedRuns(repositorySettings)
      if (!Object.values(repositorySettings).some((config) => config.automaticReviewEnabled)) {
        this.lastPollAt = new Date().toISOString()
        this.lastError = null
        return
      }
      const providerSettings = parseJson<Record<string, string>>(
        this.db.getSetting(PROVIDER_SETTINGS_KEY),
        {}
      )
      const azureDevOpsConfigs = parseJson<Array<{
        id: string
        label: string
        settings: Record<string, string>
      }>>(this.db.getSetting(AZURE_CONFIGS_KEY), [])
      const result = await listPullRequestInbox({
        projects,
        githubToken: providerSettings.github_pat,
        azureDevOpsConfigs
      })

      for (const pull of result.items) {
        const config = repositorySettings[pull.repositoryId]
        if (
          !config?.automaticReviewEnabled ||
          pull.isDraft ||
          !pull.projectId ||
          !pull.projectPath ||
          !pull.reviewRequested ||
          pull.buckets.includes('authored')
        ) continue
        this.db.createAutomaticPullRequestReviewRun({
          id: randomUUID(),
          provider: pull.provider,
          repository_id: pull.repositoryId,
          pr_number: pull.number,
          head_sha: pull.headSha,
          title: pull.title,
          payload_json: JSON.stringify(pull)
        })
      }

      this.lastPollAt = new Date().toISOString()
      this.lastError = result.errors.length > 0
        ? result.errors.map((error) => `${error.source}: ${error.message}`).join('; ')
        : null
      await this.pump()
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
      log.error('Automatic pull request poll failed', error instanceof Error ? error : new Error(String(error)))
    } finally {
      this.polling = false
      this.emit({ type: 'snapshot-updated' })
      this.schedule()
    }
  }

  private getRepositorySettings(): Record<string, RepositoryReviewSettings> {
    return parseJson<Record<string, RepositoryReviewSettings>>(
      this.db.getSetting(REPOSITORY_SETTINGS_KEY),
      {}
    )
  }

  private cancelDisabledQueuedRuns(configs: Record<string, RepositoryReviewSettings>): void {
    for (const run of this.db.listPendingAutomaticPullRequestReviewRuns()) {
      if (run.status === 'queued' && !configs[run.repository_id]?.automaticReviewEnabled) {
        this.db.updateAutomaticPullRequestReviewRun(run.id, {
          status: 'cancelled',
          completed_at: new Date().toISOString(),
          error: 'Automatic review was disabled for this repository.'
        })
      }
    }
  }

  private async pump(): Promise<void> {
    const globalSettings = this.getSettings()
    if (!globalSettings.enabled) return
    const limit = globalSettings.maxConcurrentReviews
    const configs = this.getRepositorySettings()
    const pending = this.db.listPendingAutomaticPullRequestReviewRuns()
      .filter((run) => run.status === 'queued' && configs[run.repository_id]?.automaticReviewEnabled)

    while (this.activeBySession.size < limit && pending.length > 0) {
      const run = pending.shift()!
      void this.execute(run, configs[run.repository_id]).catch((error) => {
        this.failRun(run.id, error)
      })
      // Preparing jobs count toward concurrency before a backend session exists.
      const placeholder = `preparing:${run.id}`
      this.activeBySession.set(placeholder, {
        runId: run.id,
        sessionId: placeholder,
        sawBusy: false,
        timeout: setTimeout(() => this.failRun(run.id, new Error('Review preparation timed out.')), 10 * 60_000)
      })
    }
  }

  private async execute(run: AutomaticPullRequestReviewRunRow, config: RepositoryReviewSettings): Promise<void> {
    const placeholder = `preparing:${run.id}`
    this.db.updateAutomaticPullRequestReviewRun(run.id, {
      status: 'preparing',
      attempt_count: run.attempt_count + 1,
      started_at: new Date().toISOString(),
      error: null
    })
    const pull = JSON.parse(run.payload_json) as PullRequestInboxItem
    const project = pull.projectId ? this.db.getProject(pull.projectId) : null
    if (!project) throw new Error('The pull request repository is no longer available in Octob.')

    let worktree = this.db.getActiveWorktreesByProject(project.id).find(
      (candidate) =>
        (pull.provider === 'github' && candidate.github_pr_number === pull.number) ||
        candidate.branch_name === pull.headRefName
    )
    if (!worktree) {
      const created = await createWorktreeFromBranchOp(this.db, {
        projectId: project.id,
        projectPath: project.path,
        projectName: project.name,
        branchName: pull.headRefName,
        prNumber: pull.provider === 'github' ? pull.number : undefined,
        nameHint: `pr-${pull.number}`,
        fetchRemoteUrl: pull.provider === 'azure-devops' ? pull.sourceRepositoryUrl : undefined,
        fetchRef: pull.provider === 'azure-devops' ? `refs/heads/${pull.headRefName}` : undefined
      })
      if (!created.success || !created.worktree) {
        throw new Error(created.error || 'Could not create the pull request worktree.')
      }
      worktree = this.db.getWorktree(created.worktree.id) ?? undefined
    }
    if (!worktree) throw new Error('The pull request worktree could not be loaded.')

    const sync = await createGitService(worktree.path).syncPullRequestBranch({
      prNumber: pull.provider === 'github' ? pull.number : undefined,
      headRefName: pull.headRefName,
      sourceRepositoryUrl: pull.sourceRepositoryUrl
    })
    if (!sync.success) throw new Error(sync.error || 'Could not synchronize the pull request branch.')
    if (pull.provider === 'github') this.db.attachPR(worktree.id, pull.number, pull.url)

    const agentSdk: SupportedAgentSdk =
      config.agentSdk === 'claude-code' || config.agentSdk === 'codex' ? config.agentSdk : 'opencode'
    const session = this.db.createSession({
      worktree_id: worktree.id,
      project_id: project.id,
      name: `Review PR #${pull.number} — ${pull.title}`,
      agent_sdk: agentSdk,
      mode: 'build',
      ...(config.model ? {
        model_provider_id: config.model.providerID,
        model_id: config.model.modelID,
        model_variant: config.model.variant ?? null
      } : {})
    })

    const connected = agentSdk === 'opencode'
      ? await openCodeService.connect(worktree.path, session.id)
      : await this.sdkManager.getImplementer(agentSdk).connect(worktree.path, session.id)
    this.db.updateSession(session.id, { opencode_session_id: connected.sessionId })
    this.db.updateAutomaticPullRequestReviewRun(run.id, {
      status: 'running',
      worktree_id: worktree.id,
      session_id: session.id
    })

    const preparing = this.activeBySession.get(placeholder)
    if (preparing) clearTimeout(preparing.timeout)
    this.activeBySession.delete(placeholder)
    const active: ActiveRun = {
      runId: run.id,
      sessionId: session.id,
      sawBusy: false,
      timeout: setTimeout(() => this.failRun(run.id, new Error('Automatic review timed out.')), 2 * 60 * 60_000)
    }
    this.activeBySession.set(session.id, active)
    this.emit({
      type: 'session-created',
      sessionId: session.id,
      worktreeId: worktree.id,
      projectId: project.id
    })

    const prompt = resolvePrompt(this.db, config, pull)
    if (agentSdk === 'opencode') {
      await openCodeService.prompt(worktree.path, connected.sessionId, [{ type: 'text', text: prompt }], config.model ?? undefined)
    } else {
      await this.sdkManager.getImplementer(agentSdk).prompt(
        worktree.path,
        connected.sessionId,
        [{ type: 'text', text: prompt }],
        config.model ?? undefined
      )
    }
    this.emit({ type: 'snapshot-updated' })
  }

  private handleAgentEvent(event: AgentStreamEvent): void {
    const active = this.activeBySession.get(event.sessionId)
    if (!active) return
    if (event.type === 'session.error') {
      this.failRun(active.runId, new Error('The review agent reported an error.'))
      return
    }
    if (event.type === 'permission.asked' || event.type === 'question.asked' || event.type === 'plan.ready') {
      this.finishRun(active.runId, 'blocked', 'The automatic review requires user intervention.')
      return
    }
    if (event.type !== 'session.status') return
    const dataStatus = event.data && typeof event.data === 'object'
      ? (event.data as { status?: { type?: string } }).status?.type
      : undefined
    const status = event.statusPayload?.type ?? dataStatus
    if (status === 'busy') active.sawBusy = true
    if (status === 'idle' && active.sawBusy) this.finishRun(active.runId, 'reviewed', null)
  }

  private failRun(runId: string, error: unknown): void {
    this.finishRun(runId, 'failed', error instanceof Error ? error.message : String(error))
  }

  private finishRun(
    runId: string,
    status: 'reviewed' | 'blocked' | 'failed',
    error: string | null
  ): void {
    for (const [key, active] of this.activeBySession) {
      if (active.runId !== runId) continue
      clearTimeout(active.timeout)
      this.activeBySession.delete(key)
    }
    this.db.updateAutomaticPullRequestReviewRun(runId, {
      status,
      error,
      completed_at: new Date().toISOString()
    })
    this.emit({ type: 'snapshot-updated' })
    void this.pump()
  }

  private recoverInterruptedRuns(): void {
    for (const run of this.db.listPendingAutomaticPullRequestReviewRuns()) {
      if (run.status === 'queued') continue
      if (run.session_id) {
        this.db.updateSession(run.session_id, {
          status: 'completed',
          completed_at: new Date().toISOString()
        })
      }
      this.db.updateAutomaticPullRequestReviewRun(run.id, {
        status: 'queued',
        session_id: null,
        error: 'Recovered after Octob restarted.'
      })
    }
  }

  private emit(event: AutomaticPullRequestReviewEvent): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('automaticPRReview:event', event)
    }
  }
}
