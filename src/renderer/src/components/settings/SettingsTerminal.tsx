import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { isMac as isMacPlatform, isWindows as isWindowsPlatform } from '@/lib/platform'
import {
  useSettingsStore,
  type TerminalOption,
  type EmbeddedTerminalBackend,
  type TerminalPosition
} from '@/stores/useSettingsStore'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { Check, Loader2, Info } from 'lucide-react'

interface DetectedTerminal {
  id: string
  name: string
  command: string
  available: boolean
}

const MAC_TERMINAL_IDS: TerminalOption[] = [
  'terminal',
  'iterm',
  'warp',
  'alacritty',
  'kitty',
  'ghostty',
  'custom'
]

const WINDOWS_TERMINAL_IDS: TerminalOption[] = [
  'terminal',
  'powershell',
  'cmd',
  'custom'
]

const LINUX_TERMINAL_IDS: TerminalOption[] = ['terminal', 'alacritty', 'kitty', 'custom']

function getTerminalIds(): TerminalOption[] {
  if (isWindowsPlatform()) return WINDOWS_TERMINAL_IDS
  if (isMacPlatform()) return MAC_TERMINAL_IDS
  return LINUX_TERMINAL_IDS
}

function externalTerminalLabel(id: TerminalOption, t: (k: string) => string): string {
  switch (id) {
    case 'terminal':
      if (isWindowsPlatform()) return t('settings.terminal.termWindows')
      if (isMacPlatform()) return t('settings.terminal.termTerminal')
      return t('settings.terminal.termDefaultLinux')
    case 'iterm':
      return t('settings.terminal.termITerm')
    case 'warp':
      return t('settings.terminal.termWarp')
    case 'alacritty':
      return t('settings.terminal.termAlacritty')
    case 'kitty':
      return t('settings.terminal.termKitty')
    case 'ghostty':
      return t('settings.terminal.termGhostty')
    case 'powershell':
      return t('settings.terminal.termPowerShell')
    case 'cmd':
      return t('settings.terminal.termCmd')
    case 'custom':
      return t('settings.terminal.customLabel')
    default:
      return id
  }
}

export function SettingsTerminal(): React.JSX.Element {
  const { t } = useTranslation()
  const {
    defaultTerminal,
    customTerminalCommand,
    embeddedTerminalBackend,
    ghosttyFontSize,
    terminalPosition,
    updateSetting
  } = useSettingsStore()
  const [detectedTerminals, setDetectedTerminals] = useState<DetectedTerminal[]>([])
  const [isDetecting, setIsDetecting] = useState(true)
  const [ghosttyAvailable, setGhosttyAvailable] = useState<boolean | null>(null)
  const [isMac, setIsMac] = useState(false)

  const positionOptions = useMemo(
    () =>
      [
        {
          id: 'sidebar' as const,
          label: t('settings.terminal.sidebar'),
          description: t('settings.terminal.sidebarDesc')
        },
        {
          id: 'bottom' as const,
          label: t('settings.terminal.bottomPanel'),
          description: t('settings.terminal.bottomDesc')
        }
      ] satisfies ReadonlyArray<{
        id: TerminalPosition
        label: string
        description: string
      }>,
    [t]
  )

  const backendOptions = useMemo(
    () =>
      [
        {
          id: 'xterm' as const,
          label: t('settings.terminal.backendXtermLabel'),
          description: t('settings.terminal.backendXtermDesc'),
          macOnly: false as boolean | undefined
        },
        {
          id: 'ghostty' as const,
          label: t('settings.terminal.backendGhosttyLabel'),
          description: t('settings.terminal.backendGhosttyDesc'),
          macOnly: true as boolean | undefined
        }
      ] satisfies ReadonlyArray<{
        id: EmbeddedTerminalBackend
        label: string
        description: string
        macOnly?: boolean
      }>,
    [t]
  )

  useEffect(() => {
    let cancelled = false
    async function detect(): Promise<void> {
      try {
        if (window.settingsOps?.detectTerminals) {
          const terminals = await window.settingsOps.detectTerminals()
          if (!cancelled) {
            setDetectedTerminals(terminals)
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

  useEffect(() => {
    let cancelled = false
    async function checkGhostty(): Promise<void> {
      try {
        const result = await window.terminalOps.ghosttyIsAvailable()
        if (!cancelled) {
          setGhosttyAvailable(result.available)
          setIsMac(result.platform === 'darwin')
        }
      } catch {
        if (!cancelled) {
          setGhosttyAvailable(false)
          setIsMac(false)
        }
      }
    }
    checkGhostty()
    return () => {
      cancelled = true
    }
  }, [])

  const isAvailable = (id: string): boolean => {
    if (id === 'custom') return true
    const terminal = detectedTerminals.find((t) => t.id === id)
    return terminal?.available ?? false
  }

  const canSelectBackend = (id: EmbeddedTerminalBackend): boolean => {
    if (id === 'xterm') return true
    if (id === 'ghostty') return isMac && ghosttyAvailable === true
    return false
  }

  const externalPlaceholder = isMacPlatform()
    ? t('settings.terminal.placeholderMac')
    : t('settings.terminal.placeholderWin')

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-base font-medium mb-1">{t('settings.terminal.positionHeading')}</h3>
        <p className="text-sm text-muted-foreground mb-3">{t('settings.terminal.positionHint')}</p>
        <div className="space-y-1">
          {positionOptions.map((opt) => {
            const isSelected = terminalPosition === opt.id
            return (
              <button
                key={opt.id}
                onClick={() => updateSetting('terminalPosition', opt.id)}
                className={cn(
                  'w-full flex items-start justify-between px-3 py-2.5 rounded-md text-sm transition-colors text-left',
                  isSelected
                    ? 'bg-primary/10 border border-primary/30'
                    : 'hover:bg-accent/50 border border-transparent'
                )}
                data-testid={`terminal-position-${opt.id}`}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span>{opt.label}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{opt.description}</p>
                </div>
                {isSelected && <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />}
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <h3 className="text-base font-medium mb-1">{t('settings.terminal.embeddedHeading')}</h3>
        <p className="text-sm text-muted-foreground mb-3">{t('settings.terminal.embeddedHint')}</p>
        <div className="space-y-1">
          {backendOptions.map((opt) => {
            const selectable = canSelectBackend(opt.id)
            const isSelected = embeddedTerminalBackend === opt.id
            return (
              <button
                key={opt.id}
                onClick={() => {
                  if (selectable) {
                    updateSetting('embeddedTerminalBackend', opt.id)
                  }
                }}
                disabled={!selectable}
                className={cn(
                  'w-full flex items-start justify-between px-3 py-2.5 rounded-md text-sm transition-colors text-left',
                  isSelected
                    ? 'bg-primary/10 border border-primary/30'
                    : 'hover:bg-accent/50 border border-transparent',
                  !selectable && 'opacity-50 cursor-not-allowed'
                )}
                data-testid={`backend-${opt.id}`}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span>{opt.label}</span>
                    {opt.macOnly && !isMac && (
                      <span className="text-xs text-muted-foreground">
                        {t('settings.terminal.macOsOnly')}
                      </span>
                    )}
                    {opt.id === 'ghostty' && isMac && ghosttyAvailable === false && (
                      <span className="text-xs text-muted-foreground">
                        {t('settings.terminal.notAvailable')}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{opt.description}</p>
                </div>
                {isSelected && <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />}
              </button>
            )
          })}
        </div>

        {embeddedTerminalBackend === 'ghostty' && (
          <>
            <div className="flex items-start gap-2 mt-3 p-2.5 rounded-md bg-blue-500/10 border border-blue-500/20 text-xs">
              <Info className="h-3.5 w-3.5 text-blue-500 shrink-0 mt-0.5" />
              <p className="text-muted-foreground">{t('settings.terminal.ghosttyInfo')}</p>
            </div>
            <div className="mt-4 space-y-2">
              <label className="text-sm font-medium">{t('settings.terminal.fontSize')}</label>
              <div className="flex items-center gap-3">
                <Input
                  type="number"
                  min={8}
                  max={32}
                  value={ghosttyFontSize}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10)
                    if (!isNaN(val) && val >= 8 && val <= 32) {
                      updateSetting('ghosttyFontSize', val)
                    }
                  }}
                  className="w-20 font-mono text-sm"
                  data-testid="ghostty-font-size"
                />
                <span className="text-xs text-muted-foreground">{t('settings.terminal.ptRange')}</span>
              </div>
              <p className="text-xs text-muted-foreground">{t('settings.terminal.fontSizeHint')}</p>
            </div>
          </>
        )}
      </div>

      <div>
        <h3 className="text-base font-medium mb-1">{t('settings.terminal.externalHeading')}</h3>
        <p className="text-sm text-muted-foreground mb-3">{t('settings.terminal.externalHint')}</p>

        {isDetecting ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('settings.terminal.detecting')}
          </div>
        ) : (
          <div className="space-y-1">
            {getTerminalIds().map((id) => {
              const available = isAvailable(id)
              const label = externalTerminalLabel(id, t)
              return (
                <button
                  key={id}
                  onClick={() => updateSetting('defaultTerminal', id)}
                  disabled={!available && id !== 'custom'}
                  className={cn(
                    'w-full flex items-center justify-between px-3 py-2.5 rounded-md text-sm transition-colors text-left',
                    defaultTerminal === id
                      ? 'bg-primary/10 border border-primary/30'
                      : 'hover:bg-accent/50 border border-transparent',
                    !available && id !== 'custom' && 'opacity-50 cursor-not-allowed'
                  )}
                  data-testid={`terminal-${id}`}
                >
                  <div className="flex items-center gap-2">
                    <span>{label}</span>
                    {!available && id !== 'custom' && (
                      <span className="text-xs text-muted-foreground">
                        {t('settings.terminal.notFound')}
                      </span>
                    )}
                  </div>
                  {defaultTerminal === id && <Check className="h-4 w-4 text-primary" />}
                </button>
              )
            })}
          </div>
        )}

        {defaultTerminal === 'custom' && (
          <div className="space-y-2 mt-3">
            <label className="text-sm font-medium">{t('settings.terminal.customCommand')}</label>
            <Input
              value={customTerminalCommand}
              onChange={(e) => updateSetting('customTerminalCommand', e.target.value)}
              placeholder={externalPlaceholder}
              className="font-mono text-sm"
              data-testid="custom-terminal-command"
            />
            <p className="text-xs text-muted-foreground">{t('settings.terminal.customHint')}</p>
          </div>
        )}
      </div>
    </div>
  )
}
