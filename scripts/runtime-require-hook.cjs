const Module = require('node:module')
const path = require('node:path')

const originalResolveFilename = Module._resolveFilename
const sharedRoot = path.resolve(__dirname, '..', 'out', 'runtime-node', 'shared')

Module._resolveFilename = function(request, parent, isMain, options) {
  if (typeof request === 'string' && request.startsWith('@shared/')) {
    request = path.join(sharedRoot, request.slice('@shared/'.length))
  }
  return originalResolveFilename.call(this, request, parent, isMain, options)
}
