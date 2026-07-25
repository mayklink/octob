'use strict'

/**
 * Postinstall: rebuild better-sqlite3 + node-pty for Electron.
 * Windows without MSVC: SQLite must succeed; node-pty may be skipped with a marker suffix.
 */
const path = require('path')
const { getFingerprint, writeMarker } = require('./electron-native-fingerprint.cjs')
const { runElectronNativeRebuild } = require('./run-electron-native-rebuild.cjs')

const root = path.join(__dirname, '..')

const fp = getFingerprint(root)
const ptyUnavailableMarker = `${fp}|pty-unavailable`

const { sqlite, nodePty } = runElectronNativeRebuild(root)

function inCi() {
  return (
    process.env.CI === 'true' ||
    process.env.CI === '1' ||
    !!process.env.GITHUB_ACTIONS ||
    !!process.env.GITLAB_CI ||
    !!process.env.TF_BUILD
  )
}

if (sqlite !== 0) {
  if (process.platform === 'win32' && !inCi()) {
    console.warn('[octob] postinstall: SQLite native rebuild failed — check toolchain or reinstall.')
  }
  process.exit(sqlite)
}

if (nodePty !== 0 && process.platform === 'win32' && !inCi()) {
  console.warn('')
  console.warn('[octob] node-pty not rebuilt — run yarn rebuild:app-deps after installing Visual Studio Build Tools (C++).')
  console.warn('')
  try {
    writeMarker(root, ptyUnavailableMarker)
  } catch {
    /* noop */
  }
  process.exit(0)
}

if (nodePty !== 0) {
  process.exit(nodePty)
}

try {
  writeMarker(root, fp)
} catch {
  /* noop */
}
process.exit(0)
