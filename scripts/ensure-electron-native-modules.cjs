'use strict'

/**
 * Ensures better-sqlite3 is rebuilt for Electron. node-pty is optional on Windows without MSVC.
 */
const fs = require('fs')
const path = require('path')
const { getFingerprint, readMarker, writeMarker } = require('./electron-native-fingerprint.cjs')
const { runElectronNativeRebuild } = require('./run-electron-native-rebuild.cjs')

const root = path.join(__dirname, '..')

if (process.env.OCTOB_SKIP_NATIVE_ENSURE === '1') {
  console.warn('[octob] Skipping Electron native alignment (OCTOB_SKIP_NATIVE_ENSURE=1)')
  process.exit(0)
}

const fp = getFingerprint(root)
const raw = readMarker(root)
const ptyUnavailableMarker = `${fp}|pty-unavailable`

function sqliteBinaryMissingOrStale() {
  const sqlite = path.join(root, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node')
  try {
    if (!fs.statSync(sqlite).isFile()) return true
  } catch {
    return true
  }
  return false
}

function inCi() {
  return (
    process.env.CI === 'true' ||
    process.env.CI === '1' ||
    !!process.env.GITHUB_ACTIONS ||
    !!process.env.GITLAB_CI ||
    !!process.env.TF_BUILD
  )
}

if (raw === fp && !sqliteBinaryMissingOrStale()) {
  process.exit(0)
}

// SQLite is fine; terminal addon was skipped earlier — do not run node-gyp on every yarn dev.
if (raw === ptyUnavailableMarker && !sqliteBinaryMissingOrStale()) {
  process.exit(0)
}

const { sqlite, nodePty } = runElectronNativeRebuild(root)

if (sqlite !== 0) {
  console.error('')
  console.error('[octob] better-sqlite3 rebuild failed.')
  if (process.platform === 'win32') {
    console.error(
      '[octob] On Windows ensure Visual Studio Build Tools with "Desktop development with C++" if prebuild fails.'
    )
    console.error('[octob] https://visualstudio.microsoft.com/visual-cpp-build-tools/')
  }
  console.error('')
  process.exit(sqlite)
}

if (nodePty !== 0 && process.platform === 'win32' && !inCi()) {
  console.warn('')
  console.warn(
    '[octob] node-pty not rebuilt — embedded terminals disabled until you install MSVC and run yarn rebuild:app-deps'
  )
  console.warn('')
  writeMarker(root, ptyUnavailableMarker)
  process.exit(0)
}

if (nodePty !== 0) {
  console.error('')
  console.error('[octob] node-pty rebuild failed.')
  process.exit(nodePty)
}

writeMarker(root, fp)
process.exit(0)
