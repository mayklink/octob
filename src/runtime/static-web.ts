import { createReadStream, existsSync, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, resolve, sep } from 'node:path'

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.lottie': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
}

function webRoot(): string | null {
  const value = process.env.OCTOB_WEB_DIR?.trim()
  return value ? resolve(value) : null
}

function safeAssetPath(root: string, pathname: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }

  const relative = decoded === '/' ? 'web.html' : decoded.replace(/^[/\\]+/, '')
  const target = resolve(root, relative)
  if (target !== root && !target.startsWith(root + sep)) return null
  return target
}

export function serveStaticWeb(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL
): boolean {
  const root = webRoot()
  if (!root || !existsSync(root)) return false
  if (request.method !== 'GET' && request.method !== 'HEAD') return false
  if (url.pathname.startsWith('/v1/')) return false

  let target = safeAssetPath(root, url.pathname)
  if (!target) {
    response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Invalid path')
    return true
  }

  if (!existsSync(target) || !statSync(target).isFile()) {
    const acceptsHtml = String(request.headers.accept ?? '').includes('text/html')
    const fallback = resolve(root, 'web.html')
    if (acceptsHtml && existsSync(fallback)) {
      target = fallback
    } else {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('Not found')
      return true
    }
  }

  const extension = extname(target).toLowerCase()
  const isHtml = extension === '.html'
  response.writeHead(200, {
    'content-type': CONTENT_TYPES[extension] ?? 'application/octet-stream',
    'cache-control': isHtml ? 'no-store' : 'public, max-age=31536000, immutable'
  })

  if (request.method === 'HEAD') {
    response.end()
    return true
  }

  const stream = createReadStream(target)
  stream.once('error', () => {
    if (!response.headersSent) response.writeHead(500)
    response.end()
  })
  stream.pipe(response)
  return true
}
