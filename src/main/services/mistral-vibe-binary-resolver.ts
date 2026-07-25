import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { extname } from 'node:path'

import { createLogger } from './logger'

const log = createLogger({ component: 'MistralVibeBinaryResolver' })

export const VIBE_ACP_BINARY_NAME = 'vibe-acp'

function splitResolvedPaths(result: string): string[] {
  return result
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

function compareWindowsCandidates(a: string, b: string): number {
  const rank = (candidate: string): number => {
    const normalized = candidate.toLowerCase()
    const extension = extname(candidate).toLowerCase()
    const isWindowsApps = normalized.includes('\\windowsapps\\')
    if (isWindowsApps) return 10
    if (extension === '.exe') return 0
    if (extension === '.cmd') return 1
    if (extension === '.bat' || extension === '.com') return 2
    return 3
  }

  return rank(a) - rank(b)
}

/**
 * Resolve Mistral Vibe's ACP agent binary (`vibe-acp`) on PATH.
 *
 * Must run after {@link loadShellEnv} so the full shell PATH is available.
 */
export function resolveMistralVibeAcpBinaryPath(): string | null {
  const command = process.platform === 'win32' ? 'where' : 'which'
  try {
    const result = execFileSync(command, [VIBE_ACP_BINARY_NAME], {
      encoding: 'utf-8',
      timeout: 5000,
      env: process.env
    }).trim()

    const resolvedPaths = splitResolvedPaths(result)
    const orderedPaths =
      process.platform === 'win32' ? [...resolvedPaths].sort(compareWindowsCandidates) : resolvedPaths
    const resolvedPath = orderedPaths.find((candidate) => existsSync(candidate)) ?? null

    if (!resolvedPath) {
      log.warn(`${VIBE_ACP_BINARY_NAME} not found on PATH`)
      return null
    }

    log.info(`Resolved Mistral Vibe ACP binary`, { path: resolvedPath })
    return resolvedPath
  } catch {
    log.warn(`Could not resolve ${VIBE_ACP_BINARY_NAME} (not installed or not on PATH)`)
    return null
  }
}
