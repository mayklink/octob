import { app } from 'electron'
import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { getLogDir } from './logger'
import { resolveCodexBinaryPath, supportsCodexAppServer } from './codex-binary-resolver'
import { resolveMistralVibeAcpBinaryPath } from './mistral-vibe-binary-resolver'
import { resolveCursorCliAgentBinaryPath } from './cursor-cli-binary-resolver'
import { getAntigravityVersion, resolveAntigravityBinaryPath } from './antigravity-binary-resolver'
import { resolveOpenCodeLaunchSpec } from './opencode-binary-resolver'
import type { OpenCodeLaunchSpec } from './opencode-binary-resolver'

export interface AgentSdkDetection {
  opencode: boolean
  claude: boolean
  codex: boolean
  mistralVibe: boolean
  cursorCli: boolean
  antigravity: boolean
  antigravityVersion: string | null
}

export interface AppPaths {
  userData: string
  home: string
  logs: string
}

export function detectAgentSdks(openCodeLaunchSpec: OpenCodeLaunchSpec | null): AgentSdkDetection {
  const whichCmd = process.platform === 'win32' ? 'where' : 'which'
  const check = (binary: string): boolean => {
    try {
      const result = execFileSync(whichCmd, [binary], {
        encoding: 'utf-8',
        timeout: 5000,
        env: process.env
      }).trim()
      const resolved = result.split('\n')[0].trim()
      return !!resolved && existsSync(resolved)
    } catch {
      return false
    }
  }

  const resolvedCodexBinary = resolveCodexBinaryPath()
  const mistralVibePath = resolveMistralVibeAcpBinaryPath()
  const cursorCliPath = resolveCursorCliAgentBinaryPath()
  const antigravityPath = resolveAntigravityBinaryPath()

  return {
    opencode: openCodeLaunchSpec !== null,
    claude: check('claude'),
    codex: !!resolvedCodexBinary && supportsCodexAppServer(resolvedCodexBinary),
    mistralVibe: !!mistralVibePath && existsSync(mistralVibePath),
    cursorCli: !!cursorCliPath && existsSync(cursorCliPath),
    antigravity: !!antigravityPath && existsSync(antigravityPath),
    antigravityVersion: antigravityPath ? getAntigravityVersion(antigravityPath) : null
  }
}

export function getAppPaths(): AppPaths {
  return {
    userData: app.getPath('userData'),
    home: app.getPath('home'),
    logs: getLogDir()
  }
}

export function getAppVersion(): string {
  return app.getVersion()
}
