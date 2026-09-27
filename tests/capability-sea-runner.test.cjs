const { test } = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const { join } = require('node:path')

test('packaged runtime enters capability runner mode', { skip: !existsSync(join(__dirname, '..', 'out', 'runtime-package', process.platform === 'win32' ? 'octob-runtime.exe' : 'octob-runtime')) }, () => {
  const binary = join(__dirname, '..', 'out', 'runtime-package', process.platform === 'win32' ? 'octob-runtime.exe' : 'octob-runtime')
  const child = spawnSync(binary, ['--capability-runner'], {
    input: JSON.stringify({ handler: 'async (input, api) => ({ status: input.action, mock: api.mock("whatsapp") })', input: { action: 'connected' } }),
    encoding: 'utf8', timeout: 10_000, windowsHide: true
  })
  assert.equal(child.status, 0, child.stderr)
  assert.deepEqual(JSON.parse(child.stdout.trim()), { ok: true, result: { status: 'connected', mock: { simulated: true, key: 'whatsapp' } } })
})
