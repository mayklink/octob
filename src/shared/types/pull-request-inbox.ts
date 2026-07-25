export type PullRequestProvider = 'github' | 'azure-devops'

export type PullRequestBucket = 'authored' | 'review-requested'

export interface PullRequestInboxProject {
  id: string
  name: string
  path: string
}

export interface AzureDevOpsPullRequestSource {
  id: string
  label: string
  settings: Record<string, string>
}

export interface PullRequestInboxRequest {
  projects: PullRequestInboxProject[]
  githubToken?: string
  azureDevOpsConfigs: AzureDevOpsPullRequestSource[]
}

export interface PullRequestInboxItem {
  id: string
  provider: PullRequestProvider
  number: number
  title: string
  url: string
  author: string
  authorAvatarUrl?: string
  repositoryId: string
  repositoryName: string
  bucket: PullRequestBucket
  buckets: PullRequestBucket[]
  /** True only for an explicit reviewer assignment, excluding a generic assignee. */
  reviewRequested: boolean
  headRefName: string
  sourceRepositoryUrl?: string
  baseRefName: string
  isDraft: boolean
  updatedAt: string
  /** Provider commit identifier used to avoid reviewing the same revision twice. */
  headSha: string
  projectId?: string
  projectPath?: string
}

export interface PullRequestInboxRepository {
  id: string
  provider: PullRequestProvider
  name: string
  projectId?: string
  projectPath?: string
}

export interface PullRequestInboxResponse {
  success: boolean
  items: PullRequestInboxItem[]
  repositories: PullRequestInboxRepository[]
  errors: Array<{ source: string; message: string }>
}

export interface AutomaticPullRequestReviewSettings {
  enabled: boolean
  pollIntervalMinutes: number
  maxConcurrentReviews: number
}

export type AutomaticPullRequestReviewRunStatus =
  | 'queued'
  | 'preparing'
  | 'running'
  | 'reviewed'
  | 'blocked'
  | 'failed'
  | 'cancelled'

export interface AutomaticPullRequestReviewRun {
  id: string
  provider: PullRequestProvider
  repository_id: string
  pr_number: number
  head_sha: string
  title: string
  status: AutomaticPullRequestReviewRunStatus
  worktree_id: string | null
  session_id: string | null
  attempt_count: number
  error: string | null
  discovered_at: string
  started_at: string | null
  completed_at: string | null
  updated_at: string
}

export interface AutomaticPullRequestReviewSnapshot {
  settings: AutomaticPullRequestReviewSettings
  activeCount: number
  queuedCount: number
  lastPollAt: string | null
  lastError: string | null
  runs: AutomaticPullRequestReviewRun[]
}

export type AutomaticPullRequestReviewEvent =
  | { type: 'snapshot-updated' }
  | { type: 'session-created'; sessionId: string; worktreeId: string; projectId: string }
