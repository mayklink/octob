import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Settings,
  Palette,
  Monitor,
  Code,
  Terminal,
  Keyboard,
  Shield,
  Eye,
  Wrench,
  Sparkles,
  Plug,
  Server,
  Bug,
  ClipboardList,
  RefreshCw,
  FileSearch,
  X
} from 'lucide-react'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { SettingsAppearance } from './SettingsAppearance'
import { SettingsGeneral } from './SettingsGeneral'
import { SettingsModels } from './SettingsModels'
import { SettingsEditor } from './SettingsEditor'
import { SettingsTerminal } from './SettingsTerminal'
import { SettingsShortcuts } from './SettingsShortcuts'
import { SettingsSecurity } from './SettingsSecurity'
import { SettingsPrivacy } from './SettingsPrivacy'
import { SettingsIntegrations } from './SettingsIntegrations'
import { SettingsMcp } from './SettingsMcp'
import { SettingsAdvanced } from './SettingsAdvanced'
import { SettingsPet } from './SettingsPet'
import { SettingsUpdates } from './SettingsUpdates'
import { SettingsTaskPrompts } from './SettingsTaskPrompts'
import { SettingsCodeReviewPrompts } from './SettingsCodeReviewPrompts'
import { cn } from '@/lib/utils'

type SettingsSectionId =
  | 'appearance'
  | 'general'
  | 'models'
  | 'task-prompts'
  | 'code-review-prompts'
  | 'pet'
  | 'editor'
  | 'terminal'
  | 'integrations'
  | 'mcp'
  | 'updates'
  | 'security'
  | 'privacy'
  | 'shortcuts'
  | 'advanced'

function useSettingsSections(): ReadonlyArray<{ id: SettingsSectionId; label: string; icon: typeof Palette }> {
  const { t } = useTranslation()
  return useMemo(
    () =>
      [
        { id: 'appearance' as const, label: t('settings.nav.appearance'), icon: Palette },
        { id: 'general' as const, label: t('settings.nav.general'), icon: Monitor },
        { id: 'task-prompts' as const, label: t('settings.nav.taskPrompts'), icon: ClipboardList },
        {
          id: 'code-review-prompts' as const,
          label: t('settings.nav.codeReviewPrompts'),
          icon: FileSearch
        },
        { id: 'models' as const, label: t('settings.nav.models'), icon: Sparkles },
        { id: 'pet' as const, label: t('settings.nav.pet'), icon: Bug },
        { id: 'editor' as const, label: t('settings.nav.editor'), icon: Code },
        { id: 'terminal' as const, label: t('settings.nav.terminal'), icon: Terminal },
        { id: 'integrations' as const, label: t('settings.nav.integrations'), icon: Plug },
        { id: 'mcp' as const, label: t('settings.nav.mcp'), icon: Server },
        { id: 'updates' as const, label: t('settings.nav.updates'), icon: RefreshCw },
        { id: 'security' as const, label: t('settings.nav.security'), icon: Shield },
        { id: 'privacy' as const, label: t('settings.nav.privacy'), icon: Eye },
        { id: 'shortcuts' as const, label: t('settings.nav.shortcuts'), icon: Keyboard },
        { id: 'advanced' as const, label: t('settings.nav.advanced'), icon: Wrench }
      ] satisfies ReadonlyArray<{ id: SettingsSectionId; label: string; icon: typeof Palette }>,
    [t]
  )
}

export function SettingsOpenListener(): null {
  const openSettings = useSettingsStore((s) => s.openSettings)

  // Listen for the custom event dispatched by keyboard shortcut handler
  useEffect(() => {
    const handleOpenSettings = (): void => {
      openSettings()
    }
    window.addEventListener('octob:open-settings', handleOpenSettings)
    return () => window.removeEventListener('octob:open-settings', handleOpenSettings)
  }, [openSettings])

  return null
}

export function SettingsView(): React.JSX.Element {
  const { t } = useTranslation()
  const activeSection = useSettingsStore((s) => s.activeSection)
  const closeSettings = useSettingsStore((s) => s.closeSettings)
  const setActiveSection = useSettingsStore((s) => s.setActiveSection)
  const sections = useSettingsSections()

  return (
    <div className="flex h-full min-h-0 bg-background" data-testid="settings-view">
      <nav className="w-64 border-r bg-muted/20 p-4 flex flex-col gap-1 shrink-0">
        <div className="flex items-center gap-2 px-2 py-1.5 mb-3">
          <Settings className="h-4 w-4 text-muted-foreground shrink-0" />
          <h1 className="text-sm font-semibold flex-1">{t('settings.title')}</h1>
          <button
            type="button"
            onClick={closeSettings}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Close settings"
            data-testid="settings-close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {sections.map((section) => {
          const Icon = section.icon
          return (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className={cn(
                'flex items-center gap-2 px-2 py-2 rounded-md text-sm transition-colors text-left',
                activeSection === section.id
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
              )}
              data-testid={`settings-nav-${section.id}`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{section.label}</span>
            </button>
          )
        })}
      </nav>

      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-8 py-8">
          {activeSection === 'appearance' && <SettingsAppearance />}
          {activeSection === 'general' && <SettingsGeneral />}
          {activeSection === 'task-prompts' && <SettingsTaskPrompts />}
          {activeSection === 'code-review-prompts' && <SettingsCodeReviewPrompts />}
          {activeSection === 'models' && <SettingsModels />}
          {activeSection === 'pet' && <SettingsPet />}
          {activeSection === 'editor' && <SettingsEditor />}
          {activeSection === 'terminal' && <SettingsTerminal />}
          {activeSection === 'integrations' && <SettingsIntegrations />}
          {activeSection === 'mcp' && <SettingsMcp />}
          {activeSection === 'updates' && <SettingsUpdates />}
          {activeSection === 'security' && <SettingsSecurity />}
          {activeSection === 'privacy' && <SettingsPrivacy />}
          {activeSection === 'shortcuts' && <SettingsShortcuts />}
          {activeSection === 'advanced' && <SettingsAdvanced />}
        </div>
      </div>
    </div>
  )
}

/**
 * Kept for compatibility with existing imports. Settings are rendered by MainPane.
 */
export function SettingsModal(): React.JSX.Element {
  return <SettingsOpenListener />
}
