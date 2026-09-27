const { test } = require('node:test')
const assert = require('node:assert/strict')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { mkdtempSync, rmSync } = require('node:fs')
const esbuild = require('esbuild')

const root = resolve(__dirname, '..')
const temp = mkdtempSync(join(tmpdir(), 'octob-project-selection-test-'))
const bundle = join(temp, 'selection.cjs')
esbuild.buildSync({
  entryPoints: [join(root, 'src/main/services/assistant-project-selection.ts')],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  tsconfig: join(root, 'tsconfig.runtime.json')
})
const { AssistantProjectSelectionManager } = require(bundle)

test('project selection grants are scoped, consumed once, and invalid attempts do not consume them', async () => {
  const manager = new AssistantProjectSelectionManager()
  const request = {
    id: 'request-1',
    projects: [{ id: 'project-a', name: 'A', path: '/a' }],
    title: 'Choose a repository'
  }
  const pending = manager.request(request, () => undefined)
  assert.equal(manager.resolve(request.id, 'project-a'), true)
  const selected = await pending
  assert.ok(selected.selectionToken)
  assert.equal(manager.consume([selected.selectionToken], ['project-b']), false)
  assert.equal(manager.consume([selected.selectionToken], ['project-a']), true)
  assert.equal(manager.consume([selected.selectionToken], ['project-a']), false)
  assert.equal(manager.resolve(request.id, 'project-a'), false)
})

test('pending project selections expire and can be cancelled', async () => {
  const manager = new AssistantProjectSelectionManager()
  const timedOut = manager.request({ id: 'timeout', projects: [], title: 'Pick' }, () => undefined, { timeoutMs: 10 })
  assert.equal(await timedOut, null)
  assert.deepEqual(manager.listPending(), [])

  const controller = new AbortController()
  const cancelled = manager.request({ id: 'cancel', projects: [], title: 'Pick' }, () => undefined, { signal: controller.signal })
  controller.abort()
  assert.equal(await cancelled, null)
  assert.deepEqual(manager.listPending(), [])
})

process.once('exit', () => rmSync(temp, { recursive: true, force: true }))
