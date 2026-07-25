import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { PullRequestInboxRepository } from '@shared/types/pull-request-inbox'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { ModelSelector } from '@/components/sessions/ModelSelector'
import { Switch } from '@/components/ui/switch'
import {
  REVIEW_PROMPT_LABELS,
  reviewPromptPresetIdForBuiltin,
  type ReviewPromptType
} from '@/constants/reviewPrompts'
import type {
  PullRequestReviewAgentSdk,
  PullRequestReviewRepositorySettings
} from '@/lib/pull-request-review-settings'
import { resolveModelForSdk, useSettingsStore, type SelectedModel } from '@/stores/useSettingsStore'

const BUILTIN_PROMPTS: ReviewPromptType[] = ['standard', 'superpowers', 'adversarial']

interface ReviewSettingsDialogProps {
  repository: PullRequestInboxRepository | null
  open: boolean
  value: PullRequestReviewRepositorySettings
  onOpenChange: (open: boolean) => void
  onSave: (value: PullRequestReviewRepositorySettings) => Promise<void>
}

export function ReviewSettingsDialog({
  repository,
  open,
  value,
  onOpenChange,
  onSave
}: ReviewSettingsDialogProps): React.JSX.Element {
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const customPrompts = useSettingsStore((state) => state.codeReviewPromptTemplates)

  useEffect(() => setDraft(value), [value, repository?.id, open])

  const changeAgent = (agentSdk: PullRequestReviewAgentSdk): void => {
    setDraft({
      ...draft,
      agentSdk,
      model: resolveModelForSdk(agentSdk) ?? null
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Review configuration</DialogTitle>
          <DialogDescription>
            {repository?.name ?? 'Repository'} · used whenever a review starts from this inbox.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="flex items-center justify-between gap-4 rounded-md border p-3">
            <div>
              <div className="text-sm font-medium">Automatic review</div>
              <div className="text-xs text-muted-foreground">
                Watch this repository and review new requested revisions automatically.
              </div>
            </div>
            <Switch
              checked={draft.automaticReviewEnabled === true}
              onCheckedChange={(checked) =>
                setDraft({ ...draft, automaticReviewEnabled: checked })
              }
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Agent</label>
            <select
              value={draft.agentSdk}
              onChange={(event) => changeAgent(event.target.value as PullRequestReviewAgentSdk)}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="opencode">OpenCode</option>
              <option value="claude-code">Claude Code</option>
              <option value="codex">Codex</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Model</label>
            <div className="rounded-md border px-1 py-0.5">
              <ModelSelector
                value={draft.model}
                onChange={(model: SelectedModel) => setDraft({ ...draft, model })}
                agentSdkOverride={draft.agentSdk}
                disableTitleTooltip
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Review prompt</label>
            <select
              value={draft.promptPresetId}
              onChange={(event) => setDraft({ ...draft, promptPresetId: event.target.value })}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            >
              {BUILTIN_PROMPTS.map((prompt) => (
                <option key={prompt} value={reviewPromptPresetIdForBuiltin(prompt)}>
                  {REVIEW_PROMPT_LABELS[prompt]}
                </option>
              ))}
              {customPrompts.map((prompt) => (
                <option key={prompt.id} value={prompt.id}>{prompt.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={saving}
            onClick={async () => {
              setSaving(true)
              try {
                await onSave(draft)
                onOpenChange(false)
              } finally {
                setSaving(false)
              }
            }}
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save configuration
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
