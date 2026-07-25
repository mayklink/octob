import { createLogger } from './logger'
import { resolveClaudeBinaryPath } from './claude-binary-resolver'
import {
  TITLE_SYSTEM_PROMPT,
  TITLE_JSON_SCHEMA,
  TITLE_TIMEOUT_MS,
  MAX_MESSAGE_LENGTH,
  sanitizeTitle,
  extractTitleFromJSON,
  spawnCLI
} from './title-generation-shared'

const log = createLogger({ component: 'ClaudeSessionTitle' })

/**
 * Generate a short session title by spawning `claude -p`.
 * Returns the generated title, or null if generation fails for any reason.
 */
export async function generateSessionTitle(
  message: string,
  claudeBinaryPath?: string | null
): Promise<string | null> {
  log.info('generateSessionTitle: called', {
    messageLength: message.length,
    claudeBinaryPath: claudeBinaryPath ?? '(not provided)'
  })

  const truncatedMessage =
    message.length > MAX_MESSAGE_LENGTH ? message.slice(0, MAX_MESSAGE_LENGTH) + '...' : message

  const prompt = TITLE_SYSTEM_PROMPT + '\n\nUser message:\n' + truncatedMessage

  const resolvedBinary = resolveClaudeBinaryPath()
  const binary = claudeBinaryPath || resolvedBinary || 'claude'
  log.info('generateSessionTitle: resolved binary', {
    provided: claudeBinaryPath ?? '(null)',
    resolved: resolvedBinary ?? '(null)',
    using: binary
  })

  const args = [
    '-p',
    '--output-format', 'json',
    '--json-schema', TITLE_JSON_SCHEMA,
    '--model', 'haiku',
    '--effort', 'low',
    '--dangerously-skip-permissions',
    '--no-session-persistence',
    '--tools', '',
  ]

  try {
    log.info('generateSessionTitle: spawning CLI', {
      binary,
      argsPreview: args.slice(0, 6).join(' ') + '...',
      promptLength: prompt.length
    })

    const stdout = await spawnCLI(binary, args, prompt, TITLE_TIMEOUT_MS)

    log.info('generateSessionTitle: CLI returned', {
      stdoutLength: stdout.length,
      stdoutPreview: stdout.slice(0, 200)
    })

    const rawTitle = extractTitleFromJSON(stdout)
    log.info('generateSessionTitle: extractTitleFromJSON result', { rawTitle })

    if (!rawTitle) {
      log.warn('generateSessionTitle: could not extract title from CLI output', {
        stdoutPreview: stdout.slice(0, 300)
      })
      return null
    }

    const title = sanitizeTitle(rawTitle)
    log.info('generateSessionTitle: sanitizeTitle result', { rawTitle, title })

    if (title) {
      log.info('generateSessionTitle: success', { title })
      return title
    }

    log.warn('generateSessionTitle: empty title after sanitization', { rawTitle })
    return null
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err)
    const errStack = err instanceof Error ? err.stack : undefined
    log.warn('generateSessionTitle: CLI spawn failed', { error: errMsg, stack: errStack, binary })
    return null
  }
}
