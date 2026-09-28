import { useCallback, useEffect, useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen, Loader2, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useProjectStore } from '@/stores/useProjectStore'

interface SkillSummary {
  id: string
  name: string
  description: string
  scope: 'global' | 'project' | 'builtin'
  projectId?: string
}

interface SkillListResult {
  skills: SkillSummary[]
  errors: Array<{ path: string; error: string }>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function SettingsSkills(): ReactElement {
  const { t } = useTranslation()
  const projects = useProjectStore((state) => state.projects)
  const loadProjects = useProjectStore((state) => state.loadProjects)
  const [projectId, setProjectId] = useState('')
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [discoveryErrors, setDiscoveryErrors] = useState<SkillListResult['errors']>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [formError, setFormError] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [instructions, setInstructions] = useState('')

  const refreshSkills = useCallback(async (): Promise<void> => {
    setLoading(true)
    setFormError('')
    try {
      const result = await window.assistantOps.listSkills(projectId || undefined)
      setSkills(result.skills)
      setDiscoveryErrors(result.errors)
    } catch (error) {
      setSkills([])
      setDiscoveryErrors([])
      setFormError(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    if (projects.length === 0) void loadProjects()
  }, [loadProjects, projects.length])

  useEffect(() => {
    void refreshSkills()
  }, [refreshSkills])

  const handleCreate = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!name.trim() || !description.trim() || !instructions.trim()) return

    setSubmitting(true)
    setFormError('')
    try {
      await window.assistantOps.createSkill({
        name: name.trim(),
        description: description.trim(),
        instructions: instructions.trim(),
        ...(projectId ? { projectId } : {})
      })
      setName('')
      setDescription('')
      setInstructions('')
      await refreshSkills()
    } catch (error) {
      setFormError(errorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (skill: SkillSummary): Promise<void> => {
    const scopeLabel = skill.scope === 'global'
      ? t('settings.skills.globalScope')
      : skill.scope === 'builtin'
        ? t('settings.skills.builtinScope')
        : projects.find((project) => project.id === skill.projectId)?.name ?? t('settings.skills.projectScope')
    const confirmed = window.confirm(
      t('settings.skills.confirmDelete', { name: skill.name, scope: scopeLabel })
    )
    if (!confirmed) return

    setDeletingId(skill.id)
    setFormError('')
    try {
      await window.assistantOps.deleteSkill(skill.id, skill.scope === 'project' ? skill.projectId : undefined)
      await refreshSkills()
    } catch (error) {
      setFormError(errorMessage(error))
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-6" data-testid="settings-skills">
      <div>
        <h3 className="mb-1 flex items-center gap-2 text-base font-medium">
          <BookOpen className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {t('settings.skills.heading')}
        </h3>
        <p className="text-sm text-muted-foreground">{t('settings.skills.description')}</p>
      </div>

      <section className="space-y-4 rounded-lg border bg-muted/20 p-4" aria-labelledby="skills-create-heading">
        <div>
          <h4 id="skills-create-heading" className="text-sm font-medium">{t('settings.skills.createHeading')}</h4>
          <p className="mt-1 text-xs text-muted-foreground">{t('settings.skills.createHint')}</p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="skill-project" className="text-xs font-medium text-muted-foreground">
            {t('settings.skills.scopeLabel')}
          </label>
          <select
            id="skill-project"
            name="projectId"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            data-testid="skills-project-select"
          >
            <option value="">{t('settings.skills.globalScope')}</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
        </div>

        <form onSubmit={(event) => void handleCreate(event)} className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="skill-name" className="text-xs font-medium text-muted-foreground">
              {t('settings.skills.nameLabel')}
            </label>
            <Input
              id="skill-name"
              name="name"
              autoComplete="off"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('settings.skills.namePlaceholder')}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              maxLength={64}
              required
              data-testid="skills-name"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="skill-description" className="text-xs font-medium text-muted-foreground">
              {t('settings.skills.descriptionLabel')}
            </label>
            <Input
              id="skill-description"
              name="description"
              autoComplete="off"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t('settings.skills.descriptionPlaceholder')}
              maxLength={1024}
              required
              data-testid="skills-description"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="skill-instructions" className="text-xs font-medium text-muted-foreground">
              {t('settings.skills.instructionsLabel')}
            </label>
            <Textarea
              id="skill-instructions"
              name="instructions"
              autoComplete="off"
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              placeholder={t('settings.skills.instructionsPlaceholder')}
              rows={7}
              className="min-h-[150px] resize-y font-mono text-xs leading-relaxed"
              required
              data-testid="skills-instructions"
            />
          </div>
          {formError && <p role="alert" className="break-words text-sm text-destructive">{formError}</p>}
          <Button type="submit" size="sm" className="gap-1.5" disabled={submitting}>
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Plus className="h-3.5 w-3.5" aria-hidden="true" />}
            {submitting ? t('settings.skills.creating') : t('settings.skills.create')}
          </Button>
        </form>
      </section>

      <section className="space-y-3" aria-labelledby="skills-list-heading" aria-live="polite">
        <div className="flex items-center justify-between gap-3">
          <h4 id="skills-list-heading" className="text-sm font-medium">{t('settings.skills.listHeading')}</h4>
          {!loading && <span className="text-xs text-muted-foreground">{t('settings.skills.count', { count: skills.length })}</span>}
        </div>

        {discoveryErrors.length > 0 && (
          <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3" role="status">
            <p className="text-sm font-medium">{t('settings.skills.discoveryErrors')}</p>
            {discoveryErrors.map((item) => (
              <p key={`${item.path}:${item.error}`} className="break-words text-xs text-muted-foreground">
                <span className="font-mono">{item.path}</span>: {item.error}
              </p>
            ))}
          </div>
        )}

        {loading ? (
          <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {t('settings.skills.loading')}
          </p>
        ) : skills.length === 0 ? (
          <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            {t('settings.skills.empty')}
          </p>
        ) : (
          <ul className="space-y-2">
            {skills.map((skill) => (
              <li key={`${skill.scope}:${skill.id}`} className="flex items-start gap-3 rounded-lg border p-3" data-testid={`skill-row-${skill.id}`}>
                <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="break-words text-sm font-medium">{skill.name}</p>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                      {skill.scope === 'global'
                        ? t('settings.skills.globalScope')
                        : skill.scope === 'builtin'
                          ? t('settings.skills.builtinScope')
                          : t('settings.skills.projectBadge', {
                            name: projects.find((project) => project.id === skill.projectId)?.name ?? t('settings.skills.projectScope')
                          })}
                    </span>
                  </div>
                  <p className="mt-1 break-words text-xs text-muted-foreground">{skill.description}</p>
                </div>
                {skill.scope !== 'builtin' && <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => void handleDelete(skill)}
                  disabled={deletingId === skill.id}
                  aria-label={t('settings.skills.deleteAria', { name: skill.name })}
                  title={t('settings.skills.delete')}
                  data-testid={`skills-delete-${skill.id}`}
                >
                  {deletingId === skill.id
                    ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    : <Trash2 className="h-4 w-4" aria-hidden="true" />}
                </Button>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
