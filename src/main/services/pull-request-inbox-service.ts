import { execFile } from 'child_process'
import { promisify } from 'util'
import type {
  AzureDevOpsPullRequestSource,
  PullRequestBucket,
  PullRequestInboxItem,
  PullRequestInboxProject,
  PullRequestInboxRepository,
  PullRequestInboxRequest,
  PullRequestInboxResponse
} from '@shared/types/pull-request-inbox'

const execFileAsync = promisify(execFile)
const GITHUB_ACCEPT = 'application/vnd.github+json'
const GITHUB_API_VERSION = '2022-11-28'
const AZURE_API_VERSION = '7.1'

interface LocalRepository {
  project: PullRequestInboxProject
  remoteUrl: string
  githubName?: string
  azureName?: { organization: string; project: string; repository: string }
}

function normalizeAzureOrganization(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  const devAzure = trimmed.match(/dev\.azure\.com\/([^/]+)/i)
  if (devAzure?.[1]) return decodeURIComponent(devAzure[1])
  const visualStudio = trimmed.match(/(?:https?:\/\/)?([^.]+)\.visualstudio\.com/i)
  if (visualStudio?.[1]) return visualStudio[1]
  return trimmed.replace(/^https?:\/\//i, '').split('/')[0] ?? trimmed
}

function parseGitHubRemote(remoteUrl: string): string | undefined {
  const match = remoteUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?$/i)
  return match ? `${match[1]}/${match[2]}` : undefined
}

function parseAzureRemote(
  remoteUrl: string
): { organization: string; project: string; repository: string } | undefined {
  const devAzure = remoteUrl.match(
    /dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/?#]+)/i
  )
  if (devAzure) {
    return {
      organization: decodeURIComponent(devAzure[1]),
      project: decodeURIComponent(devAzure[2]),
      repository: decodeURIComponent(devAzure[3]).replace(/\.git$/i, '')
    }
  }
  const visualStudio = remoteUrl.match(
    /([^/.]+)\.visualstudio\.com\/(?:DefaultCollection\/)?([^/]+)\/_git\/([^/?#]+)/i
  )
  if (visualStudio) {
    return {
      organization: decodeURIComponent(visualStudio[1]),
      project: decodeURIComponent(visualStudio[2]),
      repository: decodeURIComponent(visualStudio[3]).replace(/\.git$/i, '')
    }
  }
  return undefined
}

async function discoverLocalRepositories(
  projects: PullRequestInboxProject[]
): Promise<LocalRepository[]> {
  const results = await Promise.all(
    projects.map(async (project): Promise<LocalRepository | null> => {
      try {
        const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], {
          cwd: project.path,
          windowsHide: true
        })
        const remoteUrl = stdout.trim()
        return {
          project,
          remoteUrl,
          githubName: parseGitHubRemote(remoteUrl),
          azureName: parseAzureRemote(remoteUrl)
        }
      } catch {
        return null
      }
    })
  )
  return results.filter((row): row is LocalRepository => row !== null)
}

async function githubFetch(path: string, token: string): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: GITHUB_ACCEPT,
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
      'User-Agent': 'Octob'
    }
  })
}

async function loadGitHub(
  repositories: LocalRepository[],
  configuredToken: string,
  items: PullRequestInboxItem[],
  repoRows: PullRequestInboxRepository[],
  errors: Array<{ source: string; message: string }>
): Promise<void> {
  const githubRepositories = repositories.filter((repo) => repo.githubName)
  if (githubRepositories.length === 0) return
  let token = configuredToken.trim()
  if (!token) {
    try {
      const result = await execFileAsync('gh', ['auth', 'token'], { windowsHide: true })
      token = result.stdout.trim()
    } catch {
      errors.push({
        source: 'GitHub',
        message: 'Configure a GitHub token in Settings → Integrations or authenticate the GitHub CLI.'
      })
      return
    }
  }

  const viewerResponse = await githubFetch('/user', token)
  if (!viewerResponse.ok) {
    errors.push({ source: 'GitHub', message: `Authentication failed (HTTP ${viewerResponse.status}).` })
    return
  }
  const viewer = (await viewerResponse.json()) as { login: string }

  await Promise.all(
    githubRepositories.map(async (repo) => {
      const repositoryName = repo.githubName!
      const repositoryId = `github:${repositoryName.toLowerCase()}`
      repoRows.push({
        id: repositoryId,
        provider: 'github',
        name: repositoryName,
        projectId: repo.project.id,
        projectPath: repo.project.path
      })
      try {
        const response = await githubFetch(
          `/repos/${repositoryName}/pulls?state=open&per_page=100&sort=updated&direction=desc`,
          token
        )
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const pulls = (await response.json()) as Array<{
          number: number
          title: string
          html_url: string
          user: { login: string; avatar_url?: string }
          requested_reviewers?: Array<{ login: string }>
          assignees?: Array<{ login: string }>
          head: { ref: string; sha: string }
          base: { ref: string }
          draft?: boolean
          updated_at: string
        }>

        for (const pull of pulls) {
          const buckets: PullRequestBucket[] = []
          if (pull.user.login.toLowerCase() === viewer.login.toLowerCase()) buckets.push('authored')
          const marked = [...(pull.requested_reviewers ?? []), ...(pull.assignees ?? [])].some(
            (person) => person.login.toLowerCase() === viewer.login.toLowerCase()
          )
          if (marked) buckets.push('review-requested')
          const reviewRequested = (pull.requested_reviewers ?? []).some(
            (person) => person.login.toLowerCase() === viewer.login.toLowerCase()
          )
          if (buckets.length === 0) continue
          items.push({
            id: `${repositoryId}:${pull.number}`,
            provider: 'github',
            number: pull.number,
            title: pull.title,
            url: pull.html_url,
            author: pull.user.login,
            authorAvatarUrl: pull.user.avatar_url,
            repositoryId,
            repositoryName,
            bucket: buckets[0],
            buckets,
            reviewRequested,
            headRefName: pull.head.ref,
            baseRefName: pull.base.ref,
            isDraft: pull.draft === true,
            updatedAt: pull.updated_at,
            headSha: pull.head.sha,
            projectId: repo.project.id,
            projectPath: repo.project.path
          })
        }
      } catch (error) {
        errors.push({
          source: repositoryName,
          message: error instanceof Error ? error.message : String(error)
        })
      }
    })
  )
}

function azureHeaders(pat: string): HeadersInit {
  return {
    Authorization: `Basic ${Buffer.from(`:${pat}`).toString('base64')}`,
    Accept: 'application/json'
  }
}

async function azureFetchJson<T>(url: string, pat: string): Promise<T> {
  const response = await fetch(url, { headers: azureHeaders(pat) })
  if (response.status === 401) throw new Error('Authentication failed. Update the Azure DevOps PAT.')
  if (response.status === 403) {
    throw new Error('Access denied. The Azure DevOps PAT needs Code (Read) permission.')
  }
  if (!response.ok) throw new Error(`Azure DevOps returned HTTP ${response.status}.`)
  return response.json() as Promise<T>
}

interface AzurePullRequest {
  pullRequestId: number
  title: string
  createdBy: { id: string; displayName: string; imageUrl?: string }
  reviewers?: Array<{ id: string; displayName: string }>
  repository: { id: string; name: string; remoteUrl?: string; webUrl?: string }
  sourceRefName: string
  sourceRepository?: { remoteUrl?: string; webUrl?: string }
  targetRefName: string
  isDraft?: boolean
  creationDate: string
  lastMergeSourceCommit?: { commitId?: string }
}

async function loadAzureProject(
  organization: string,
  project: string,
  pat: string,
  viewerId: string,
  localRepositories: LocalRepository[],
  items: PullRequestInboxItem[],
  repoRows: PullRequestInboxRepository[]
): Promise<void> {
  const pulls = await azureFetchJson<{ value: AzurePullRequest[] }>(
    `https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/_apis/git/pullrequests?searchCriteria.status=active&$top=100&api-version=${AZURE_API_VERSION}`,
    pat
  )

  for (const pull of pulls.value) {
    const repository = pull.repository
    const fullName = `${organization}/${project}/${repository.name}`
    const repositoryId = `azure-devops:${fullName.toLowerCase()}`
    const local = localRepositories.find(
      (candidate) =>
        candidate.azureName?.organization.toLowerCase() === organization.toLowerCase() &&
        candidate.azureName.project.toLowerCase() === project.toLowerCase() &&
        candidate.azureName.repository.toLowerCase() === repository.name.toLowerCase()
    )
    repoRows.push({
      id: repositoryId,
      provider: 'azure-devops',
      name: fullName,
      projectId: local?.project.id,
      projectPath: local?.project.path
    })

    const buckets: PullRequestBucket[] = []
    if (pull.createdBy.id.toLowerCase() === viewerId.toLowerCase()) buckets.push('authored')
    if (
      (pull.reviewers ?? []).some(
        (reviewer) => reviewer.id.toLowerCase() === viewerId.toLowerCase()
      )
    ) {
      buckets.push('review-requested')
    }
    const reviewRequested = (pull.reviewers ?? []).some(
      (reviewer) => reviewer.id.toLowerCase() === viewerId.toLowerCase()
    )
    if (buckets.length === 0) continue
    items.push({
      id: `${repositoryId}:${pull.pullRequestId}`,
      provider: 'azure-devops',
      number: pull.pullRequestId,
      title: pull.title,
      url: `https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repository.name)}/pullrequest/${pull.pullRequestId}`,
      author: pull.createdBy.displayName,
      authorAvatarUrl: pull.createdBy.imageUrl,
      repositoryId,
      repositoryName: fullName,
      bucket: buckets[0],
      buckets,
      reviewRequested,
      headRefName: pull.sourceRefName.replace(/^refs\/heads\//, ''),
      sourceRepositoryUrl:
        pull.sourceRepository?.remoteUrl ??
        pull.sourceRepository?.webUrl ??
        repository.remoteUrl ??
        repository.webUrl,
      baseRefName: pull.targetRefName.replace(/^refs\/heads\//, ''),
      isDraft: pull.isDraft === true,
      updatedAt: pull.creationDate,
      headSha: pull.lastMergeSourceCommit?.commitId ?? `${pull.pullRequestId}:${pull.creationDate}`,
      projectId: local?.project.id,
      projectPath: local?.project.path
    })
  }
}

async function loadAzureConfig(
  config: AzureDevOpsPullRequestSource,
  localRepositories: LocalRepository[],
  items: PullRequestInboxItem[],
  repoRows: PullRequestInboxRepository[],
  errors: Array<{ source: string; message: string }>
): Promise<void> {
  const organization = normalizeAzureOrganization(config.settings.azure_devops_organization ?? '')
  const project = config.settings.azure_devops_project?.trim() ?? ''
  const pat = config.settings.azure_devops_pat?.trim().replace(/^["']|["']$/g, '') ?? ''
  if (!organization || !pat) {
    errors.push({ source: config.label, message: 'Organization and PAT are required.' })
    return
  }

  try {
    const connection = await azureFetchJson<{
      authenticatedUser: { id: string; providerDisplayName?: string }
    }>(
      `https://dev.azure.com/${encodeURIComponent(organization)}/_apis/connectionData?connectOptions=1&lastChangeId=-1&lastChangeId64=-1`,
      pat
    )

    const projectNames = project
      ? [project]
      : (
          await azureFetchJson<{ value: Array<{ id: string; name: string }> }>(
            `https://dev.azure.com/${encodeURIComponent(organization)}/_apis/projects?$top=1000&api-version=${AZURE_API_VERSION}`,
            pat
          )
        ).value.map((row) => row.name)

    const results = await Promise.allSettled(
      projectNames.map((projectName) =>
        loadAzureProject(
          organization,
          projectName,
          pat,
          connection.authenticatedUser.id,
          localRepositories,
          items,
          repoRows
        )
      )
    )
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        errors.push({
          source: `${organization}/${projectNames[index]}`,
          message: result.reason instanceof Error ? result.reason.message : String(result.reason)
        })
      }
    })
  } catch (error) {
    errors.push({
      source: config.label,
      message: error instanceof Error ? error.message : String(error)
    })
  }
}

export async function listPullRequestInbox(
  request: PullRequestInboxRequest
): Promise<PullRequestInboxResponse> {
  const items: PullRequestInboxItem[] = []
  const repositories: PullRequestInboxRepository[] = []
  const errors: Array<{ source: string; message: string }> = []
  const localRepositories = await discoverLocalRepositories(request.projects)

  await Promise.all([
    loadGitHub(localRepositories, request.githubToken ?? '', items, repositories, errors),
    ...request.azureDevOpsConfigs.map((config) =>
      loadAzureConfig(config, localRepositories, items, repositories, errors)
    )
  ])

  const uniqueRepositories = Array.from(
    new Map(repositories.map((repository) => [repository.id, repository])).values()
  ).sort((a, b) => a.name.localeCompare(b.name))

  const uniqueItems = Array.from(
    items.reduce((byId, item) => {
      const existing = byId.get(item.id)
      if (!existing) {
        byId.set(item.id, item)
        return byId
      }
      const buckets = Array.from(new Set([...existing.buckets, ...item.buckets]))
      byId.set(item.id, {
        ...existing,
        ...(!existing.projectId && item.projectId
          ? { projectId: item.projectId, projectPath: item.projectPath }
          : {}),
        bucket: buckets[0],
        buckets
      })
      return byId
    }, new Map<string, PullRequestInboxItem>()).values()
  )
  uniqueItems.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  return { success: errors.length === 0, items: uniqueItems, repositories: uniqueRepositories, errors }
}
