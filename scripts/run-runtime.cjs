const { spawn } = require('node:child_process')
const path = require('node:path')

const electron = require('electron')
const entry = path.join(__dirname, '..', 'out', 'runtime-node', 'runtime', 'index.js')

const child = spawn(electron, [entry], {
  stdio: 'inherit',
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1'
  }
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 0)
})
