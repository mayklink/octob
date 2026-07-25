'use strict'

const fs = require('fs')
const path = require('path')

/** @param {string} root */
function readPkgVersion(root, name) {
  try {
    const j = fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8')
    return JSON.parse(j).version
  } catch {
    return 'missing'
  }
}

/** Bumps when rebuild strategy changes — invalidates stale markers (e.g. wrong-ABI prebuilds). */
const REBUILD_STRATEGY_ID = 'electron-rebuild-split-pty-sqlite-v3'

/** Fingerprint natives rebuilt for Electron (electron + key native addons). */
function getFingerprint(root) {
  const electron = readPkgVersion(root, 'electron')
  const betterSqlite3 = readPkgVersion(root, 'better-sqlite3')
  const nodePty = readPkgVersion(root, 'node-pty')
  return `${electron}|${betterSqlite3}|${nodePty}|${REBUILD_STRATEGY_ID}`
}

function markerPath(root) {
  return path.join(root, 'node_modules', '.octob-electron-native-fingerprint')
}

/** @param {string} root */
function readMarker(root) {
  try {
    return fs.readFileSync(markerPath(root), 'utf8').trim()
  } catch {
    return ''
  }
}

/** @param {string} root @param {string} fp */
function writeMarker(root, fp) {
  try {
    fs.writeFileSync(markerPath(root), `${fp}\n`, 'utf8')
  } catch {
    /* non-fatal */
  }
}

module.exports = {
  getFingerprint,
  readMarker,
  writeMarker,
  markerPath,
}
