const { test } = require('node:test')
const assert = require('node:assert/strict')
const { spawn, spawnSync } = require('node:child_process')
const { createServer } = require('node:http')
const { once } = require('node:events')
const { existsSync } = require('node:fs')
const { join } = require('node:path')

const electron = join(__dirname, '..', 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron')

test('Electron can launch the capability runner as a Node child process', { skip: !existsSync(electron), timeout: 15_000 }, () => {
  const child = spawnSync(electron, [join(__dirname, '..', 'resources', 'capability-runner.cjs')], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    input: JSON.stringify({ handler: 'async (input) => ({value: input.value + 1})', input: { value: 2 } }),
    encoding: 'utf8', timeout: 10_000, windowsHide: true
  })
  assert.equal(child.status, 0, child.stderr)
  assert.deepEqual(JSON.parse(child.stdout.trim()), { ok: true, result: { value: 3 } })
})

test('Electron capability runner sends a real POST to the user supplied URL', { skip: !existsSync(electron), timeout: 15_000 }, async () => {
  const received = []
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    received.push({ method: request.method, body })
    response.writeHead(200)
    response.end('ok')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const child = spawn(electron, [join(__dirname, '..', 'resources', 'capability-runner.cjs')], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
    child.stdin.end(JSON.stringify({
      handler: 'async (input) => { const response = await fetch(input.url, { method: "POST", body: input.body }); return { status: response.status, text: await response.text() } }',
      input: { url: `http://127.0.0.1:${server.address().port}/target`, body: 'electron' }
    }))
    const [code] = await once(child, 'close')
    assert.equal(code, 0, stderr)
    assert.deepEqual(JSON.parse(stdout.trim()), { ok: true, result: { status: 200, text: 'ok' } })
    assert.deepEqual(received, [{ method: 'POST', body: 'electron' }])
  } finally {
    const closed = once(server, 'close')
    server.close()
    await closed
  }
})
