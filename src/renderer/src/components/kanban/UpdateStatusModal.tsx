import { useState, useEffect } from 'react'
import {
  getProjectProviderSettings,
  getProviderSettings,
  loadProjectProviderSettingsFromDatabase
} from '@/lib/provider-settings'
import { getProviderLabel } from '@/components/ui/provider-icon'
import { Loader2, RefreshCw } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

interface UpdateStatusModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  externalProvider: string
  projectId: string
  externalId: string
  externalUrl: string
  ticketTitle: string
}

function resolveTicketImportRepo(
  externalProvider: string,
  externalUrl: string,
  settings: Record<string, string>
): string | null {
  if (externalProvider === 'github') {
    const match = externalUrl.match(/github\.com\/([^/]+\/[^/]+)/)
    return match ? match[1].replace(/\.git$/, '').replace(/\/+$/, '') : null
  }
  if (externalProvider === 'jira') {
    const d = settings.jira_domain?.trim()
    return d ? d.replace(/^https?:\/\//, '').replace(/\/+$/, '') : null
  }
  if (externalProvider === 'azure_devops') {
    const org = settings.azure_devops_organization?.trim()
    const proj = settings.azure_devops_project?.trim()
    if (!org || !proj) return null
    return `${org}/${proj}`
  }
  return null
}

function hasAzureDevOpsConfig(settings: Record<string, string>): boolean {
  return Boolean(
    settings.azure_devops_organization?.trim() &&
      settings.azure_devops_project?.trim() &&
      settings.azure_devops_pat?.trim()
  )
}

export function UpdateStatusModal({
  open,
  onOpenChange,
  externalProvider,
  projectId,
  externalId,
  externalUrl,
  ticketTitle
}: UpdateStatusModalProps) {
  const [statuses, setStatuses] = useState<Array<{ id: string; label: string }>>([])
  const [loading, setLoading] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [repo, setRepo] = useState<string | null>(null)

  const providerLabel = getProviderLabel(externalProvider)

  useEffect(() => {
    if (!open) return
    let cancelled = false

    setLoading(true)
    void (async () => {
      let freshSettings = getProviderSettings()
      if (externalProvider === 'azure_devops') {
        const projectSettings = {
          ...getProjectProviderSettings(projectId),
          ...((await loadProjectProviderSettingsFromDatabase(projectId)) ?? {})
        }
        if (hasAzureDevOpsConfig(projectSettings)) {
          freshSettings = projectSettings
        }
      }

      const resolvedRepo = resolveTicketImportRepo(externalProvider, externalUrl, freshSettings)
      if (cancelled) return
      setSettings(freshSettings)
      setRepo(resolvedRepo)

      if (!resolvedRepo) {
        setStatuses([])
        setLoading(false)
        return
      }

      window.ticketImport
        .getAvailableStatuses(externalProvider, resolvedRepo, externalId, freshSettings)
        .then((nextStatuses) => {
          if (!cancelled) setStatuses(nextStatuses)
        })
        .catch((err) => {
          if (!cancelled) {
            toast.error(`Failed to fetch statuses: ${err instanceof Error ? err.message : String(err)}`)
            setStatuses([])
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    })()

    return () => {
      cancelled = true
    }
  }, [open, externalProvider, externalId, externalUrl, projectId])

  const handleUpdate = async (statusId: string) => {
    if (!repo) return

    setUpdating(true)
    try {
      const result = await window.ticketImport.updateRemoteStatus(
        externalProvider,
        repo,
        externalId,
        statusId,
        settings
      )
      if (result.success) {
        toast.success(`Updated #${externalId} to "${statuses.find((s) => s.id === statusId)?.label}"`)
        onOpenChange(false)
      } else {
        toast.error(result.error ?? 'Failed to update status')
      }
    } catch (err) {
      toast.error(`Failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setUpdating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <RefreshCw className="h-4 w-4" />
            Update status on {providerLabel}
          </DialogTitle>
          <p className="text-xs text-muted-foreground truncate mt-1">
            #{externalId} — {ticketTitle}
          </p>
        </DialogHeader>

        <div className="flex flex-col gap-2 py-2">
          {!repo && (
            <p className="text-xs text-muted-foreground px-1">
              Configure este provider no importador do projeto, ou abra o ticket a partir de uma URL
              vinculada para o board resolver o projeto remoto.
            </p>
          )}
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading statuses...
            </div>
          ) : repo && statuses.length === 0 ? (
            <div className="text-xs text-muted-foreground py-2 px-1">No available transitions found.</div>
          ) : (
            statuses.map((status) => (
              <Button
                key={status.id}
                variant="outline"
                size="sm"
                disabled={updating || !repo}
                onClick={() => void handleUpdate(status.id)}
                className="justify-start"
              >
                {status.label}
              </Button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
