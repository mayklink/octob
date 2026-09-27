const { test } = require('node:test')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { mkdtempSync, writeFileSync, rmSync, existsSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve, sep } = require('node:path')
const { once } = require('node:events')
const Module = require('node:module')
const esbuild = require('esbuild')

const root = resolve(__dirname, '..')
const electron = join(root, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron')

test('sandboxed preview loads its UI and completes the message bridge in Electron', { skip: !existsSync(electron), timeout: 20_000 }, async () => {
  const helperPath = join(root, 'src', 'renderer', 'src', 'components', 'capabilities', 'capability-preview-document.ts')
  const compiled = esbuild.buildSync({ entryPoints: [helperPath], bundle: true, write: false, platform: 'node', format: 'cjs' }).outputFiles[0].text
  const helper = new Module(helperPath, module)
  helper.filename = helperPath
  helper.paths = Module._nodeModulePaths(join(root, 'src', 'renderer', 'src', 'components', 'capabilities'))
  helper._compile(compiled, helperPath)
  const nonce = 'preview-test-token'
  const document = helper.exports.buildCapabilityPreviewDocument({
    html: '<button id="send">Send</button><output id="status">Waiting</output>',
    css: '',
    javascript: `document.getElementById('send').onclick = async () => {
      const result = await window.capability.call({ url: 'https://example.test/target', method: 'POST' });
      document.getElementById('status').textContent = String(result.status);
      window.parent.postMessage({ channel: 'preview-test', type: 'done', status: result.status }, '*');
    };
    window.addEventListener('message', (event) => {
      if (event.source === window.parent && event.data?.type === 'trigger') document.getElementById('send').click();
    });`,
    handler: '', tests: []
  }, nonce)
  const encodedDocument = JSON.stringify(document).replace(/</g, '\\u003c')
  const appDir = mkdtempSync(join(tmpdir(), 'octob-preview-test-'))
  try {
    writeFileSync(join(appDir, 'package.json'), JSON.stringify({ name: 'octob-preview-test', main: 'main.cjs' }))
    writeFileSync(join(appDir, 'index.html'), `<!doctype html><head><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' blob: 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; worker-src 'self' blob:"></head><iframe id="preview" sandbox="allow-scripts"></iframe><script src="parent.js"></script>`)
    writeFileSync(join(appDir, 'parent.js'), `
      const frame = document.getElementById('preview');
      window.__events = [];
      window.addEventListener('message', (event) => {
        if (event.source !== frame.contentWindow) return;
        const message = event.data;
        window.__events.push(message);
        if (message.channel === 'octob-capability' && message.token === ${JSON.stringify(nonce)} && message.type === 'ready') {
          frame.contentWindow.postMessage({ type: 'trigger' }, '*');
        } else if (message.channel === 'octob-capability' && message.token === ${JSON.stringify(nonce)} && message.type === 'call') {
          frame.contentWindow.postMessage({ channel: 'octob-capability', token: ${JSON.stringify(nonce)}, type: 'result', id: message.id, ok: true, result: { status: 201 } }, '*');
        } else if (message.channel === 'preview-test' && message.type === 'done') {
          window.__result = { status: message.status, events: window.__events };
        }
      });
      frame.srcdoc = ${encodedDocument};`)
    writeFileSync(join(appDir, 'main.cjs'), `const { app, BrowserWindow } = require('electron');
      app.commandLine.appendSwitch('disable-gpu');
      app.whenReady().then(async () => {
        const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
        const logs = [];
        win.webContents.on('console-message', (event, level, message) => logs.push(String(message)));
        await win.loadFile(__dirname + '/index.html');
        let result;
        for (let i = 0; i < 60; i++) {
          result = await win.webContents.executeJavaScript('window.__result');
          if (result) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (!result) result = { timeout: true, events: await win.webContents.executeJavaScript('window.__events'), frames: win.webContents.mainFrame.frames.map((frame) => frame.url.slice(0, 100)), logs };
        process.stdout.write('PREVIEW_RESULT:' + JSON.stringify(result) + '\\n');
        win.destroy();
        app.quit();
      }).catch((error) => { console.error(error); app.exit(1); });`)
    const child = spawn(electron, [appDir], { env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
    const [code] = await once(child, 'close')
    assert.equal(code, 0, stderr)
    const line = stdout.split(/\r?\n/).find((item) => item.startsWith('PREVIEW_RESULT:'))
    assert.ok(line, stdout || stderr)
    const result = JSON.parse(line.slice('PREVIEW_RESULT:'.length))
    assert.equal(result.status, 201, JSON.stringify(result))
    assert.deepEqual(result.events.filter((event) => event.channel === 'octob-capability').map((event) => event.type), ['ready', 'call'])
  } finally {
    const target = resolve(appDir)
    if (target.startsWith(resolve(tmpdir()) + sep) && target.includes('octob-preview-test-')) rmSync(target, { recursive: true, force: true })
  }
})
