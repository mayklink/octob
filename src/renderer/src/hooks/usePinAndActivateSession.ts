import { useCallback, useState } from 'react'
import { useKanbanStore } from '@/stores/useKanbanStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useFileViewerStore } from '@/stores/useFileViewerStore'
import { BOARD_TAB_ID, useSessionStore } from '@/stores/useSessionStore'

function isBoardVisible(): boolean {
  const sessionState = useSessionStore.getState()
  const boardMode = useSettingsStore.getState().boardMode
  const hasActiveOverlay = useFileViewerStore.getState().hasActiveOverlay()

  if (boardMode === 'sticky-tab') {
    return (
      sessionState.activeSessionId === BOARD_TAB_ID &&
      !sessionState.inlineConnectionSessionId &&
      !hasActiveOverlay
    )
  }

  return (
    useKanbanStore.getState().isBoardViewActive &&
    !sessionState.activePinnedSessionId &&
    !hasActiveOverlay
  )
}

/** Creates a session, pins it to the board, activates it, and optionally runs a callback (e.g. close modal). */
export function usePinAndActivateSession(onClose?: () => void) {
  const [loading, setLoading] = useState(false)

  const pinAndActivate = useCallback(
    async (createFn: () => Promise<string | null>) => {
      setLoading(true)
      try {
        const sessionId = await createFn()
        if (sessionId) {
          const sessionStore = useSessionStore.getState()
          await sessionStore.pinSessionToBoard(sessionId)
          if (!isBoardVisible()) {
            sessionStore.setActiveSession(sessionId)
          }
          onClose?.()
        }
      } catch {
        // Session creation itself shows toasts; nothing extra needed
      } finally {
        setLoading(false)
      }
    },
    [onClose]
  )

  return { pinAndActivate, lifecycleLoading: loading }
}
