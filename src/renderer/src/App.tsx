import { useEffect, useState } from 'react'
import { AppLayout } from '@/components/layout'
import { ErrorBoundary } from '@/components/error'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AppI18nProvider } from '@/i18n/I18nProvider'
import { initPlatform } from '@/lib/platform'
import { useTipStore } from '@/stores/useTipStore'
import { useSessionStore } from '@/stores/useSessionStore'
import { useGlobalAssistantStore } from '@/stores/useGlobalAssistantStore'

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
      useGlobalAssistantStore.getState().open()
      const sessions = useSessionStore.getState()
      if (sessions.activeSessionId) return
      const worktreeId = sessions.activeWorktreeId
      if (!worktreeId) {
        return
      }
      const worktree = await window.db.worktree.get(worktreeId)
      if (!worktree) return
      await sessions.createSession(worktree.id, worktree.project_id)
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
