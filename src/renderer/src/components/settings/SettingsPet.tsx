import { Bug, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { PetSettings, PetSize } from '@shared/types/pet'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { listPets } from '@/pet/registry'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useMemo } from 'react'

export function SettingsPet(): React.JSX.Element {
  const { t } = useTranslation()
  const { pet, updateSetting } = useSettingsStore()
  const pets = listPets()

  const sizeOptions = useMemo(
    () =>
      [
        { id: 'S' as const, label: 'S', description: t('settings.pet.sizePx64') },
        { id: 'M' as const, label: 'M', description: t('settings.pet.sizePx96') },
        { id: 'L' as const, label: 'L', description: t('settings.pet.sizePx128') }
      ] satisfies ReadonlyArray<{ id: PetSize; label: string; description: string }>,
    [t]
  )

  const updatePet = (partial: Partial<PetSettings>): void => {
    updateSetting('pet', { ...pet, ...partial })
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-medium mb-1">{t('settings.pet.heading')}</h3>
        <p className="text-sm text-muted-foreground">{t('settings.pet.description')}</p>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <label className="text-sm font-medium">{t('settings.pet.enable')}</label>
          <p className="text-xs text-muted-foreground">{t('settings.pet.enableHint')}</p>
        </div>
        <button
          role="switch"
          aria-checked={pet.enabled}
          onClick={() => updatePet({ enabled: !pet.enabled })}
          className={cn(
            'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
            pet.enabled ? 'bg-primary' : 'bg-muted'
          )}
          data-testid="pet-enabled-toggle"
        >
          <span
            className={cn(
              'pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform',
              pet.enabled ? 'translate-x-4' : 'translate-x-0'
            )}
          />
        </button>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">{t('settings.pet.character')}</label>
        <select
          value={pet.petId}
          onChange={(event) => updatePet({ petId: event.target.value })}
          className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
          data-testid="pet-selector"
        >
          {pets.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">{t('settings.pet.size')}</label>
        <div className="grid grid-cols-3 gap-2">
          {sizeOptions.map((option) => {
            const selected = pet.size === option.id
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => updatePet({ size: option.id })}
                className={cn(
                  'flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors',
                  selected
                    ? 'border-primary/40 bg-primary/10'
                    : 'border-border bg-muted/30 hover:bg-accent/50'
                )}
                data-testid={`pet-size-${option.id}`}
              >
                <span>
                  <span className="block font-medium">{option.label}</span>
                  <span className="text-xs text-muted-foreground">{option.description}</span>
                </span>
                {selected && <Check className="h-4 w-4 text-primary" />}
              </button>
            )
          })}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">{t('settings.pet.opacity')}</label>
          <span className="text-xs text-muted-foreground">{Math.round(pet.opacity * 100)}%</span>
        </div>
        <input
          type="range"
          min={20}
          max={100}
          step={5}
          value={Math.round(pet.opacity * 100)}
          onChange={(event) => updatePet({ opacity: Number(event.target.value) / 100 })}
          className="w-full accent-primary"
          data-testid="pet-opacity-slider"
        />
      </div>

      {pet.enabled && (
        <Button
          type="button"
          variant="outline"
          className="gap-2"
          onClick={() => window.petOps.show()}
          data-testid="show-pet-button"
        >
          <Bug className="h-4 w-4" />
          {t('settings.pet.showPet')}
        </Button>
      )}
    </div>
  )
}
