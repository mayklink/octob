import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { delimiter, dirname, extname, join } from 'path'
import { createLogger } from './logger'

const log = createLogger({ component: 'ClaudeBinaryResolver' })

/**
 * Resolve the system-wide Claude Code binary path.
 *
 * Must be called AFTER loadShellEnv() so the full shell PATH is available
 * (macOS GUI apps don't inherit shell PATH by default).
 *
 * When the app is packaged into an ASAR archive, the SDK's bundled cli.js
 * cannot be spawned as a child process. Pointing the SDK at the system
 * binary sidesteps this entirely.
 */
export function resolveClaudeBinaryPath(): string | null {
  const command = process.platform === 'win32' ? 'where' : 'which'
  const binary = 'claude'

  try {
    const result = execFileSync(command, [binary], {
      encoding: 'utf-8',
      timeout: 5000,
      // Inherit the (loadShellEnv-corrected) environment
      env: process.env
    }).trim()

    const resolvedPaths = result
      .split(/\r?\n/)
      .map((path) => path.trim())
      .filter(Boolean)

    for (const resolvedPath of resolvedPaths) {
      if (process.platform !== 'win32' || extname(resolvedPath).toLowerCase() === '.exe') {
        if (existsSync(resolvedPath)) {
          log.info('Resolved Claude binary', { path: resolvedPath })
          return resolvedPath
        }
        continue
      }

      // npm exposes claude.cmd/claude.ps1 on Windows, while the Agent SDK needs
      // the native executable itself rather than a shell wrapper.
      const npmExecutable = join(
        dirname(resolvedPath),
        'node_modules',
        '@anthropic-ai',
        'claude-code',
        'bin',
        'claude.exe'
      )
      if (existsSync(npmExecutable)) {
        log.info('Resolved Claude binary from npm wrapper', { path: npmExecutable })
        return npmExecutable
      }
    }
  } catch {
    // Continue with packaged and PATH-directory fallbacks below.
  }

  if (process.platform === 'win32') {
    const pathDirectories = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
    const candidates = [
      ...pathDirectories.map((pathDirectory) =>
        join(
          pathDirectory,
          'node_modules',
          '@anthropic-ai',
          'claude-code',
          'bin',
          'claude.exe'
        )
      ),
      join(
        process.resourcesPath,
        'app.asar.unpacked',
        'node_modules',
        '@anthropic-ai',
        'claude-agent-sdk-win32-x64',
        'claude.exe'
      )
    ]

    const fallback = candidates.find((candidate) => existsSync(candidate))
    if (fallback) {
      log.info('Resolved Claude binary from fallback location', { path: fallback })
      return fallback
    }
  }

  log.warn('Could not resolve Claude binary (not installed or not on PATH)')
  return null
}
