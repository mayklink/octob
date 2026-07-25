import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Check, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ProviderIcon } from '@/components/ui/provider-icon'
import { toast } from 'sonner'
import {
  saveProviderSettingsToDatabase,
  loadProviderSettingsFromDatabase
} from '@/lib/provider-settings'

interface ProviderInfo {
  id: string
  name: string
  icon: string
}

interface SettingsFieldDef {
  key: string
  label: string
  type: string
  required: boolean
  placeholder?: string
}

export function SettingsIntegrations(): React.JSX.Element {
  const { t } = useTranslation()
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [schemas, setSchemas] = useState<Record<string, SettingsFieldDef[]>>({})
  const [values, setValues] = useState<Record<string, string>>({})
  const [testing, setTesting] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<Record<string, boolean | null>>({})

  useEffect(() => {
    window.ticketImport.listProviders().then(async (provs) => {
      const globalProviders = provs.filter((p) => p.id !== 'azure_devops')
      setProviders(globalProviders)
      const schemaMap: Record<string, SettingsFieldDef[]> = {}
      for (const p of globalProviders) {
        schemaMap[p.id] = await window.ticketImport.getSettingsSchema(p.id)
      }
      setSchemas(schemaMap)

      const saved: Record<string, string> = {}
      try {
        const raw = localStorage.getItem('octob-provider-settings')
        if (raw) {
          const parsed = JSON.parse(raw) as Record<string, string>
          for (const [key, val] of Object.entries(parsed)) {
            if (typeof val === 'string') saved[key] = val
          }
          setValues(saved)
        }
      } catch {
        // ignore
      }

      try {
        const dbSettings = await loadProviderSettingsFromDatabase()
        if (dbSettings) {
          const merged = { ...saved }
          for (const [key, val] of Object.entries(dbSettings)) {
            if (typeof val === 'string') merged[key] = val
          }
          setValues(merged)
          localStorage.setItem('octob-provider-settings', JSON.stringify(merged))
        } else if (Object.keys(saved).length > 0) {
          await saveProviderSettingsToDatabase(saved)
        }
      } catch {
        // ignore
      }
    })
  }, [])

  const handleFieldChange = (key: string, value: string): void => {
    setValues((prev) => {
      const updated = { ...prev, [key]: value }
      try {
        localStorage.setItem('octob-provider-settings', JSON.stringify(updated))
      } catch {
        // ignore
      }
      saveProviderSettingsToDatabase(updated)
      return updated
    })
    setTestResult({})
  }

  const handleTest = async (providerId: string): Promise<void> => {
    setTesting(providerId)
    setTestResult((prev) => ({ ...prev, [providerId]: null }))

    try {
      const providerSettings: Record<string, string> = {}
      const fields = schemas[providerId] ?? []
      for (const f of fields) {
        if (values[f.key]) providerSettings[f.key] = values[f.key]
      }

      const result = await window.ticketImport.authenticate(providerId, providerSettings)
      setTestResult((prev) => ({ ...prev, [providerId]: result.success }))
      if (result.success) {
        const name = providers.find((p) => p.id === providerId)?.name ?? providerId
        toast.success(t('settings.integrations.connected', { name }))
      } else {
        toast.error(result.error ?? t('settings.integrations.authFailed'))
      }
    } catch (err) {
      setTestResult((prev) => ({ ...prev, [providerId]: false }))
      toast.error(
        t('settings.integrations.testFailed', {
          message: err instanceof Error ? err.message : String(err)
        })
      )
    } finally {
      setTesting(null)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium mb-1">{t('settings.integrations.heading')}</h3>
        <p className="text-xs text-muted-foreground">{t('settings.integrations.description')}</p>
      </div>

      {providers.map((provider) => {
        const fields = schemas[provider.id] ?? []
        const result = testResult[provider.id]

        return (
          <div key={provider.id} className="space-y-3 rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ProviderIcon provider={provider.icon} size="md" />
                <h4 className="text-sm font-medium">{provider.name}</h4>
              </div>
              <div className="flex items-center gap-2">
                {result === true && <Check className="h-4 w-4 text-green-500" />}
                {result === false && <X className="h-4 w-4 text-red-500" />}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={testing !== null}
                  onClick={() => void handleTest(provider.id)}
                >
                  {testing === provider.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  ) : null}
                  {t('settings.integrations.testConnection')}
                </Button>
              </div>
            </div>

            {fields.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {t('settings.integrations.noConfigNeeded')}
              </p>
            ) : (
              fields.map((field) => (
                <div key={field.key} className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    {field.label}
                    {!field.required && (
                      <span className="text-muted-foreground/50 ml-1">{t('common.optional')}</span>
                    )}
                  </label>
                  <Input
                    type={field.type === 'password' ? 'password' : 'text'}
                    placeholder={field.placeholder}
                    value={values[field.key] ?? ''}
                    onChange={(e) => handleFieldChange(field.key, e.target.value)}
                    className="text-sm h-8"
                  />
                </div>
              ))
            )}
          </div>
        )
      })}

    </div>
  )
}
