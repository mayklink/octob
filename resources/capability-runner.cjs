// Capability code runs in a separate Node process with normal Node APIs.
// Contract tests can replace HTTP responses; preview executions use real I/O.
const { createRequire } = require('node:module')
const { join } = require('node:path')

let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  raw += chunk
  if (raw.length > 10 * 1024 * 1024) process.exit(2)
})
process.stdin.on('end', async () => {
  try {
    const request = JSON.parse(raw)
    if (typeof request.handler !== 'string' || request.handler.length > 5 * 1024 * 1024) {
      throw new Error('invalid_handler')
    }
    if (request.artifactDirectory) process.chdir(request.artifactDirectory)
    const testMode = Object.prototype.hasOwnProperty.call(request, 'httpMocks')
    const httpMocks = testMode && Array.isArray(request.httpMocks) ? request.httpMocks : []
    const nativeFetch = globalThis.fetch
    const capabilityFetch = async (url, options = {}) => {
      if (!testMode) return nativeFetch(url, options)
      const target = String(url)
      const method = String(options.method || 'GET').toUpperCase()
      const match = httpMocks.find((item) => item.url === target && String(item.method || 'GET').toUpperCase() === method)
      if (!match) throw new Error(`Unmocked HTTP request during validation: ${method} ${target}`)
      const body = typeof match.body === 'string' ? match.body : JSON.stringify(match.body ?? null)
      return new Response(body, {
        status: match.status ?? 200,
        headers: match.headers ?? { 'content-type': 'application/json' }
      })
    }
    globalThis.fetch = capabilityFetch
    const api = Object.freeze({
      fetch: capabilityFetch,
      mock: (key) => Object.freeze({ simulated: true, key: String(key) })
    })
    const capabilityRequire = request.artifactDirectory
      ? createRequire(join(request.artifactDirectory, 'capability-entry.cjs'))
      : require
    let execute
    if (/\b(?:module\.exports|exports\.)/.test(request.handler)) {
      const module = { exports: {} }
      new Function('module', 'exports', 'require', 'process', 'fetch', 'Buffer', request.handler)(
        module, module.exports, capabilityRequire, process, capabilityFetch, Buffer
      )
      execute = module.exports.default || module.exports
    } else {
      execute = new Function('require', 'process', 'fetch', 'Buffer', `return (${request.handler})`)(
        capabilityRequire, process, capabilityFetch, Buffer
      )
    }
    if (typeof execute !== 'function') throw new Error('Capability must export a function')
    const result = await execute(request.input, api)
    process.stdout.write(JSON.stringify({ ok: true, result }) + '\n')
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, error: String(error && error.message || error) }) + '\n')
  }
})
