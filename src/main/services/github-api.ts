import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface GitHubRepository {
  owner: string
  name: string
}

function readGhCliToken(): string | null {
  const configDir = process.env.GH_CONFIG_DIR?.trim()
  const candidates = [
    process.env.GITHUB_TOKEN,
    process.env.GH_TOKEN,
    process.env.OCTOB_GITHUB_TOKEN,
    configDir ? join(configDir, 'hosts.yml') : null,
    process.env.APPDATA ? join(process.env.APPDATA, 'GitHub CLI', 'hosts.yml') : null,
    join(homedir(), '.config', 'gh', 'hosts.yml')
  ]

  for (const candidate of candidates) {
    if (!candidate) continue
    if (!candidate.endsWith('.yml')) {
      const token = candidate.trim()
      if (token) return token
      continue
    }
    try {
      const content = readFileSync(candidate, 'utf8')
      const match = content.match(/oauth_token:\s*([^\s#]+)/)
      if (match?.[1]) return match[1]
    } catch {
      // Optional local GitHub CLI configuration.
    }
  }

  return null
}

export function getGitHubToken(): string | null {
  return readGhCliToken()
}

export function parseGitHubRemote(remoteUrl: string): GitHubRepository | null {
  const value = remoteUrl.trim()
  const match = value.match(/^(?:https?:\/\/|ssh:\/\/git@|git@)github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/i)
  if (!match) return null
  return { owner: match[1], name: match[2] }
}

export async function githubRequest<T>(
  repository: GitHubRepository,
  endpoint: string,
  init: RequestInit = {}
): Promise<T> {
  const token = getGitHubToken()
  if (!token) {
    throw new Error('GitHub authentication is not configured. Set GITHUB_TOKEN or sign in with GitHub CLI.')
  }

  const response = await fetch(`https://api.github.com/repos/${repository.owner}/${repository.name}${endpoint}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'user-agent': 'octob-browser-runtime',
      ...(init.headers ?? {})
    }
  })

  const text = await response.text()
  let payload: unknown = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = text
    }
  }
  if (!response.ok) {
    const message =
      typeof payload === 'object' && payload !== null && 'message' in payload
        ? String((payload as { message?: unknown }).message)
        : `${response.status} ${response.statusText}`
    throw new Error(`GitHub API: ${message}`)
  }
  return payload as T
}
