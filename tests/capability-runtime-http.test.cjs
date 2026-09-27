const { test } = require('node:test')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { mkdtempSync, rmSync, existsSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve, sep } = require('node:path')
const { createServer } = require('node:net')
const { createServer: createHttpServer } = require('node:http')
const { once } = require('node:events')
const Module = require('node:module')
const esbuild = require('esbuild')

const root = resolve(__dirname, '..')
const binary = join(root, 'out', 'runtime-package', process.platform === 'win32' ? 'octob-runtime.exe' : 'octob-runtime')

async function availablePort() {
  const server = createServer()
  await new Promise((resolveReady) => server.listen(0, '127.0.0.1', resolveReady))
  const port = server.address().port
  await new Promise((resolveClosed) => server.close(resolveClosed))
  return port
}

test('standalone web runtime serves and executes a validated capability', { skip: !existsSync(binary), timeout: 30_000 }, async () => {
  const temp = mkdtempSync(join(tmpdir(), 'octob-capability-http-'))
  let child
  let studio
  let webhook
  try {
    const received = []
    webhook = createHttpServer(async (request, response) => {
      let body = ''
      for await (const chunk of request) body += chunk
      received.push({ method: request.method, body })
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ accepted: true }))
    })
    webhook.listen(0, '127.0.0.1')
    await once(webhook, 'listening')
    const webhookUrl = `http://127.0.0.1:${webhook.address().port}/target`
    const bundle = join(temp, 'studio.cjs')
    esbuild.buildSync({
      entryPoints: [join(root, 'src/main/services/capability-studio.ts')],
      outfile: bundle, bundle: true, platform: 'node', format: 'cjs', target: 'node20',
      external: ['better-sqlite3', 'electron'], tsconfig: join(root, 'tsconfig.runtime.json')
    })
    const sqlitePath = join(root, 'runtime-host', 'node_modules', 'better-sqlite3')
    const originalLoad = Module._load
    Module._load = function(request, parent, isMain) {
      return originalLoad.call(this, request === 'better-sqlite3' ? sqlitePath : request, parent, isMain)
    }
    const { CapabilityStudio } = require(bundle)
    Module._load = originalLoad
    studio = new CapabilityStudio(join(temp, '.octob', 'capability-studio.db'))
    const draft = studio.create('Tela para conectar WhatsApp', {
      name: 'whatsapp.connection.http', description: 'WhatsApp simulado', provider: 'whatsapp',
      screens: ['connection'], actions: ['connect'], requiredSecrets: [], externalWrites: []
    })
    studio.addVersion(draft.id, {
      html: '<button>Conectar</button>', css: '', javascript: '',
      files: { 'lib.js': 'module.exports = () => "from-file"' },
      handler: 'async (input, api) => { if (input.action === "post") { const response = await fetch(input.url, { method: "POST", body: input.body }); return { status: response.status, body: await response.json(), source: require("./lib.js")() } } return { status: input.action, mock: api.mock("whatsapp") } }',
      tests: [
        { name: 'simulated connect', input: { action: 'connect' }, expected: { status: 'connect', mock: { simulated: true, key: 'whatsapp' } } },
        { name: 'post contract', input: { action: 'post', url: webhookUrl, body: 'hello' }, httpMocks: [{ url: webhookUrl, method: 'POST', body: { accepted: true } }], expected: { status: 200, body: { accepted: true }, source: 'from-file' } }
      ]
    })
    assert.equal((await studio.validate(draft.id)).ok, true)
    studio.close()
    studio = null

    const port = await availablePort()
    const base = `http://127.0.0.1:${port}`
    child = spawn(binary, ['--no-open'], {
      env: { ...process.env, USERPROFILE: temp, HOME: temp, OCTOB_RUNTIME_PORT: String(port), OCTOB_RUNTIME_HOST: '127.0.0.1', OCTOB_OPEN_BROWSER: '0' },
      stdio: 'ignore', windowsHide: true
    })
    let ready = false
    for (let i = 0; i < 100; i++) {
      try {
        const response = await fetch(`${base}/v1/health`)
        if (response.ok) { ready = true; break }
      } catch {}
      await new Promise((resolveWait) => setTimeout(resolveWait, 100))
    }
    assert.equal(ready, true, 'runtime did not start')
    const sessionResponse = await fetch(`${base}/v1/session`, { method: 'POST' })
    const session = await sessionResponse.json()
    const auth = { authorization: `Bearer ${session.token}`, 'content-type': 'application/json' }
    const listResponse = await fetch(`${base}/v1/capability-studio`, { headers: auth })
    assert.equal(listResponse.status, 200)
    const drafts = await listResponse.json()
    assert.equal(drafts[0].id, draft.id)
    const executeResponse = await fetch(`${base}/v1/capability-studio/${draft.id}/execute`, {
      method: 'POST', headers: auth, body: JSON.stringify({ input: { action: 'connect' }, version: 1 })
    })
    assert.equal(executeResponse.status, 200)
    assert.deepEqual(await executeResponse.json(), { status: 'connect', mock: { simulated: true, key: 'whatsapp' } })
    const postResponse = await fetch(`${base}/v1/capability-studio/${draft.id}/execute`, {
      method: 'POST', headers: auth, body: JSON.stringify({ input: { action: 'post', url: webhookUrl, body: 'hello' }, version: 1 })
    })
    assert.equal(postResponse.status, 200)
    assert.deepEqual(await postResponse.json(), { status: 200, body: { accepted: true }, source: 'from-file' })
    assert.deepEqual(received, [{ method: 'POST', body: 'hello' }])
    const installResponse = await fetch(`${base}/v1/capability-studio/${draft.id}/install`, {
      method: 'POST', headers: auth, body: JSON.stringify({ version: 1 })
    })
    assert.equal((await installResponse.json()).installedVersion, 1)
  } finally {
    studio?.close()
    if (webhook) {
      const closed = once(webhook, 'close')
      webhook.close()
      await closed
    }
    if (child && child.exitCode === null) {
      const exited = once(child, 'exit')
      child.kill()
      await exited
    }
    if (resolve(temp).startsWith(resolve(tmpdir()) + sep) && temp.includes('octob-capability-http-')) {
      for (let attempt = 0; attempt < 5; attempt++) {
        try { rmSync(temp, { recursive: true, force: true }); break }
        catch (error) {
          if (attempt === 4) throw error
          await new Promise((resolveWait) => setTimeout(resolveWait, 100))
        }
      }
    }
  }
})
