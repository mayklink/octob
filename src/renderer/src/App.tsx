import { useEffect, useState } from 'react'
import { AppLayout } from '@/components/layout'
import { ErrorBoundary } from '@/components/error'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AppI18nProvider } from '@/i18n/I18nProvider'
import { initPlatform } from '@/lib/platform'
import { useTipStore } from '@/stores/useTipStore'
import { useConnectionStore } from '@/stores/useConnectionStore'
import { useSessionStore } from '@/stores/useSessionStore'
import { useLayoutStore } from '@/stores/useLayoutStore'
import { toast } from '@/lib/toast'

function App(): React.JSX.Element {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    initPlatform().then(() => {
      // Load seen tips from DB so the tip system knows which tips to skip
      useTipStore.getState().loadSeenTips()
      setReady(true)
    })
  }, [])

  useEffect(() => {
    const openAssistant = async (): Promise<void> => {
      const result = await window.assistantOps.ensureGlobalConnection()
      if (!result.success || !result.connection) {
        toast.error(result.error || 'Unable to open Octob Assistant')
        return
      }

      const connectionStore = useConnectionStore.getState()
      await connectionStore.loadConnections()
      connectionStore.selectConnection(result.connection.id)
      useLayoutStore.getState().setWorkspaceView('connection')
      useLayoutStore.getState().setWorkspaceContentView('session')
      useLayoutStore.getState().setWorkspaceMode('chat')

      const sessions = useSessionStore.getState()
      await sessions.loadConnectionSessions(result.connection.id)
      const existing = useSessionStore.getState().getSessionsForConnection(result.connection.id)[0]
      if (existing) {
        useSessionStore.getState().setActiveConnectionSession(existing.id)
      } else {
        await useSessionStore.getState().createConnectionSession(result.connection.id)
      }
    }

    return window.assistantOps.onOpen(() => void openAssistant())
  }, [])

  if (!ready) return <div />

  return (
    <ErrorBoundary componentName="App">
      <AppI18nProvider>
        <TooltipProvider delayDuration={350}>
          <AppLayout />
        </TooltipProvider>
      </AppI18nProvider>
    </ErrorBoundary>
  )
}

export default App
