const { test } = require('node:test')
const assert = require('node:assert/strict')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { mkdtempSync, rmSync } = require('node:fs')
const esbuild = require('esbuild')

const root = resolve(__dirname, '..')
const temp = mkdtempSync(join(tmpdir(), 'octob-global-context-test-'))
const bundle = join(temp, 'context.cjs')
esbuild.buildSync({
  entryPoints: [join(root, 'src/main/services/global-assistant-context-state.ts')],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  tsconfig: join(root, 'tsconfig.runtime.json')
})
const { globalAssistantContextSessionKey, hasGlobalAssistantContext, markGlobalAssistantContext } = require(bundle)

test('global operating context is recorded by stable Octob session and survives service recreation', () => {
  const values = new Map()
  const makeDb = () => ({
    getSetting: (key) => values.get(key) ?? null,
    setSetting: (key, value) => values.set(key, value)
  })
  const key = globalAssistantContextSessionKey('/assistant', 'octob-session-1')
  assert.equal(hasGlobalAssistantContext(makeDb(), key), false)
  markGlobalAssistantContext(makeDb(), key)
  assert.equal(hasGlobalAssistantContext(makeDb(), key), true)
  assert.equal(hasGlobalAssistantContext(makeDb(), globalAssistantContextSessionKey('/assistant', 'octob-session-2')), false)
})

process.once('exit', () => rmSync(temp, { recursive: true, force: true }))
