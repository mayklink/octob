import type { IncomingMessage, ServerResponse } from 'node:http'
import { getClaudeAccountEmail, getOpenAIAccountEmail } from '../../main/services/account-service'
import { fetchAntigravityUsage } from '../../main/services/antigravity-usage-service'
import { fetchClaudeUsage } from '../../main/services/usage-service'
import { fetchOpenAIUsage } from '../../main/services/openai-usage-service'
import { writeJson } from '../http'

interface UsageRouteContext {
  allowedOrigins: Set<string>
}

export async function handleUsageRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  context: UsageRouteContext
): Promise<boolean> {
  if (!url.pathname.startsWith('/v1/usage/') && !url.pathname.startsWith('/v1/account/')) {
    return false
  }
  if (request.method !== 'GET') return false

  const result =
    url.pathname === '/v1/usage/claude'
      ? await fetchClaudeUsage()
      : url.pathname === '/v1/usage/openai'
        ? await fetchOpenAIUsage()
        : url.pathname === '/v1/usage/antigravity'
          ? await fetchAntigravityUsage()
          : url.pathname === '/v1/account/claude-email'
            ? await getClaudeAccountEmail()
            : url.pathname === '/v1/account/openai-email'
              ? await getOpenAIAccountEmail()
              : undefined

  if (result === undefined) return false
  writeJson(request, response, context.allowedOrigins, 200, result)
  return true
}
