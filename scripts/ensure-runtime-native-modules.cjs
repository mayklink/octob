const { spawnSync } = require('node:child_process')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const runtimeHost = path.join(root, 'runtime-host')

function runtimeModule(name) {
  return path.join(runtimeHost, 'node_modules', name)
}

function verify() {
  const Database = require(runtimeModule('better-sqlite3'))
  const db = new Database(':memory:')
  db.prepare('select 1').get()
  db.close()

  const pty = require(runtimeModule('node-pty'))
  if (typeof pty.spawn !== 'function') {
    throw new Error('node-pty native module did not expose spawn()')
  }
}

try {
  verify()
  console.log('[octob] Runtime native modules are ready for Node.')
  process.exit(0)
} catch (firstError) {
  console.log('[octob] Preparing isolated runtime native modules...')
}

const install = process.platform === 'win32'
  ? spawnSync(
      process.env.ComSpec ?? 'cmd.exe',
      ['/d', '/s', '/c', 'npm ci --no-audit --no-fund'],
      {
        cwd: runtimeHost,
        stdio: 'inherit'
      }
    )
  : spawnSync('npm', ['ci', '--no-audit', '--no-fund'], {
      cwd: runtimeHost,
      stdio: 'inherit'
    })

if (install.error || install.status !== 0) {
  console.error(
    '[octob] Failed to install runtime native modules.',
    install.error?.message ?? `exit ${install.status}`
  )
  process.exit(install.status ?? 1)
}

try {
  verify()
  console.log('[octob] Runtime native modules installed successfully.')
} catch (error) {
  console.error(
    '[octob] Runtime native module verification failed:',
    error instanceof Error ? error.message : String(error)
  )
  process.exit(1)
}
