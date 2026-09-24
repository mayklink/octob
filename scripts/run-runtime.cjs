const { spawn } = require('node:child_process')
const path = require('node:path')

const root = path.join(__dirname, '..')
const entry = path.join(root, 'out', 'runtime-node', 'runtime', 'index.js')
const hook = path.join(__dirname, 'runtime-require-hook.cjs')

const child = spawn(process.execPath, ['-r', hook, entry], {
  stdio: 'inherit',
  env: {
    ...process.env,
    OCTOB_RUNTIME_HOST: process.env.OCTOB_RUNTIME_HOST ?? '127.0.0.1',
    OCTOB_RUNTIME_PORT: process.env.OCTOB_RUNTIME_PORT ?? '47821',
    OCTOB_WEB_DIR: process.env.OCTOB_WEB_DIR ?? path.join(root, 'out', 'web'),
    OCTOB_RESOURCE_DIR: process.env.OCTOB_RESOURCE_DIR ?? path.join(root, 'resources')
  }
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 0)
})
