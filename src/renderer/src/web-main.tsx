import './styles/globals.css'
import './i18n/config'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { installWebRuntimeBridge } from './runtime/web-bridge'

async function bootstrap(): Promise<void> {
  const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement)

  try {
    await installWebRuntimeBridge()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    root.render(
      <div style={{ padding: 24, fontFamily: 'system-ui' }}>
        <h2>Octob Runtime não encontrado</h2>
        <p>Inicie o Octob Runtime local e recarregue esta página.</p>
        <pre>{message}</pre>
      </div>
    )
    return
  }

  const { default: App } = await import('./App')
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

void bootstrap()
