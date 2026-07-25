'use strict'

/**
 * Two-phase Electron native rebuild:
 *  - better-sqlite3: electron-rebuild can use prebuilt binaries (no MSVC on Windows).
 *  - node-pty: often requires local compile — optional on Windows dev without toolchain (lazy-loaded in main).
 */
const fs = require('fs')
const { spawnSync } = require('child_process')
const path = require('path')

function cliPath(root) {
  const direct = path.join(root, 'node_modules', '@electron', 'rebuild', 'lib', 'cli.js')
  try {
    if (fs.statSync(direct).isFile()) return direct
  } catch {
    /* continue */
  }
  try {
    return require.resolve('@electron/rebuild/lib/cli.js', { paths: [root] })
  } catch {
    return null
  }
}

/** @returns {number} exit code — 0 = success */
function runPhase(root, onlyModule, label) {
  const cli = cliPath(root)
  if (!cli) {
    console.error('[octob] Missing @electron/rebuild — run yarn install')
    return 1
  }
  console.warn(`[octob] ${label}`)
  const r = spawnSync(
    process.execPath,
    [cli, '--force', '--sequential', '--only', onlyModule],
    { cwd: root, stdio: 'inherit', env: process.env }
  )
  return r.status ?? 1
}

/**
 * Rebuild natives for Electron. On Windows dev without MSVC, SQLite must succeed;
 * node-pty may fail (terminal disabled until toolchain + yarn rebuild:app-deps).
 * @returns {{ sqlite: number, nodePty: number }}
 */
function runElectronNativeRebuild(rootArg) {
  const root = rootArg || path.join(__dirname, '..')

  const sqliteCode = runPhase(root, 'better-sqlite3', 'Rebuilding better-sqlite3 for Electron …')
  let nodePtyCode = 0
  if (sqliteCode === 0) {
    nodePtyCode = runPhase(root, 'node-pty', 'Rebuilding node-pty for Electron …')
  }

  return { sqlite: sqliteCode, nodePty: nodePtyCode }
}

module.exports = {
  runElectronNativeRebuild,
  runPhase,
  cliPath,
}

if (require.main === module) {
  const root = path.join(__dirname, '..')
  const { getFingerprint, writeMarker } = require('./electron-native-fingerprint.cjs')
  const fp = getFingerprint(root)
  const ptyUnavailableMarker = `${fp}|pty-unavailable`

  const { sqlite, nodePty } = runElectronNativeRebuild(root)
  const inCi =
    process.env.CI === 'true' ||
    process.env.CI === '1' ||
    !!process.env.GITHUB_ACTIONS ||
    !!process.env.GITLAB_CI ||
    !!process.env.TF_BUILD

  if (sqlite !== 0) process.exit(sqlite)

  if (nodePty !== 0 && process.platform === 'win32' && !inCi) {
    console.warn('')
    console.warn('[octob] node-pty rebuild skipped (embedded terminal unavailable until MSVC is installed).')
    console.warn('[octob] App and SQLite DB will still work.')
    console.warn('')
    writeMarker(root, ptyUnavailableMarker)
    process.exit(0)
  }

  if (nodePty !== 0) process.exit(nodePty)

  writeMarker(root, fp)
  process.exit(0)
}
