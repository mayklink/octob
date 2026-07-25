import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { Trash2, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/lib/toast'

const POSIX_KEY_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/

function validateKey(
  key: string,
  allKeys: string[],
  currentIndex: number
): 'invalid' | 'duplicate' | null {
  if (!key) return null
  if (!POSIX_KEY_REGEX.test(key)) return 'invalid'
  const isDuplicate = allKeys.some((k, i) => i !== currentIndex && k === key)
  if (isDuplicate) return 'duplicate'
  return null
}

export function SettingsAdvanced(): React.JSX.Element {
  const { t } = useTranslation()
  const [errors, setErrors] = useState<Record<number, 'invalid' | 'duplicate' | null>>({})

  const {
    environmentVariables: rawEnvVars,
    perfDiagnosticsEnabled,
    codexJsonlLoggingEnabled,
    codexJsonlResetPerSession,
    customCodexBinaryPath,
    updateSetting,
    detectAvailableAgentSdks
  } = useSettingsStore()
  const envVars = rawEnvVars ?? []

  const handlePerfDiagnosticsToggle = (): void => {
    const newValue = !perfDiagnosticsEnabled
    updateSetting('perfDiagnosticsEnabled', newValue)
    window.perfDiagnosticsOps.enable(newValue)
    toast.success(newValue ? t('settings.advanced.toastPerfOn') : t('settings.advanced.toastPerfOff'))
  }

  const handleCodexJsonlLoggingToggle = (): void => {
    const newValue = !codexJsonlLoggingEnabled
    updateSetting('codexJsonlLoggingEnabled', newValue)
    window.codexDebugLoggerOps.configure(newValue, codexJsonlResetPerSession)
    toast.success(newValue ? t('settings.advanced.toastCodexOn') : t('settings.advanced.toastCodexOff'))
  }

  const handleCodexJsonlResetToggle = (): void => {
    const newValue = !codexJsonlResetPerSession
    updateSetting('codexJsonlResetPerSession', newValue)
    window.codexDebugLoggerOps.configure(codexJsonlLoggingEnabled, newValue)
    toast.success(
      newValue ? t('settings.advanced.toastLogResetOn') : t('settings.advanced.toastLogResetOff')
    )
  }

  const handleApplyCodexPath = async (): Promise<void> => {
    await updateSetting('customCodexBinaryPath', customCodexBinaryPath)
    const result = await window.systemOps.configureCodexBinaryPath(customCodexBinaryPath)
    await detectAvailableAgentSdks()
    if (result.success) {
      toast.success(t('settings.advanced.codexPathApplied', { path: result.path }))
    } else {
      toast.error(result.error || t('settings.advanced.codexPathInvalid'))
    }
  }

  const handleClearCodexPath = async (): Promise<void> => {
    await updateSetting('customCodexBinaryPath', '')
    const result = await window.systemOps.configureCodexBinaryPath('')
    await detectAvailableAgentSdks()
    toast.success(
      result.success
        ? t('settings.advanced.codexPathAutoFound', { path: result.path })
        : t('settings.advanced.codexPathCleared')
    )
  }

  const handleAdd = (): void => {
    updateSetting('environmentVariables', [...envVars, { key: '', value: '' }])
    toast.success(t('settings.advanced.toastVarAdd'))
  }

  const handleRemove = (index: number): void => {
    const updated = envVars.filter((_, i) => i !== index)
    updateSetting('environmentVariables', updated)
    const newErrors: Record<number, 'invalid' | 'duplicate' | null> = {}
    for (const [k, v] of Object.entries(errors)) {
      const i = Number(k)
      if (i < index) newErrors[i] = v
      else if (i > index) newErrors[i - 1] = v
    }
    setErrors(newErrors)
    toast.success(t('settings.advanced.toastVarRemove'))
  }

  const handleChange = (index: number, field: 'key' | 'value', val: string): void => {
    const updated = envVars.map((entry, i) => (i === index ? { ...entry, [field]: val } : entry))

    if (field === 'key') {
      const error = validateKey(
        val,
        updated.map((e) => e.key),
        index
      )
      setErrors((prev) => ({ ...prev, [index]: error }))
    }

    updateSetting('environmentVariables', updated)
  }

  return (
    <div className="space-y-6" style={{ overflow: 'hidden' }}>
      <div>
        <h3 className="text-base font-medium mb-1">{t('settings.advanced.heading')}</h3>
        <p className="text-sm text-muted-foreground">{t('settings.advanced.description')}</p>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <label className="text-sm font-medium">{t('settings.advanced.perfDiag')}</label>
          <p className="text-xs text-muted-foreground mt-0.5">{t('settings.advanced.perfDiagHint')}</p>
        </div>
        <button
          role="switch"
          aria-checked={perfDiagnosticsEnabled}
          onClick={handlePerfDiagnosticsToggle}
          className={cn(
            'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
            perfDiagnosticsEnabled ? 'bg-primary' : 'bg-muted'
          )}
        >
          <span
            className={cn(
              'pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform',
              perfDiagnosticsEnabled ? 'translate-x-4' : 'translate-x-0'
            )}
          />
        </button>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <label className="text-sm font-medium">{t('settings.advanced.codexLog')}</label>
          <p className="text-xs text-muted-foreground mt-0.5">{t('settings.advanced.codexLogHint')}</p>
        </div>
        <button
          role="switch"
          aria-checked={codexJsonlLoggingEnabled}
          onClick={handleCodexJsonlLoggingToggle}
          className={cn(
            'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
            codexJsonlLoggingEnabled ? 'bg-primary' : 'bg-muted'
          )}
        >
          <span
            className={cn(
              'pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform',
              codexJsonlLoggingEnabled ? 'translate-x-4' : 'translate-x-0'
            )}
          />
        </button>
      </div>

      <div
        className={cn(
          'flex items-center justify-between pl-4',
          !codexJsonlLoggingEnabled && 'opacity-50 pointer-events-none'
        )}
      >
        <div>
          <label className="text-sm font-medium">{t('settings.advanced.resetLog')}</label>
          <p className="text-xs text-muted-foreground mt-0.5">{t('settings.advanced.resetLogHint')}</p>
        </div>
        <button
          role="switch"
          aria-checked={codexJsonlResetPerSession}
          onClick={handleCodexJsonlResetToggle}
          className={cn(
            'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
            codexJsonlResetPerSession ? 'bg-primary' : 'bg-muted'
          )}
        >
          <span
            className={cn(
              'pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform',
              codexJsonlResetPerSession ? 'translate-x-4' : 'translate-x-0'
            )}
          />
        </button>
      </div>

      <div className="space-y-2 border-t pt-4">
        <div>
          <label className="text-sm font-medium">{t('settings.advanced.codexPath')}</label>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('settings.advanced.codexPathHint')}
          </p>
        </div>
        <div className="flex gap-2">
          <Input
            value={customCodexBinaryPath}
            onChange={(event) => updateSetting('customCodexBinaryPath', event.target.value)}
            placeholder={t('settings.advanced.codexPathPlaceholder')}
            className="font-mono"
            data-testid="custom-codex-binary-path"
          />
          <Button size="sm" onClick={handleApplyCodexPath}>
            {t('settings.advanced.applyCodexPath')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleClearCodexPath}
            disabled={!customCodexBinaryPath}
          >
            {t('settings.advanced.clearCodexPath')}
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <label className="text-sm font-medium">{t('settings.advanced.envVars')}</label>
          <p className="text-xs text-muted-foreground">{t('settings.advanced.envVarsHint')}</p>
        </div>

        {envVars.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-6 text-center">
            <p className="text-sm text-muted-foreground mb-3">{t('settings.advanced.envEmpty')}</p>
            <Button size="sm" onClick={handleAdd} data-testid="add-env-var-empty">
              <Plus className="h-3.5 w-3.5 mr-1" />
              {t('settings.advanced.addVar')}
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 px-1">
              <span
                className="text-xs font-medium text-muted-foreground"
                style={{ flex: '1 1 0', minWidth: 0 }}
              >
                {t('settings.advanced.keyCol')}
              </span>
              <span
                className="text-xs font-medium text-muted-foreground"
                style={{ flex: '1 1 0', minWidth: 0 }}
              >
                {t('settings.advanced.valueCol')}
              </span>
              <span className="w-8 shrink-0" />
            </div>

            <div className="space-y-2 max-h-64 overflow-y-auto" style={{ overflowX: 'hidden' }}>
              {envVars.map((entry, index) => {
                const error = errors[index]
                return (
                  <div key={index}>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={entry.key}
                        onChange={(e) => handleChange(index, 'key', e.target.value)}
                        placeholder="VARIABLE_NAME"
                        className={cn(
                          'px-3 py-1.5 text-sm rounded-md border bg-background font-mono',
                          error ? 'border-destructive' : 'border-border'
                        )}
                        style={{ flex: '1 1 0', minWidth: 0 }}
                        data-testid={`env-var-key-${index}`}
                      />
                      <input
                        type="text"
                        value={entry.value}
                        onChange={(e) => handleChange(index, 'value', e.target.value)}
                        placeholder={t('settings.advanced.placeholderValue')}
                        className="px-3 py-1.5 text-sm rounded-md border border-border bg-background"
                        style={{ flex: '1 1 0', minWidth: 0 }}
                        data-testid={`env-var-value-${index}`}
                      />
                      <button
                        type="button"
                        onClick={() => handleRemove(index)}
                        className="shrink-0 text-destructive hover:text-destructive/80 transition-colors p-1"
                        title={t('settings.advanced.removeVar')}
                        data-testid={`remove-env-var-${index}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {error === 'invalid' && (
                      <p className="text-xs text-destructive mt-1 ml-1">
                        {t('settings.advanced.envInvalidKey')}
                      </p>
                    )}
                    {error === 'duplicate' && (
                      <p className="text-xs text-destructive mt-1 ml-1">
                        {t('settings.advanced.envDupKey')}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>

            <Button size="sm" variant="outline" onClick={handleAdd} data-testid="add-env-var">
              <Plus className="h-3.5 w-3.5 mr-1" />
              {t('settings.advanced.addVar')}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
