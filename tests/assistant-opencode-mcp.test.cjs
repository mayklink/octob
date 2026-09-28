const { test } = require('node:test')
const assert = require('node:assert/strict')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { mkdtempSync, rmSync } = require('node:fs')
const esbuild = require('esbuild')

const root = resolve(__dirname, '..')
const temp = mkdtempSync(join(tmpdir(), 'octob-opencode-mcp-test-'))
const bundle = join(temp, 'binding.cjs')
esbuild.buildSync({
  entryPoints: [join(root, 'src/main/services/assistant-opencode-mcp.ts')],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20'
})
const { bindAssistantMcpToOpenCode } = require(bundle)

test('binds Octob MCP only to the assistant workspace directory', async () => {
  const calls = []
  const client = { mcp: { add: async (options) => {
    calls.push(options)
    return { data: { octob: { status: 'connected' } } }
  } } }
  const assistantPath = join(temp, 'assistant')
  const projectPath = join(temp, 'project')
  const url = 'http://127.0.0.1:3210/mcp'

  assert.equal(await bindAssistantMcpToOpenCode(client, projectPath, assistantPath, url), false)
  assert.equal(calls.length, 0)
  assert.equal(await bindAssistantMcpToOpenCode(client, assistantPath, assistantPath, url), true)
  assert.deepEqual(calls[0], {
    query: { directory: assistantPath },
    body: { name: 'octob', config: { type: 'remote', url, enabled: true, oauth: false } }
  })
})

test('reports an MCP connection failure', async () => {
  const client = { mcp: { add: async () => ({ data: { octob: { status: 'failed', error: 'unreachable' } } }) } }
  await assert.rejects(
    bindAssistantMcpToOpenCode(client, temp, temp, 'http://127.0.0.1:3210/mcp'),
    /unreachable/
  )
})

process.once('exit', () => rmSync(temp, { recursive: true, force: true }))
