import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useSettingsStore, type EditorOption } from '@/stores/useSettingsStore'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { Check, Loader2 } from 'lucide-react'
import { isMac, isLinux } from '@/lib/platform'

interface DetectedEditor {
  id: string
  name: string
  command: string
  available: boolean
}

export function SettingsEditor(): React.JSX.Element {
  const { t } = useTranslation()
  const { defaultEditor, customEditorCommand, updateSetting } = useSettingsStore()
  const [detectedEditors, setDetectedEditors] = useState<DetectedEditor[]>([])
  const [isDetecting, setIsDetecting] = useState(true)

  const editorOptions = useMemo(
    () =>
      [
        { id: 'vscode' as const, label: t('settings.editor.vscode') },
        { id: 'cursor' as const, label: t('settings.editor.cursor') },
        { id: 'sublime' as const, label: t('settings.editor.sublime') },
        { id: 'webstorm' as const, label: t('settings.editor.webstorm') },
        { id: 'zed' as const, label: t('settings.editor.zed') },
        { id: 'custom' as const, label: t('settings.editor.customLabel') }
      ] satisfies ReadonlyArray<{ id: EditorOption; label: string }>,
    [t]
  )

  useEffect(() => {
    let cancelled = false
    async function detect(): Promise<void> {
      try {
        if (window.settingsOps?.detectEditors) {
          const editors = await window.settingsOps.detectEditors()
          if (!cancelled) {
            setDetectedEditors(editors)
          }
        }
      } catch {
        // Detection failed, show all options
      } finally {
        if (!cancelled) setIsDetecting(false)
      }
    }
    detect()
    return () => {
      cancelled = true
    }
  }, [])

  const isAvailable = (id: string): boolean => {
    if (id === 'custom') return true
    const editor = detectedEditors.find((e) => e.id === id)
    return editor?.available ?? false
  }

  const placeholder = isMac()
    ? t('settings.editor.placeholderMac')
    : isLinux()
      ? t('settings.editor.placeholderLinux')
      : t('settings.editor.placeholderWin')

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-medium mb-1">{t('settings.editor.heading')}</h3>
        <p className="text-sm text-muted-foreground">{t('settings.editor.description')}</p>
      </div>

      {isDetecting ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('settings.editor.detecting')}
        </div>
      ) : (
        <div className="space-y-1">
          {editorOptions.map((opt) => {
            const available = isAvailable(opt.id)
            return (
              <button
                key={opt.id}
                onClick={() => updateSetting('defaultEditor', opt.id)}
                disabled={!available && opt.id !== 'custom'}
                className={cn(
                  'w-full flex items-center justify-between px-3 py-2.5 rounded-md text-sm transition-colors text-left',
                  defaultEditor === opt.id
                    ? 'bg-primary/10 border border-primary/30'
                    : 'hover:bg-accent/50 border border-transparent',
                  !available && opt.id !== 'custom' && 'opacity-50 cursor-not-allowed'
                )}
                data-testid={`editor-${opt.id}`}
              >
                <div className="flex items-center gap-2">
                  <span>{opt.label}</span>
                  {!available && opt.id !== 'custom' && (
                    <span className="text-xs text-muted-foreground">{t('settings.editor.notFound')}</span>
                  )}
                </div>
                {defaultEditor === opt.id && <Check className="h-4 w-4 text-primary" />}
              </button>
            )
          })}
        </div>
      )}

      {defaultEditor === 'custom' && (
        <div className="space-y-2">
          <label className="text-sm font-medium">{t('settings.editor.customCommand')}</label>
          <Input
            value={customEditorCommand}
            onChange={(e) => updateSetting('customEditorCommand', e.target.value)}
            placeholder={placeholder}
            className="font-mono text-sm"
            data-testid="custom-editor-command"
          />
          <p className="text-xs text-muted-foreground">{t('settings.editor.customHint')}</p>
        </div>
      )}
    </div>
  )
}
