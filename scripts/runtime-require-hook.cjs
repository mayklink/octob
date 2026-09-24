const Module = require('node:module')
const path = require('node:path')

const originalResolveFilename = Module._resolveFilename
const root = path.resolve(__dirname, '..')
const sharedRoot = path.join(root, 'out', 'runtime-node', 'shared')
const runtimeHostModules = path.join(root, 'runtime-host', 'node_modules')
const nativeRuntimeModules = new Set(['better-sqlite3', 'node-pty'])

Module._resolveFilename = function(request, parent, isMain, options) {
  if (typeof request === 'string' && request.startsWith('@shared/')) {
    request = path.join(sharedRoot, request.slice('@shared/'.length))
  } else if (typeof request === 'string' && nativeRuntimeModules.has(request)) {
    request = path.join(runtimeHostModules, request)
  }
  return originalResolveFilename.call(this, request, parent, isMain, options)
}
