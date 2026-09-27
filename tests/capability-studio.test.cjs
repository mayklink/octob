const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { createServer } = require('node:http')
const { once } = require('node:events')
const Module = require('node:module')
const esbuild = require('esbuild')

const root = resolve(__dirname, '..')
const temp = mkdtempSync(join(tmpdir(), 'octob-capability-test-'))
const bundle = join(temp, 'studio.cjs')
esbuild.buildSync({
  entryPoints: [join(root, 'src/main/services/capability-studio.ts')],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['better-sqlite3', 'electron'],
  tsconfig: join(root, 'tsconfig.runtime.json')
})

const nativeSqlite = [
  join(root, 'runtime-host', 'node_modules', 'better-sqlite3'),
  join(root, 'node_modules', 'better-sqlite3')
].find((candidate) => {
  try {
    const Sqlite = require(candidate)
    const db = new Sqlite(':memory:')
    db.close()
    return true
  } catch { return false }
})
if (!nativeSqlite) throw new Error('A Node-compatible better-sqlite3 build is required for this test')
const originalLoad = Module._load
Module._load = function(request, parent, isMain) {
  return originalLoad.call(this, request === 'better-sqlite3' ? nativeSqlite : request, parent, isMain)
}
const { CapabilityStudio, runCapabilityHandler, MAX_CAPABILITY_TIMEOUT_MS, MAX_CAPABILITY_STDERR_CHARS, pruneCapabilityExecutions } = require(bundle)
Module._load = originalLoad

test('WhatsApp mock: draft, validation, preview execution, revision, install and discard', async () => {
  const dbPath = join(temp, 'capabilities.db')
  let studio = new CapabilityStudio(dbPath)
  const spec = {
    name: 'whatsapp.connection.demo',
    description: 'Tela experimental de conexão WhatsApp',
    provider: 'whatsapp',
    screens: ['connection'], actions: ['connect'], requiredSecrets: [], externalWrites: []
  }
  const draft = studio.create('Quero uma tela para integrar com WhatsApp', spec)
  const artifact = (label) => ({
    html: '<main><h1>WhatsApp</h1><button id="connect">Conectar</button><output id="status"></output></main>',
    css: 'main { padding: 24px }',
    javascript: "document.getElementById('connect').onclick = async () => { const result = await window.capability.call({action:'connect'}); document.getElementById('status').textContent = result.status }",
    handler: `async (input, api) => input.action === 'connect' ? { status: '${label}', mock: api.mock('whatsapp') } : { status: 'idle' }`,
    tests: [{ name: 'conecta em modo simulado', input: { action: 'connect' }, expected: { status: label, mock: { simulated: true, key: 'whatsapp' } } }]
  })
  assert.equal(studio.addVersion(draft.id, artifact('connected-v1')).version, 1)
  assert.equal((await studio.validate(draft.id)).ok, true)
  assert.deepEqual(await studio.execute(draft.id, { action: 'connect' }), {
    status: 'connected-v1', mock: { simulated: true, key: 'whatsapp' }
  })
  assert.equal(studio.install(draft.id, 1).installedVersion, 1)
  studio.close()
  studio = new CapabilityStudio(dbPath)
  assert.equal(studio.get(draft.id).draft.installedVersion, 1)
  assert.equal(studio.addVersion(draft.id, artifact('connected-v2')).version, 2)
  assert.equal((await studio.validate(draft.id)).ok, true)
  assert.equal((await studio.execute(draft.id, { action: 'connect' })).status, 'connected-v1')
  assert.equal((await studio.execute(draft.id, { action: 'connect' }, 1)).status, 'connected-v1')
  assert.equal((await studio.execute(draft.id, { action: 'connect' }, 2)).status, 'connected-v2')
  assert.equal(studio.install(draft.id, 2).installedVersion, 2)
  assert.equal(studio.install(draft.id, 1).installedVersion, 1)
  studio.deactivate(draft.id)
  studio.discard(draft.id)
  assert.equal(studio.list().length, 0)
  studio.close()
})

test('invalid generated handler never becomes installable', async () => {
  const studio = new CapabilityStudio(join(temp, 'invalid.db'))
  const draft = studio.create('Broken example', {
    name: 'demo.broken', description: 'Broken', screens: [], actions: [], requiredSecrets: [], externalWrites: []
  })
  studio.addVersion(draft.id, {
    html: '<p>Broken</p>', css: '', javascript: '',
    handler: 'async () => { throw new Error("failed") }',
    tests: [{ name: 'must succeed', input: {}, expected: {} }]
  })
  assert.equal((await studio.validate(draft.id)).ok, false)
  assert.throws(() => studio.install(draft.id, 1), /validated/)
  studio.close()
})

test('capability execution enforces the timeout ceiling, cancellation kills the child tree, and stderr is capped', async () => {
  assert.equal(MAX_CAPABILITY_TIMEOUT_MS, 5 * 60_000)
  assert.equal(MAX_CAPABILITY_STDERR_CHARS, 16 * 1024)
  await assert.rejects(runCapabilityHandler('async () => 1', {}, MAX_CAPABILITY_TIMEOUT_MS + 1), /timeoutMs/)

  const marker = join(temp, 'cancelled-child-marker')
  const controller = new AbortController()
  const handler = `async () => {
    const { spawn } = require('node:child_process')
    spawn(process.execPath, ['-e', 'setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(marker)}, "alive"), 500)'], { stdio: 'ignore' })
    await new Promise(() => {})
  }`
  const execution = runCapabilityHandler(handler, {}, 5_000, undefined, undefined, controller.signal)
  setTimeout(() => controller.abort(), 100)
  await assert.rejects(execution, /cancelled/)
  await new Promise((resolve) => setTimeout(resolve, 700))
  assert.equal(require('node:fs').existsSync(marker), false, 'the descendant must not outlive cancellation')

  await assert.rejects(runCapabilityHandler(
    `module.exports = () => { process.stderr.write('x'.repeat(20000), () => process.exit(3)); return new Promise(() => {}) }`,
    {}, 3_000
  ), (error) => error.message.length <= MAX_CAPABILITY_STDERR_CHARS)
})

test('capability execution history pruning keeps the newest rows per draft', () => {
  const db = new (require(nativeSqlite))(':memory:')
  db.exec('CREATE TABLE capability_executions (id TEXT PRIMARY KEY, draft_id TEXT, started_at TEXT)')
  const insert = db.prepare('INSERT INTO capability_executions (id, draft_id, started_at) VALUES (?, ?, ?)')
  for (let index = 0; index < 5; index += 1) insert.run(String(index), 'draft-a', `2026-01-0${index + 1}`)
  insert.run('other', 'draft-b', '2026-01-06')
  pruneCapabilityExecutions(db, 'draft-a', 2)
  assert.deepEqual(db.prepare('SELECT id FROM capability_executions WHERE draft_id = ? ORDER BY id').all('draft-a').map((row) => row.id), ['3', '4'])
  assert.equal(db.prepare('SELECT count(*) AS count FROM capability_executions WHERE draft_id = ?').get('draft-b').count, 1)
  db.close()
})

test('validation stubs HTTP while preview execution sends a real POST to the supplied URL', async () => {
  const requests = []
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    requests.push({ method: request.method, body })
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ received: true }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const url = `http://127.0.0.1:${server.address().port}/any-destination`
  const studio = new CapabilityStudio(join(temp, 'real-http.db'))
  try {
    const draft = studio.create('Send a real webhook', {
      name: 'webhook.send.real', description: 'POST to a URL entered by the user',
      screens: ['form'], actions: ['send'], requiredSecrets: [], externalWrites: ['POST to user URL']
    })
    studio.addVersion(draft.id, {
      html: '<form><input id="url"><button>Send</button></form>', css: '', javascript: '',
      files: { 'lib.js': 'module.exports = (value) => ({ value })' },
      handler: `module.exports = async (input) => {
        const response = await fetch(input.url, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ value: input.value })
        });
        return { status: response.status, body: await response.json(),
          node: require('node:path').basename('/tmp/example'),
          data: require('./lib.js')(input.value) };
      }`,
      tests: [{
        name: 'sends webhook', input: { url, value: 42 },
        httpMocks: [{ url, method: 'POST', status: 200, body: { received: true } }],
        expected: { status: 200, body: { received: true }, node: 'example', data: { value: 42 } }
      }]
    })
    assert.equal((await studio.validate(draft.id)).ok, true)
    assert.equal(requests.length, 0, 'validation must not send the POST')
    assert.deepEqual(await studio.execute(draft.id, { url, value: 42 }), {
      status: 200, body: { received: true }, node: 'example', data: { value: 42 }
    })
    assert.deepEqual(requests, [{ method: 'POST', body: '{"value":42}' }])
  } finally {
    studio.close()
    server.close()
    await once(server, 'close')
  }
})

process.once('exit', () => {
  if (resolve(temp).startsWith(resolve(tmpdir()) + require('node:path').sep) && temp.includes('octob-capability-test-')) {
    rmSync(temp, { recursive: true, force: true })
  }
})
