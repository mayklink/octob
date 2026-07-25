import { useEffect, useRef } from 'react'
import { toast } from '@/lib/toast'

export function useAppUpdates(): void {
  const downloadingToastId = useRef<string | number | null>(null)
  const downloadedToastShown = useRef(false)

  useEffect(() => {
    if (!window.updates) return

    const dismissDownloadingToast = (): void => {
      if (downloadingToastId.current !== null) {
        toast.dismiss(downloadingToastId.current)
        downloadingToastId.current = null
      }
    }

    const showAvailableToast = (version: string | null): void => {
      downloadedToastShown.current = false
      toast.info(version ? `Octob ${version} is available` : 'An Octob update is available', {
        duration: Infinity,
        action: {
          label: 'Update',
          onClick: () => {
            downloadingToastId.current = toast.loading('Downloading update...')
            window.updates.download().catch((error) => {
              dismissDownloadingToast()
              toast.error(error instanceof Error ? error.message : 'Failed to download update')
            })
          }
        }
      })
    }

    const cleanupAvailable = window.updates.onAvailable(({ version }) => {
      showAvailableToast(version)
    })

    const cleanupProgress = window.updates.onProgress(({ percent }) => {
      const rounded = Math.max(0, Math.min(100, Math.round(percent)))
      if (downloadingToastId.current !== null) {
        toast.dismiss(downloadingToastId.current)
      }
      downloadingToastId.current = toast.loading(`Downloading update... ${rounded}%`)
    })

    const cleanupDownloaded = window.updates.onDownloaded(({ version }) => {
      dismissDownloadingToast()
      if (downloadedToastShown.current) return
      downloadedToastShown.current = true
      toast.success(version ? `Octob ${version} is ready to install` : 'Update ready to install', {
        duration: Infinity,
        action: {
          label: 'Restart',
          onClick: () => {
            window.updates.install().catch((error) => {
              toast.error(error instanceof Error ? error.message : 'Failed to install update')
            })
          }
        }
      })
    })

    const cleanupError = window.updates.onError(({ message }) => {
      dismissDownloadingToast()
      toast.error(`Update failed: ${message}`)
    })

    window.updates.getState().then((state) => {
      if (state.status === 'available') {
        showAvailableToast(state.version)
      }
    }).catch(() => {})

    return () => {
      cleanupAvailable()
      cleanupProgress()
      cleanupDownloaded()
      cleanupError()
      dismissDownloadingToast()
    }
  }, [])
}
