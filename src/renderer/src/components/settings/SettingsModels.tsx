import { useTranslation } from 'react-i18next'
import { useSettingsStore, resolveModelForSdk } from '@/stores/useSettingsStore'
import { ModelSelector } from '@/components/sessions/ModelSelector'
import { Info } from 'lucide-react'

export function SettingsModels(): React.JSX.Element {
  const { t } = useTranslation()
  const defaultAgentSdk = useSettingsStore((s) => s.defaultAgentSdk) ?? 'opencode'
  const supportsModes = defaultAgentSdk === 'claude-code' || defaultAgentSdk === 'codex'
  const effectiveModel = useSettingsStore((s) =>
    resolveModelForSdk(defaultAgentSdk === 'terminal' ? 'opencode' : defaultAgentSdk, s)
  )
  const defaultModels = useSettingsStore((state) => state.defaultModels)
  const setSelectedModel = useSettingsStore((state) => state.setSelectedModel)
  const setSelectedModelForSdk = useSettingsStore((state) => state.setSelectedModelForSdk)
  const setModeDefaultModel = useSettingsStore((state) => state.setModeDefaultModel)

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-medium mb-1">{t('settings.models.heading')}</h3>
        <p className="text-sm text-muted-foreground">{t('settings.models.description')}</p>
      </div>

      <div className="flex gap-2 p-3 rounded-md bg-muted/30 border border-border">
        <Info className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
        <div className="text-xs text-muted-foreground space-y-1">
          <p>
            <strong>{t('settings.models.priorityTitle')}</strong>
          </p>
          <ol className="list-decimal list-inside space-y-0.5 ml-2">
            <li>{t('settings.models.priority1')}</li>
            {supportsModes && <li>{t('settings.models.priority2')}</li>}
            <li>{t('settings.models.priority3')}</li>
            <li>{t('settings.models.priority4')}</li>
          </ol>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">{t('settings.models.globalDefault')}</label>
        <p className="text-xs text-muted-foreground">
          {supportsModes ? t('settings.models.globalFallbackHint') : t('settings.models.globalSimpleHint')}
        </p>
        <div className="flex items-center gap-2">
          <ModelSelector
            value={effectiveModel}
            onChange={(model) => {
              const sdk = defaultAgentSdk === 'terminal' ? 'opencode' : defaultAgentSdk
              setSelectedModel(model)
              setSelectedModelForSdk(sdk, model)
            }}
          />
          {effectiveModel && (
            <button
              type="button"
              onClick={() => {
                const sdk = defaultAgentSdk === 'terminal' ? 'opencode' : defaultAgentSdk
                setSelectedModel(null)
                setSelectedModelForSdk(sdk, null)
              }}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {t('settings.models.clear')}
            </button>
          )}
        </div>
      </div>

      {supportsModes && (
        <>
          <div className="border-t pt-4" />
          <div className="space-y-2">
            <label className="text-sm font-medium">{t('settings.models.buildDefault')}</label>
            <p className="text-xs text-muted-foreground">{t('settings.models.buildHint')}</p>
            <div className="flex items-center gap-2">
              <ModelSelector
                value={defaultModels?.build || null}
                onChange={(model) => setModeDefaultModel('build', model)}
              />
              {defaultModels?.build && (
                <button
                  type="button"
                  onClick={() => setModeDefaultModel('build', null)}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t('settings.models.useGlobal')}
                </button>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">{t('settings.models.planDefault')}</label>
            <p className="text-xs text-muted-foreground">{t('settings.models.planHint')}</p>
            <div className="flex items-center gap-2">
              <ModelSelector
                value={defaultModels?.plan || null}
                onChange={(model) => setModeDefaultModel('plan', model)}
              />
              {defaultModels?.plan && (
                <button
                  type="button"
                  onClick={() => setModeDefaultModel('plan', null)}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t('settings.models.useGlobal')}
                </button>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">{t('settings.models.askDefault')}</label>
            <p className="text-xs text-muted-foreground">{t('settings.models.askHint')}</p>
            <div className="flex items-center gap-2">
              <ModelSelector
                value={defaultModels?.ask || null}
                onChange={(model) => setModeDefaultModel('ask', model)}
              />
              {defaultModels?.ask && (
                <button
                  type="button"
                  onClick={() => setModeDefaultModel('ask', null)}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t('settings.models.useGlobal')}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
