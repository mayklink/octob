import { app, BrowserWindow, screen } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const POSITION_FILE = join(app.getPath('userData'), 'assistant-position.json')
const SIZE = 92
let assistantWindow: BrowserWindow | null = null
let getMainWindow: (() => BrowserWindow | null) | null = null

function position(): { x: number; y: number } {
  try {
    if (existsSync(POSITION_FILE)) return JSON.parse(readFileSync(POSITION_FILE, 'utf8')) as { x: number; y: number }
  } catch {
    // Fall through to the default location.
  }
  const area = screen.getPrimaryDisplay().workArea
  return { x: area.x + area.width - SIZE - 24, y: area.y + area.height - SIZE - 24 }
}

function savePosition(): void {
  if (!assistantWindow || assistantWindow.isDestroyed()) return
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    const [x, y] = assistantWindow.getPosition()
    writeFileSync(POSITION_FILE, JSON.stringify({ x, y }))
  } catch {
    // Persisting the optional window position must not affect the assistant.
  }
}

export function configurePetWindow(options: { getMainWindow: () => BrowserWindow | null }): void {
  getMainWindow = options.getMainWindow
}

export function createPetWindow(): BrowserWindow | null {
  if (assistantWindow && !assistantWindow.isDestroyed()) return assistantWindow
  const { x, y } = position()
  assistantWindow = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    x,
    y,
    transparent: true,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false }
  })
  assistantWindow.setAlwaysOnTop(true, 'floating')
  assistantWindow.on('move', savePosition)
  assistantWindow.on('closed', () => { assistantWindow = null })
  assistantWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  assistantWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== 'octob://assistant/open') return
    event.preventDefault()
    focusMainWindowFromPet()
  })

  const markup = `<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden"><a href="octob://assistant/open" title="Open Octob Assistant" style="display:grid;place-items:center;width:88px;height:88px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#6ee7ff,#2563eb 58%,#172554);color:white;font:700 28px system-ui;text-decoration:none;box-shadow:0 8px 25px #0008;border:2px solid #93c5fd">O</a></body></html>`
  void assistantWindow.loadURL(`data:text/html,${encodeURIComponent(markup)}`)
  return assistantWindow
}

export function destroyPetWindow(): void {
  savePosition()
  assistantWindow?.destroy()
  assistantWindow = null
}

export function focusMainWindowFromPet(): void {
  const mainWindow = getMainWindow?.() ?? null
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  mainWindow.webContents.send('assistant:open')
}
