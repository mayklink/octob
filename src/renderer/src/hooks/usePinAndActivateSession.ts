import { useCallback, useState } from 'react'
import { useSessionStore } from '@/stores/useSessionStore'

/** Creates and activates a session, then optionally runs a callback. */
export function usePinAndActivateSession(onClose?: () => void) {
  const [loading, setLoading] = useState(false)

  const pinAndActivate = useCallback(
    async (createFn: () => Promise<string | null>) => {
      setLoading(true)
      try {
        const sessionId = await createFn()
        if (sessionId) {
          useSessionStore.getState().setActiveSession(sessionId)
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
