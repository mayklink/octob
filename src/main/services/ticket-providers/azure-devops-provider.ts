// src/main/services/ticket-providers/azure-devops-provider.ts

import type {
  TicketProvider,
  SettingsField,
  RemoteIssue,
  RemoteIssueListResult,
  RemoteStatus
} from './ticket-provider-types'
import { createLogger } from '../logger'

const log = createLogger({ component: 'AzureDevOpsProvider' })

const API_VERSION = '7.1'

/** Closed-type states on Azure Boards (English defaults; custom processes may differ). */
const CLOSED_STATES = new Set(
  ['closed', 'done', 'resolved', 'removed', 'completed'].map((s) => s.toLowerCase())
)

/** In-progress-style states (heuristic). */
const IN_PROGRESS_HINTS = ['progress', 'active', 'commit', 'development', 'review', 'testing']

function htmlToPlainText(html: string | null | undefined): string | null {
  if (html == null || typeof html !== 'string') return null
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return text.length > 0 ? text : null
}

function mapAzureState(stateRaw: string | undefined): RemoteIssue['state'] {
  const s = (stateRaw ?? '').trim().toLowerCase()
  if (!s) return 'open'
  if (CLOSED_STATES.has(s)) return 'closed'
  for (const hint of IN_PROGRESS_HINTS) {
    if (s.includes(hint)) return 'in_progress'
  }
  return 'open'
}

function escapeWiqlStringLiteral(value: string): string {
  return value.replace(/'/g, "''")
}

function appendWiqlCondition(wiql: string, condition: string): string {
  const orderByMatch = wiql.match(/\s+ORDER\s+BY\s+/i)
  let mainPart = wiql
  let orderPart = ''
  if (orderByMatch?.index !== undefined) {
    mainPart = wiql.slice(0, orderByMatch.index).trimEnd()
    orderPart = wiql.slice(orderByMatch.index)
  }

  if (/\bWHERE\b/i.test(mainPart)) {
    mainPart = `${mainPart} AND ${condition}`
  } else {
    mainPart = `${mainPart} WHERE ${condition}`
  }

  return `${mainPart}${orderPart}`
}

function prepareWiql(wiql: string, minExclusiveId: number | null, project: string): string {
  let q = wiql.trim().replace(/;+\s*$/, '')
  if (!q) return q

  if (!/\[System\.TeamProject\]|\bSystem\.TeamProject\b/i.test(q)) {
    q = appendWiqlCondition(q, `[System.TeamProject] = '${escapeWiqlStringLiteral(project)}'`)
  }

  if (minExclusiveId != null) {
    q = appendWiqlCondition(q, `[System.Id] > ${minExclusiveId}`)
  }

  if (!/\bORDER\s+BY\b/i.test(q)) {
    q = `${q} ORDER BY [System.Id] ASC`
  }
  return q
}

export class AzureDevOpsProvider implements TicketProvider {
  readonly id = 'azure_devops' as const
  readonly name = 'Azure DevOps'
  readonly icon = 'azure_devops'

  getSettingsSchema(): SettingsField[] {
    return [
      {
        key: 'azure_devops_organization',
        label: 'Organization',
        type: 'string',
        required: true,
        placeholder: 'myorg or https://dev.azure.com/myorg'
      },
      {
        key: 'azure_devops_project',
        label: 'Project',
        type: 'string',
        required: true,
        placeholder: 'MyProject'
      },
      {
        key: 'azure_devops_pat',
        label: 'Personal Access Token',
        type: 'password',
        required: true,
        placeholder:
          'PAT: Work Items (Read & write); Graph (Read) optional — user list in import query'
      }
    ]
  }

  async authenticate(settings: Record<string, string>): Promise<string | null> {
    const { organization, project, pat } = this.extractCredentials(settings)

    if (!organization || !project || !pat) {
      return 'Azure DevOps organization, project, and PAT are all required.'
    }

    try {
      const url = this.buildCollectionUrl(organization, `_apis/projects/${encodeURIComponent(project)}`)
      const res = await this.azureFetch(url, pat)

      if (res.status === 401 || res.status === 403) {
        return 'Azure DevOps authentication failed. Check your PAT scopes and organization name.'
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        return `Azure DevOps authentication failed (HTTP ${res.status}). ${body.slice(0, 200)}`
      }

      return null
    } catch (err) {
      return `Azure DevOps authentication failed: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  async listProjectNames(settings: Record<string, string>): Promise<string[]> {
    const { organization, pat } = this.extractCredentials(settings)
    if (!organization || !pat) return []

    try {
      const names: string[] = []
      let continuationToken: string | null = null

      do {
        const baseUrl = this.buildCollectionUrl(organization, '_apis/projects')
        const url = `${baseUrl}&$top=100${continuationToken ? `&continuationToken=${encodeURIComponent(continuationToken)}` : ''}`
        const res = await this.azureFetch(url, pat)

        if (!res.ok) {
          log.warn('listProjectNames: projects failed', { status: res.status })
          return []
        }

        const data = (await res.json()) as { value?: Array<{ name?: string }> }
        for (const project of data.value ?? []) {
          const name = project.name?.trim()
          if (name) names.push(name)
        }

        continuationToken = res.headers.get('x-ms-continuationtoken')
      } while (continuationToken)

      names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
      return names
    } catch (err) {
      log.warn('listProjectNames failed', { error: err instanceof Error ? err.message : String(err) })
      return []
    }
  }

  /**
   * Distinct state names across work item types — powers query-builder dropdowns (like Azure Boards UI).
   */
  async listDistinctStates(settings: Record<string, string>): Promise<string[]> {
    const { organization, project, pat } = this.extractCredentials(settings)
    if (!organization || !project || !pat) return []

    try {
      const typesUrl = this.buildProjectApiUrl(organization, project, '/wit/workitemtypes')
      const typesRes = await this.azureFetch(typesUrl, pat)
      if (!typesRes.ok) {
        log.warn('listDistinctStates: workitemtypes failed', { status: typesRes.status })
        return []
      }
      const typesData = (await typesRes.json()) as { value?: Array<{ name?: string }> }
      const typeNames = (typesData.value ?? []).map((t) => t.name?.trim()).filter(Boolean) as string[]

      const seen = new Set<string>()
      const out: string[] = []
      const maxTypes = 40
      for (const typeName of typeNames.slice(0, maxTypes)) {
        const enc = encodeURIComponent(typeName)
        const statesUrl = this.buildProjectApiUrl(
          organization,
          project,
          `/wit/workitemtypes/${enc}/states`
        )
        const res = await this.azureFetch(statesUrl, pat)
        if (!res.ok) continue
        const data = (await res.json()) as { value?: Array<{ name?: string }> }
        for (const s of data.value ?? []) {
          const n = s.name?.trim()
          if (!n) continue
          const k = n.toLowerCase()
          if (!seen.has(k)) {
            seen.add(k)
            out.push(n)
          }
        }
      }
      out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
      return out
    } catch (err) {
      log.warn('listDistinctStates failed', { error: err instanceof Error ? err.message : String(err) })
      return []
    }
  }

  /** Work item type names for the project (Product Backlog Item, Bug, …). */
  async listWorkItemTypeNames(settings: Record<string, string>): Promise<string[]> {
    const { organization, project, pat } = this.extractCredentials(settings)
    if (!organization || !project || !pat) return []

    try {
      const typesUrl = this.buildProjectApiUrl(organization, project, '/wit/workitemtypes')
      const typesRes = await this.azureFetch(typesUrl, pat)
      if (!typesRes.ok) return []
      const typesData = (await typesRes.json()) as { value?: Array<{ name?: string }> }
      const names = (typesData.value ?? [])
        .map((t) => t.name?.trim())
        .filter(Boolean) as string[]
      names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
      return names
    } catch {
      return []
    }
  }

  /**
   * Directory users for “Assigned To” style pickers. Requires PAT with Graph read (or full) scope.
   * Results are filtered client-side when `query` is non-empty (first page cached up to `maxFetch`).
   */
  async searchDirectoryUsers(
    settings: Record<string, string>,
    query: string,
    options?: { maxFetch?: number }
  ): Promise<Array<{ displayName: string; uniqueName: string }>> {
    const { organization, pat } = this.extractCredentials(settings)
    if (!organization || !pat) return []

    const maxFetch = options?.maxFetch ?? 500
    const q = query.trim().toLowerCase()

    try {
      const base = `https://vssps.dev.azure.com/${encodeURIComponent(organization)}/_apis/graph/users`
      const url = `${base}?api-version=7.1-preview.1&$top=${maxFetch}`
      const res = await this.azureFetch(url, pat)

      if (!res.ok) {
        log.warn('searchDirectoryUsers: graph users failed', { status: res.status })
        return []
      }

      const data = (await res.json()) as {
        value?: Array<Record<string, unknown>>
      }
      const raw = data.value ?? []

      const mapped = raw
        .map((u) => {
          const displayName = String(u.displayName ?? '').trim()
          const uniqueName = String(
            u.principalName ?? u.mailAddress ?? u.directoryAlias ?? ''
          ).trim()
          return { displayName, uniqueName }
        })
        .filter((u) => u.displayName.length > 0)

      if (!q) {
        return mapped.slice(0, 60)
      }

      return mapped
        .filter(
          (u) =>
            u.displayName.toLowerCase().includes(q) ||
            u.uniqueName.toLowerCase().includes(q)
        )
        .slice(0, 60)
    } catch (err) {
      log.warn('searchDirectoryUsers failed', { error: err instanceof Error ? err.message : String(err) })
      return []
    }
  }

  async detectRepo(_projectPath: string): Promise<string | null> {
    return null
  }

  async listIssues(
    repo: string,
    options: {
      page: number
      perPage: number
      state: 'open' | 'closed' | 'all'
      search?: string
      nextPageToken?: string
    },
    settings: Record<string, string>
  ): Promise<RemoteIssueListResult> {
    void options.page
    void options.state

    const { organization, project, pat } = this.extractCredentials(settings)
    if (!organization || !project || !pat) {
      log.warn('Missing Azure DevOps credentials, skipping request')
      return { issues: [], hasNextPage: false, totalCount: -1 }
    }

    const repoKey = this.repoFromSettings(organization, project)
    if (repo.trim() !== repoKey) {
      log.warn('Azure DevOps listIssues repo mismatch', { repo, expected: repoKey })
    }

    const wiqlRaw = options.search?.trim() ?? ''
    if (!wiqlRaw) {
      return { issues: [], hasNextPage: false, totalCount: -1 }
    }

    const cursorId = options.nextPageToken ? parseInt(options.nextPageToken, 10) : null
    const minExclusiveId =
      cursorId != null && !Number.isNaN(cursorId) ? cursorId : null

    let wiql: string
    try {
      wiql = prepareWiql(wiqlRaw, minExclusiveId, project)
    } catch (e) {
      throw new Error(
        `WIQL error: ${e instanceof Error ? e.message : String(e)}`
      )
    }

    if (!wiql) {
      return { issues: [], hasNextPage: false, totalCount: -1 }
    }

    try {
      const wiqlUrl = `${this.buildProjectApiUrl(organization, project, '/wit/wiql')}&$top=${options.perPage}`
      const wiqlRes = await this.azureFetch(wiqlUrl, pat, {
        method: 'POST',
        body: JSON.stringify({ query: wiql })
      })

      if (!wiqlRes.ok) {
        const body = await wiqlRes.text().catch(() => '')
        try {
          const parsed = JSON.parse(body) as { message?: string; innerException?: string }
          const msg = parsed.message ?? parsed.innerException ?? body
          throw new Error(`Azure DevOps WIQL error: ${msg}`)
        } catch (parseErr) {
          if (parseErr instanceof Error && parseErr.message.startsWith('Azure DevOps WIQL error:')) {
            throw parseErr
          }
        }
        log.error('Azure DevOps WIQL failed', undefined, { status: wiqlRes.status, body: body.slice(0, 500) })
        throw new Error(`Azure DevOps WIQL failed (HTTP ${wiqlRes.status})`)
      }

      const wiqlData = (await wiqlRes.json()) as {
        workItems?: Array<{ id: number; url: string }>
      }
      const refs = wiqlData.workItems ?? []
      if (refs.length === 0) {
        return { issues: [], hasNextPage: false, totalCount: -1 }
      }

      const ids = refs.map((w) => w.id)
      const batchUrl = this.buildProjectApiUrl(organization, project, '/wit/workitemsbatch')
      const batchRes = await this.azureFetch(batchUrl, pat, {
        method: 'POST',
        body: JSON.stringify({
          ids,
          fields: [
            'System.Id',
            'System.Title',
            'System.Description',
            'System.State',
            'System.CreatedDate',
            'System.ChangedDate',
            'System.WorkItemType'
          ]
        })
      })

      if (!batchRes.ok) {
        const body = await batchRes.text().catch(() => '')
        log.error('Azure DevOps workitemsbatch failed', undefined, { status: batchRes.status })
        throw new Error(`Azure DevOps batch fetch failed (HTTP ${batchRes.status}): ${body.slice(0, 300)}`)
      }

      const batchData = (await batchRes.json()) as {
        value?: Array<{
          id: number
          fields?: Record<string, unknown>
          url?: string
        }>
      }

      const items = batchData.value ?? []
      const issues: RemoteIssue[] = items.map((item) =>
        this.mapWorkItem(item, organization, project)
      )

      issues.sort((a, b) => parseInt(a.externalId, 10) - parseInt(b.externalId, 10))

      const maxId = Math.max(...ids)
      const hasNextPage = refs.length >= options.perPage

      return {
        issues,
        hasNextPage,
        totalCount: -1,
        nextPageToken: hasNextPage ? String(maxId) : undefined
      }
    } catch (err) {
      if (err instanceof Error) {
        throw err
      }
      return { issues: [], hasNextPage: false, totalCount: -1 }
    }
  }

  async getAvailableStatuses(
    _repo: string,
    externalId: string,
    settings: Record<string, string>
  ): Promise<RemoteStatus[]> {
    const { organization, project, pat } = this.extractCredentials(settings)
    if (!organization || !project || !pat) {
      log.warn('Missing Azure DevOps credentials, skipping getAvailableStatuses')
      return []
    }

    const idNum = parseInt(externalId, 10)
    if (Number.isNaN(idNum)) {
      return []
    }

    try {
      const wiUrl = `${this.buildProjectApiUrl(organization, project, `/wit/workitems/${idNum}`)}&fields=System.WorkItemType`
      const wiRes = await this.azureFetch(wiUrl, pat)
      if (!wiRes.ok) {
        log.error('Failed to fetch Azure DevOps work item', undefined, {
          status: wiRes.status,
          externalId
        })
        return []
      }

      const wi = (await wiRes.json()) as { fields?: Record<string, string> }
      const workItemType = wi.fields?.['System.WorkItemType']
      if (!workItemType) {
        return []
      }

      const typeEncoded = encodeURIComponent(workItemType)
      const statesUrl = this.buildProjectApiUrl(
        organization,
        project,
        `/wit/workitemtypes/${typeEncoded}/states`
      )
      const statesRes = await this.azureFetch(statesUrl, pat)
      if (!statesRes.ok) {
        log.error('Failed to fetch Azure DevOps states', undefined, {
          status: statesRes.status,
          workItemType
        })
        return []
      }

      const statesData = (await statesRes.json()) as {
        value?: Array<{ name?: string }>
      }
      const states = statesData.value ?? []
      return states
        .filter((s) => s.name)
        .map((s) => ({ id: s.name!, label: s.name! }))
    } catch (err) {
      log.error(
        'Error fetching Azure DevOps statuses',
        err instanceof Error ? err : undefined,
        { error: err instanceof Error ? err.message : String(err) }
      )
      return []
    }
  }

  async updateRemoteStatus(
    _repo: string,
    externalId: string,
    statusId: string,
    settings: Record<string, string>
  ): Promise<{ success: boolean; error?: string }> {
    const { organization, project, pat } = this.extractCredentials(settings)
    if (!organization || !project || !pat) {
      return { success: false, error: 'Azure DevOps organization, project, and PAT are required.' }
    }

    const idNum = parseInt(externalId, 10)
    if (Number.isNaN(idNum)) {
      return { success: false, error: 'Invalid Azure DevOps work item id.' }
    }

    try {
      const patchUrl = this.buildProjectApiUrl(organization, project, `/wit/workitems/${idNum}`)
      const res = await this.azureFetch(patchUrl, pat, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json-patch+json'
        },
        body: JSON.stringify([
          { op: 'replace', path: '/fields/System.State', value: statusId }
        ])
      })

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        return {
          success: false,
          error: `Azure DevOps API error (${res.status}): ${body.slice(0, 400)}`
        }
      }

      return { success: true }
    } catch (err) {
      return {
        success: false,
        error: `Failed to update Azure DevOps state: ${err instanceof Error ? err.message : String(err)}`
      }
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────

  repoFromSettings(organization: string, project: string): string {
    return `${organization}/${project}`
  }

  private extractCredentials(settings: Record<string, string>): {
    organization: string
    project: string
    pat: string
  } {
    const orgRaw = settings.azure_devops_organization?.trim() ?? ''
    const projectRaw = settings.azure_devops_project?.trim() ?? ''
    return {
      organization: this.normalizeOrganization(orgRaw),
      project: projectRaw,
      pat: settings.azure_devops_pat?.trim().replace(/^["']|["']$/g, '') ?? ''
    }
  }

  /**
   * Accepts bare org name or pasted URLs like https://dev.azure.com/org/... or https://org.visualstudio.com/
   */
  private normalizeOrganization(raw: string): string {
    const s = raw.replace(/\/+$/, '').trim()
    if (!s) return ''
    const fromDevAzure = s.match(/dev\.azure\.com\/([^/]+)/i)
    if (fromDevAzure?.[1]) {
      return decodeURIComponent(fromDevAzure[1].trim())
    }
    const fromVs = s.match(/(?:https?:\/\/)?([^.]+)\.visualstudio\.com(?:\/|$)/i)
    if (fromVs?.[1]) {
      return fromVs[1].trim()
    }
    const noProto = s.replace(/^https?:\/\//i, '')
    return noProto.split('/')[0]?.trim() ?? s
  }

  /** Collection-level APIs: https://dev.azure.com/{org}/_apis/... */
  private buildCollectionUrl(organization: string, path: string): string {
    const org = encodeURIComponent(organization)
    const normalizedPath = path.startsWith('/') ? path : `/${path}`
    return `https://dev.azure.com/${org}${normalizedPath}?api-version=${API_VERSION}`
  }

  /** Project-level APIs: https://dev.azure.com/{org}/{project}/_apis/... */
  private buildProjectApiUrl(organization: string, project: string, apiPath: string): string {
    const org = encodeURIComponent(organization)
    const proj = encodeURIComponent(project)
    return `https://dev.azure.com/${org}/${proj}/_apis${apiPath}?api-version=${API_VERSION}`
  }

  private buildWorkItemWebUrl(organization: string, project: string, id: number): string {
    const org = encodeURIComponent(organization)
    const proj = encodeURIComponent(project)
    return `https://dev.azure.com/${org}/${proj}/_workitems/edit/${id}`
  }

  private buildAuthHeader(pat: string): string {
    const token = Buffer.from(`:${pat}`).toString('base64')
    return `Basic ${token}`
  }

  private async azureFetch(
    url: string,
    pat: string,
    init?: RequestInit
  ): Promise<Response> {
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: this.buildAuthHeader(pat),
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...init?.headers
      }
    })

    if (res.status === 429) {
      const retryAfter = res.headers.get('retry-after')
      const waitSeconds = retryAfter ? parseInt(retryAfter, 10) : null
      const waitMsg =
        waitSeconds != null
          ? ` Try again in ${waitSeconds} second${waitSeconds !== 1 ? 's' : ''}.`
          : ''
      log.warn('Azure DevOps API rate limited', { url, retryAfter })
      throw new Error(`Rate limited by Azure DevOps.${waitMsg}`)
    }

    return res
  }

  private mapWorkItem(
    item: { id: number; fields?: Record<string, unknown>; url?: string },
    organization: string,
    project: string
  ): RemoteIssue {
    const fields = item.fields ?? {}
    const title = (fields['System.Title'] as string) ?? `#${item.id}`
    const description = fields['System.Description']
    const body =
      typeof description === 'string' ? htmlToPlainText(description) : null
    const stateRaw = fields['System.State'] as string | undefined
    const created = (fields['System.CreatedDate'] as string) ?? new Date().toISOString()
    const changed = (fields['System.ChangedDate'] as string) ?? created

    return {
      externalId: String(item.id),
      title,
      body,
      state: mapAzureState(stateRaw),
      url: this.buildWorkItemWebUrl(organization, project, item.id),
      createdAt: created,
      updatedAt: changed
    }
  }
}
