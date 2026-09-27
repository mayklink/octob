const { test } = require('node:test')
const assert = require('node:assert/strict')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs')
const esbuild = require('esbuild')

const root = resolve(__dirname, '..')
const temp = mkdtempSync(join(tmpdir(), 'octob-dev-log-reader-'))
const bundle = join(temp, 'dev-log-reader.cjs')
const logDir = join(temp, 'logs')
mkdirSync(logDir)
esbuild.buildSync({
  entryPoints: [join(root, 'src/main/services/dev-log-reader.ts')],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  tsconfig: join(root, 'tsconfig.runtime.json')
})
const { listDevLogFiles, readDevLogPage } = require(bundle)

function entry(day, message, extra = '') {
  return `[2026-09-${day}T12:00:00.000Z] [ERROR] [Renderer] ${message}\n  Stack: stack-${message}${extra}\n`
}

test('log pages group multiline entries and traverse older records without gaps', () => {
  const name = 'octob-2026-09-26.log'
  const text = entry('24', 'primeiro') + entry('25', 'café 🧪') + entry('26', 'último')
  writeFileSync(join(logDir, name), text)

  const recent = readDevLogPage(logDir, name, undefined, 2)
  assert.deepEqual(recent.entries.map((item) => item.message), ['café 🧪\n  Stack: stack-café 🧪', 'último\n  Stack: stack-último'])
  assert.equal(recent.nextBefore, Buffer.byteLength(entry('24', 'primeiro') + entry('25', 'café 🧪'), 'utf8') - Buffer.byteLength(entry('25', 'café 🧪'), 'utf8'))

  const older = readDevLogPage(logDir, name, recent.nextBefore, 2)
  assert.deepEqual(older.entries.map((item) => item.message), ['primeiro\n  Stack: stack-primeiro'])
  assert.equal(older.nextBefore, null)
})

test('log listing excludes unrelated files and reader rejects path traversal', () => {
  writeFileSync(join(logDir, 'perf-diagnostics.jsonl'), '{}\n')
  writeFileSync(join(logDir, 'other.log'), 'not an Octob app log')
  assert.deepEqual(listDevLogFiles(logDir).map((file) => file.name), ['octob-2026-09-26.log'])
  assert.throws(() => readDevLogPage(logDir, '..\\perf-diagnostics.jsonl'), /Invalid log file name/)
})

process.once('exit', () => rmSync(temp, { recursive: true, force: true }))
