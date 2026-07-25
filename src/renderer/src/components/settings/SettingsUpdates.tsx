import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, Loader2, RefreshCw, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from '@/lib/toast'

type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

interface UpdateState {
  status: UpdateStatus
  version: string | null
  error: string | null
  percent: number | null
}

const INITIAL_UPDATE_STATE: UpdateState = {
  status: 'idle',
  version: null,
  error: null,
  percent: null
}

function formatPercent(percent: number | null): string {
  if (percent === null) return '0%'
  return `${Math.round(percent)}%`
}

export function SettingsUpdates(): React.JSX.Element {
  const { t } = useTranslation()
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [updateState, setUpdateState] = useState<UpdateState>(INITIAL_UPDATE_STATE)

  const isChecking = updateState.status === 'checking'
  const isDownloading = updateState.status === 'downloading'
  const isBusy = isChecking || isDownloading

  useEffect(() => {
    let cancelled = false

    window.systemOps.getAppVersion().then((version) => {
      if (!cancelled) setAppVersion(version)
    })

    window.updates.getState().then((state) => {
      if (!cancelled) setUpdateState(state)
    })

    const unsubscribe = window.updates.onState((state) => {
      setUpdateState(state)
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const statusLabel = useMemo(() => {
    if (updateState.status === 'not-available' && updateState.error) {
      return t('settings.updates.statusError')
    }

    switch (updateState.status) {
      case 'checking':
        return t('settings.updates.statusChecking')
      case 'available':
        return t('settings.updates.statusAvailable', {
          version: updateState.version ?? t('settings.updates.unknownVersion')
        })
      case 'not-available':
        return t('settings.updates.statusNotAvailable')
      case 'downloading':
        return t('settings.updates.statusDownloading', {
          percent: formatPercent(updateState.percent)
        })
      case 'downloaded':
        return t('settings.updates.statusDownloaded', {
          version: updateState.version ?? t('settings.updates.unknownVersion')
        })
      case 'error':
        return t('settings.updates.statusError')
      case 'idle':
      default:
        return t('settings.updates.statusIdle')
    }
  }, [t, updateState])

  const handleCheck = async (): Promise<void> => {
    try {
      const state = await window.updates.check()
      setUpdateState(state)

      if (state.error) {
        toast.error(state.error)
      } else if (state.status === 'available') {
        toast.success(
          t('settings.updates.toastAvailable', {
            version: state.version ?? t('settings.updates.unknownVersion')
          })
        )
      } else if (state.status === 'not-available') {
        toast.info(t('settings.updates.toastNotAvailable'))
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error(message)
      setUpdateState({ status: 'error', version: null, error: message, percent: null })
    }
  }

  const handleDownload = async (): Promise<void> => {
    try {
      const state = await window.updates.download()
      setUpdateState(state)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error(message)
      setUpdateState((current) => ({ ...current, status: 'error', error: message, percent: null }))
    }
  }

  const handleInstall = async (): Promise<void> => {
    await window.updates.install()
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-medium mb-1">{t('settings.updates.heading')}</h3>
        <p className="text-sm text-muted-foreground">{t('settings.updates.description')}</p>
      </div>

      <div className="rounded-lg border p-4 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">{t('settings.updates.currentVersion')}</label>
            <p className="text-xs text-muted-foreground">
              {appVersion ?? t('settings.updates.loadingVersion')}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isBusy}
            onClick={() => void handleCheck()}
            data-testid="check-updates"
          >
            {isChecking ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {isChecking ? t('settings.updates.checkWaiting') : t('settings.updates.checkButton')}
          </Button>
        </div>

        <div className="rounded-md bg-muted/40 px-3 py-2">
          <p className="text-sm">{statusLabel}</p>
          {updateState.error ? (
            <p className="text-xs text-destructive mt-1">{updateState.error}</p>
          ) : null}
        </div>

        {updateState.status === 'available' ? (
          <Button
            type="button"
            size="sm"
            disabled={isBusy}
            onClick={() => void handleDownload()}
            data-testid="download-update"
          >
            <Download className="h-3.5 w-3.5" />
            {t('settings.updates.downloadButton')}
          </Button>
        ) : null}

        {updateState.status === 'downloaded' ? (
          <Button type="button" size="sm" onClick={() => void handleInstall()} data-testid="install-update">
            <RotateCcw className="h-3.5 w-3.5" />
            {t('settings.updates.installButton')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
