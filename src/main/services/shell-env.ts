import { execFileSync } from 'child_process'
import { createLogger } from './logger'

const log = createLogger({ component: 'ShellEnv' })

function mergeWindowsPathSegments(...pathLists: string[]): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const list of pathLists) {
    for (const raw of list.split(';')) {
      const p = raw.trim()
      if (!p) continue
      const key = p.replace(/[/\\]+$/, '').toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(p)
    }
  }
  return out.join(';')
}

function getWindowsRegistryPath(scope: 'Machine' | 'User'): string {
  try {
    const script = `[Environment]::GetEnvironmentVariable('Path','${scope}')`
    return execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { encoding: 'utf-8', timeout: 8000, windowsHide: true }
    ).trim()
  } catch {
    return ''
  }
}

function loadWindowsUserPath(): void {
  const machinePath = getWindowsRegistryPath('Machine')
  const userPath = getWindowsRegistryPath('User')
  const current = process.env.Path ?? process.env.PATH ?? ''

  if (!machinePath && !userPath) {
    log.warn('Windows PATH merge skipped (could not read Machine/User Path from registry)')
    return
  }

  const merged = mergeWindowsPathSegments(machinePath, userPath, current)
  if (merged === current) {
    return
  }

  process.env.Path = merged
  process.env.PATH = merged
  log.info('Merged Windows user/machine Path into process env for CLI resolution', {
    segmentsBefore: current.split(';').filter(Boolean).length,
    segmentsAfter: merged.split(';').filter(Boolean).length
  })
}

/**
 * Load the full shell environment into `process.env`.
 *
 * On macOS, GUI apps launched from Finder/Dock/Spotlight inherit a minimal
 * environment that is missing user-configured variables (e.g. AWS credentials,
 * CLAUDE_CODE_USE_BEDROCK, custom PATHs). This function spawns the user's
 * login shell, captures every exported variable, and merges them into the
 * current process so that all child-process spawns behave identically to a
 * terminal launch.
 *
 * On Windows, GUI apps often miss entries that installers append to the **user**
 * Path (e.g. Cursor CLI's `agent.exe`) while Windows Terminal sees the full Path.
 * We merge Machine + User Path from the registry, then dedupe with the current
 * process Path so `where` / `which` style resolution matches a login shell.
 *
 * Must be called once at app startup, before any child process spawning.
 */
export function loadShellEnv(): void {
  if (process.platform === 'win32') {
    loadWindowsUserPath()
    return
  }

  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  const shellFlags = process.env.OCTOB_INTERACTIVE_SHELL_ENV === '1' ? '-ilc' : '-lc'

  try {
    // Use null-delimited output (`env -0`) to safely handle values that
    // contain newlines.  Falls back to newline-delimited `env` if `-0` is
    // not supported (unlikely on macOS, but defensive).
    let raw: string
    let delimiter: string

    try {
      raw = execFileSync(shell, [shellFlags, 'env -0'], {
        encoding: 'utf-8',
        timeout: 5000,
        maxBuffer: 10 * 1024 * 1024
      })
      delimiter = '\0'
    } catch {
      raw = execFileSync(shell, [shellFlags, 'env'], {
        encoding: 'utf-8',
        timeout: 5000,
        maxBuffer: 10 * 1024 * 1024
      })
      delimiter = '\n'
    }

    const parsed: Record<string, string> = {}

    for (const entry of raw.split(delimiter)) {
      if (!entry) continue
      const idx = entry.indexOf('=')
      if (idx <= 0) continue
      const key = entry.slice(0, idx)
      const value = entry.slice(idx + 1)
      parsed[key] = value
    }

    Object.assign(process.env, parsed)

    log.info('Loaded shell environment', {
      shell,
      shellFlags,
      varsLoaded: Object.keys(parsed).length
    })
  } catch (err) {
    log.warn('Failed to load shell environment, continuing with default env', {
      shell,
      shellFlags,
      error: err instanceof Error ? err.message : String(err)
    })
  }
}
