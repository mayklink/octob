const { spawn } = require('node:child_process')
const net = require('node:net')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const runtimePort = 47821
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

function startRuntime() {
  const child = spawn(
    process.execPath,
    [path.join(root, 'scripts', 'run-runtime.cjs')],
    {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...process.env,
        OCTOB_OPEN_BROWSER: '0'
      },
      windowsHide: false
    }
  )
  children.push(child)
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
  const child = spawn(command, [url], {
    detached: true,
    stdio: 'ignore'
  })
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
    startRuntime()
    if (!(await waitForPort(runtimePort))) {
      throw new Error('Octob Runtime did not start on port 47821')
    }
  } else {
    console.log('[octob] Reusing runtime on http://127.0.0.1:47821')
  }

  const url = 'http://127.0.0.1:47821/'
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
