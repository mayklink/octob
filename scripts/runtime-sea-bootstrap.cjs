const Module = require('node:module')
const path = require('node:path')

const runtimeDir = path.dirname(process.execPath)
const nativeRoot = path.join(runtimeDir, 'runtime-host', 'node_modules')
const bundlePath = path.join(runtimeDir, 'index.cjs')
const originalResolveFilename = Module._resolveFilename
const nativeModules = new Set(['better-sqlite3', 'node-pty'])

Module._resolveFilename = function(request, parent, isMain, options) {
  if (typeof request === 'string' && nativeModules.has(request)) {
    request = path.join(nativeRoot, request)
  }
  return originalResolveFilename.call(this, request, parent, isMain, options)
}

process.chdir(runtimeDir)
process.env.OCTOB_RESOURCE_DIR ??= path.join(runtimeDir, 'resources')
process.env.OCTOB_WEB_DIR ??= path.join(runtimeDir, 'web')
if (!process.argv.includes('--no-open')) {
  process.env.OCTOB_OPEN_BROWSER ??= '1'
}

const fileRequire = Module.createRequire(process.execPath)
fileRequire(bundlePath)
