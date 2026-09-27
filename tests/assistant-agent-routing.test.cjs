const { test } = require('node:test')
const assert = require('node:assert/strict')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { mkdtempSync, rmSync } = require('node:fs')
const esbuild = require('esbuild')

const root = resolve(__dirname, '..')
const temp = mkdtempSync(join(tmpdir(), 'octob-agent-routing-test-'))
const bundle = join(temp, 'routing.cjs')
esbuild.buildSync({
  entryPoints: [join(root, 'src/main/services/assistant-agent-routing.ts')],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20'
})
const { resolveDelegationAgentSdk } = require(bundle)

test('explicitly requested agent overrides the saved default', () => {
  const settings = { getSetting: () => JSON.stringify({ defaultAgentSdk: 'codex' }) }
  assert.equal(resolveDelegationAgentSdk(settings, 'claude-code'), 'claude-code')
})

test('omitted agent uses the saved default', () => {
  const settings = { getSetting: () => JSON.stringify({ defaultAgentSdk: 'codex' }) }
  assert.equal(resolveDelegationAgentSdk(settings), 'codex')
})

test('invalid or unreadable settings use the stable fallback', () => {
  assert.equal(resolveDelegationAgentSdk({ getSetting: () => '{' }), 'opencode')
  assert.equal(resolveDelegationAgentSdk({ getSetting: () => JSON.stringify({ defaultAgentSdk: 'terminal' }) }), 'opencode')
})

process.once('exit', () => rmSync(temp, { recursive: true, force: true }))
