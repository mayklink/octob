import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ClipboardList, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  useSettingsStore,
  type TaskSessionPromptTemplate
} from '@/stores/useSettingsStore'

function newTemplateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function SettingsTaskPrompts(): JSX.Element {
  const { t } = useTranslation()
  const {
    taskSessionPromptTemplates,
    lastTaskSessionPromptTemplateId,
    updateSetting
  } = useSettingsStore()

  const templates = useMemo(() => taskSessionPromptTemplates ?? [], [taskSessionPromptTemplates])

  const updateTemplates = useCallback(
    (next: TaskSessionPromptTemplate[]): void => {
      updateSetting('taskSessionPromptTemplates', next)
    },
    [updateSetting]
  )

  const patchTemplate = useCallback(
    (id: string, patch: Partial<Pick<TaskSessionPromptTemplate, 'name' | 'body'>>): void => {
      updateTemplates(templates.map((row) => (row.id === id ? { ...row, ...patch } : row)))
    },
    [templates, updateTemplates]
  )

  const addTemplate = useCallback(() => {
    const row: TaskSessionPromptTemplate = {
      id: newTemplateId(),
      name: '',
      body: ''
    }
    updateTemplates([...templates, row])
  }, [templates, updateTemplates])

  const removeTemplate = useCallback(
    (id: string): void => {
      updateTemplates(templates.filter((row) => row.id !== id))
      if (lastTaskSessionPromptTemplateId === id) {
        updateSetting('lastTaskSessionPromptTemplateId', null)
      }
    },
    [templates, updateTemplates, lastTaskSessionPromptTemplateId, updateSetting]
  )

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-medium mb-1 flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-muted-foreground" aria-hidden />
          {t('settings.taskPrompts.heading')}
        </h3>
        <p className="text-sm text-muted-foreground">{t('settings.taskPrompts.description')}</p>
        <p className="text-xs text-muted-foreground mt-2">{t('settings.taskPrompts.structureHint')}</p>
      </div>

      {templates.length === 0 ?
        <p className="text-sm text-muted-foreground border border-dashed rounded-md px-4 py-6 text-center">
          {t('settings.taskPrompts.empty')}
        </p>
      : <div className="space-y-4">
          {templates.map((row) => (
            <div
              key={row.id}
              className="rounded-lg border bg-muted/20 p-3 space-y-2"
              data-testid={`task-prompt-template-${row.id}`}
            >
              <div className="flex items-start gap-2">
                <div className="flex-1 space-y-1.5 min-w-0">
                  <label className="text-xs font-medium text-muted-foreground">
                    {t('settings.taskPrompts.nameLabel')}
                  </label>
                  <Input
                    value={row.name}
                    onChange={(e) => patchTemplate(row.id, { name: e.target.value })}
                    placeholder={t('settings.taskPrompts.namePlaceholder')}
                    data-testid={`task-prompt-name-${row.id}`}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="shrink-0 mt-5 text-muted-foreground hover:text-destructive"
                  onClick={() => removeTemplate(row.id)}
                  aria-label={t('settings.taskPrompts.delete')}
                  data-testid={`task-prompt-remove-${row.id}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  {t('settings.taskPrompts.bodyLabel')}
                </label>
                <Textarea
                  value={row.body}
                  onChange={(e) => patchTemplate(row.id, { body: e.target.value })}
                  placeholder={t('settings.taskPrompts.bodyPlaceholder')}
                  rows={6}
                  className="resize-y font-mono text-xs leading-relaxed min-h-[120px]"
                  data-testid={`task-prompt-body-${row.id}`}
                />
              </div>
            </div>
          ))}
        </div>
      }

      <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={addTemplate}>
        <Plus className="h-3.5 w-3.5" />
        {t('settings.taskPrompts.add')}
      </Button>
    </div>
  )
}
