const { test } = require('node:test')
const assert = require('node:assert/strict')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { mkdtempSync, mkdirSync, writeFileSync, statSync, existsSync, rmSync } = require('node:fs')
const esbuild = require('esbuild')

const root = resolve(__dirname, '..')
const temp = mkdtempSync(join(tmpdir(), 'octob-logger-rotation-'))
const bundle = join(temp, 'logger.cjs')
const logDir = join(temp, '.octob', 'logs')
mkdirSync(logDir, { recursive: true })
const date = new Date().toISOString().slice(0, 10)
const baseLog = join(logDir, `octob-${date}.log`)
const firstSegment = join(logDir, `octob-${date}-001.log`)
const secondSegment = join(logDir, `octob-${date}-002.log`)
const env = { userProfile: process.env.USERPROFILE, home: process.env.HOME, nodeEnv: process.env.NODE_ENV }

process.env.USERPROFILE = temp
process.env.HOME = temp
process.env.NODE_ENV = 'test'
assert.equal(require('node:os').homedir(), temp)

esbuild.buildSync({
  entryPoints: [join(root, 'src/main/services/logger.ts')],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  tsconfig: join(root, 'tsconfig.runtime.json')
})

test('logger rotates within the same day and preserves the oversized historical file', () => {
  const historicalContents = 'historical'.repeat(600_000)
  writeFileSync(baseLog, historicalContents)

  const { createLogger } = require(bundle)
  const logger = createLogger({ component: 'RotationTest' })
  logger.info('first segment')
  assert.equal(existsSync(firstSegment), true)
  assert.equal(statSync(baseLog).size, Buffer.byteLength(historicalContents))

  logger.info('x'.repeat(5 * 1024 * 1024))
  logger.info('starts next segment')
  assert.equal(existsSync(secondSegment), true)
  assert.ok(statSync(firstSegment).size >= 5 * 1024 * 1024)
})

process.once('exit', () => {
  rmSync(temp, { recursive: true, force: true })
  for (const [key, value] of Object.entries({ USERPROFILE: env.userProfile, HOME: env.home, NODE_ENV: env.nodeEnv })) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})
