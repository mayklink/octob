import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { extname } from 'node:path'

import { createLogger } from './logger'

const log = createLogger({ component: 'AntigravityBinaryResolver' })

export const ANTIGRAVITY_BINARY_NAME = 'agy'

function splitResolvedPaths(result: string): string[] {
  return result
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
}

function compareWindowsCandidates(a: string, b: string): number {
  const rank = (candidate: string): number => {
    const normalized = candidate.toLowerCase()
    const extension = extname(candidate).toLowerCase()
    if (normalized.includes('\\windowsapps\\')) return 10
    if (extension === '.exe') return 0
    if (extension === '.cmd') return 1
    if (extension === '.bat' || extension === '.com') return 2
    return 3
  }
  return rank(a) - rank(b)
}

/** Resolve the official Google Antigravity CLI (`agy`) after the shell environment is loaded. */
export function resolveAntigravityBinaryPath(): string | null {
  const command = process.platform === 'win32' ? 'where' : 'which'
  try {
    const output = execFileSync(command, [ANTIGRAVITY_BINARY_NAME], {
      encoding: 'utf-8',
      timeout: 5000,
      env: process.env
    }).trim()
    const candidates = splitResolvedPaths(output)
    const ordered =
      process.platform === 'win32' ? [...candidates].sort(compareWindowsCandidates) : candidates
    const resolved = ordered.find((candidate) => existsSync(candidate)) ?? null
    if (resolved) log.info('Resolved Antigravity CLI binary', { path: resolved })
    return resolved
  } catch {
    log.warn('Could not resolve agy (Antigravity CLI is not installed or not on PATH)')
    return null
  }
}

export function getAntigravityVersion(binaryPath: string): string | null {
  try {
    const output = execFileSync(binaryPath, ['--version'], {
      encoding: 'utf-8',
      timeout: 5000,
      env: process.env
    })
    return output.match(/\d+\.\d+\.\d+(?:[-+][\w.-]+)?/)?.[0] ?? (output.trim() || null)
  } catch {
    return null
  }
}
