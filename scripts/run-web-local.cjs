const { spawn } = require('node:child_process')
const net = require('node:net')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const runtimePort = 47821
const webPort = 5173
const previewMode = process.argv.includes('--preview')
const noOpen = process.argv.includes('--no-open')
const children = []

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
    socket.setTimeout(500, () => {
      socket.destroy()
      resolve(false)
    })
  })
}

function start(command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...env },
    windowsHide: false
  })
  children.push(child)
  return child
}

function openBrowser(url) {
  if (process.platform === 'win32') {
    const child = spawn('cmd.exe', ['/d', '/s', '/c', 'start', '', url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })
    child.unref()
    return
  }
  const command = process.platform === 'darwin' ? 'open' : 'xdg-open'
  const child = spawn(command, [url], { detached: true, stdio: 'ignore' })
  child.unref()
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForPort(port, timeoutMs = 15000) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    if (await portOpen(port)) return true
    await wait(200)
  }
  return false
}

async function main() {
  if (!(await portOpen(runtimePort))) {
    start(process.execPath, [path.join(root, 'scripts', 'run-runtime.cjs')])
    if (!(await waitForPort(runtimePort))) {
      throw new Error('Octob Runtime did not start on port 47821')
    }
  } else {
    console.log('[octob] Reusing runtime on http://127.0.0.1:47821')
  }

  if (!(await portOpen(webPort))) {
    const viteArgs = [
      path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')
    ]
    if (previewMode) viteArgs.push('preview')
    viteArgs.push(
      '--config',
      path.join(root, 'vite.web.config.ts'),
      '--host',
      '127.0.0.1',
      '--port',
      String(webPort)
    )
    start(process.execPath, viteArgs)
    if (!(await waitForPort(webPort))) {
      throw new Error('Octob Web did not start on port 5173')
    }
  } else {
    console.log('[octob] Reusing web server on http://127.0.0.1:5173')
  }

  const url = 'http://127.0.0.1:5173/web.html'
  console.log(`[octob] Browser mode ready: ${url}`)
  if (!noOpen) openBrowser(url)
}

function shutdown() {
  for (const child of children) {
    if (!child.killed) child.kill()
  }
}

process.once('SIGINT', () => {
  shutdown()
  process.exit(0)
})
process.once('SIGTERM', () => {
  shutdown()
  process.exit(0)
})

main().catch((error) => {
  console.error('[octob]', error instanceof Error ? error.message : error)
  shutdown()
  process.exit(1)
})
