/**
 * Read ticket-import provider settings from localStorage.
 * Provider credentials are stored in a dedicated 'octob-provider-settings' key
 * to avoid being overwritten by the Zustand useSettingsStore which persists
 * to the 'octob-settings' key with a partialize function.
 */

const PROVIDER_SETTINGS_KEY = 'provider_settings'
const PROVIDER_SETTINGS_LOCAL_STORAGE_KEY = 'octob-provider-settings'
const AZURE_DEVOPS_SAVED_CONFIGS_KEY = 'azure_devops_saved_configs'
const AZURE_DEVOPS_SAVED_CONFIGS_LOCAL_STORAGE_KEY = 'octob-azure-devops-saved-configs'
const APP_SETTINGS_DB_KEY = 'app_settings'

export interface AzureDevOpsSavedConfig {
  id: string
  label: string
  settings: Record<string, string>
  updatedAt: string
}

function projectProviderSettingsKey(projectId: string): string {
  return `provider_settings:${projectId}`
}

function projectProviderLocalStorageKey(projectId: string): string {
  return `octob-provider-settings:${projectId}`
}

function azureDevOpsConfigId(settings: Record<string, string>): string | null {
  const org = settings.azure_devops_organization?.trim()
  const project = settings.azure_devops_project?.trim()
  if (!org || !project) return null
  return `${org.toLowerCase()}/${project.toLowerCase()}`
}

function azureDevOpsConfigLabel(settings: Record<string, string>): string {
  const org = settings.azure_devops_organization?.trim() ?? ''
  const project = settings.azure_devops_project?.trim() ?? ''
  return org && project ? `${org}/${project}` : 'Azure DevOps project'
}

function normalizeAzureDevOpsPat(raw: string): string {
  const value = raw.trim().replace(/^["']|["']$/g, '')
  if (!value) return value

  try {
    const decoded = atob(value)
    if (decoded.startsWith(':') && decoded.length > 1) return decoded.slice(1)
  } catch {
    // Not base64; keep the raw PAT.
  }

  return value
}

function azureDevOpsSettingsFromMcpServer(server: unknown): Record<string, string> | null {
  if (!server || typeof server !== 'object') return null
  const typed = server as {
    name?: unknown
    args?: unknown
    env?: unknown
  }
  const name = typeof typed.name === 'string' ? typed.name : ''
  const args = typeof typed.args === 'string' ? typed.args : ''
  const haystack = `${name} ${args}`.toLowerCase()
  if (!haystack.includes('@azure-devops/mcp') && !haystack.includes('azure-devops')) return null

  const argParts = args.split(/\s+/).filter(Boolean)
  const packageIndex = argParts.findIndex((part) => part === '@azure-devops/mcp')
  const organization =
    packageIndex >= 0 && argParts[packageIndex + 1] && !argParts[packageIndex + 1].startsWith('-')
      ? argParts[packageIndex + 1]
      : name.replace(/^azure-devops-/i, '').trim()

  const envRows = Array.isArray(typed.env) ? typed.env : []
  const tokenRow = envRows.find((row) => {
    if (!row || typeof row !== 'object') return false
    return (row as { name?: unknown }).name === 'PERSONAL_ACCESS_TOKEN'
  }) as { value?: unknown } | undefined
  const pat = typeof tokenRow?.value === 'string' ? normalizeAzureDevOpsPat(tokenRow.value) : ''

  if (!organization || !pat) return null

  return {
    azure_devops_organization: organization,
    azure_devops_project: '',
    azure_devops_pat: pat
  }
}

async function loadAzureDevOpsConfigsFromMcpSettings(): Promise<AzureDevOpsSavedConfig[]> {
  try {
    if (typeof window === 'undefined' || !window.db?.setting) return []
    const value = await window.db.setting.get(APP_SETTINGS_DB_KEY)
    if (!value) return []
    const parsed = JSON.parse(value) as { mcpServers?: unknown }
    const servers = Array.isArray(parsed.mcpServers) ? parsed.mcpServers : []
    return servers
      .map((server): AzureDevOpsSavedConfig | null => {
        const settings = azureDevOpsSettingsFromMcpServer(server)
        if (!settings) return null
        const id =
          azureDevOpsConfigId(settings) ??
          `mcp:${settings.azure_devops_organization.toLowerCase()}`
        const label = settings.azure_devops_project
          ? azureDevOpsConfigLabel(settings)
          : `${settings.azure_devops_organization} (MCP)`
        return {
          id,
          label,
          settings,
          updatedAt: ''
        }
      })
      .filter((config): config is AzureDevOpsSavedConfig => config !== null)
  } catch {
    return []
  }
}

export function getProviderSettings(): Record<string, string> {
  try {
    const raw = localStorage.getItem(PROVIDER_SETTINGS_LOCAL_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, string>
      return { ...parsed }
    }
  } catch {
    // ignore parse errors
  }
  return {}
}

export function getProjectProviderSettings(projectId: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(projectProviderLocalStorageKey(projectId))
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, string>
      return { ...parsed }
    }
  } catch {
    // ignore parse errors
  }
  return {}
}

export async function saveProviderSettingsToDatabase(settings: Record<string, string>): Promise<void> {
  try {
    if (typeof window !== 'undefined' && window.db?.setting) {
      await window.db.setting.set(PROVIDER_SETTINGS_KEY, JSON.stringify(settings))
    }
  } catch (error) {
    console.error('Failed to save provider settings to database:', error)
  }
}

export async function saveProjectProviderSettingsToDatabase(
  projectId: string,
  settings: Record<string, string>
): Promise<void> {
  try {
    localStorage.setItem(projectProviderLocalStorageKey(projectId), JSON.stringify(settings))
  } catch {
    // ignore localStorage errors
  }

  try {
    if (typeof window !== 'undefined' && window.db?.setting) {
      await window.db.setting.set(projectProviderSettingsKey(projectId), JSON.stringify(settings))
    }
  } catch (error) {
    console.error('Failed to save project provider settings to database:', error)
  }
}

export async function loadProviderSettingsFromDatabase(): Promise<Record<string, string> | null> {
  try {
    if (typeof window !== 'undefined' && window.db?.setting) {
      const value = await window.db.setting.get(PROVIDER_SETTINGS_KEY)
      if (value) {
        return JSON.parse(value) as Record<string, string>
      }
    }
  } catch (error) {
    console.error('Failed to load provider settings from database:', error)
  }
  return null
}

export async function loadProjectProviderSettingsFromDatabase(
  projectId: string
): Promise<Record<string, string> | null> {
  try {
    if (typeof window !== 'undefined' && window.db?.setting) {
      const value = await window.db.setting.get(projectProviderSettingsKey(projectId))
      if (value) {
        const parsed = JSON.parse(value) as Record<string, string>
        try {
          localStorage.setItem(projectProviderLocalStorageKey(projectId), JSON.stringify(parsed))
        } catch {
          // ignore localStorage errors
        }
        return parsed
      }
    }
  } catch (error) {
    console.error('Failed to load project provider settings from database:', error)
  }
  return null
}

export async function loadAzureDevOpsSavedConfigs(): Promise<AzureDevOpsSavedConfig[]> {
  let configs: AzureDevOpsSavedConfig[] = []

  try {
    const raw = localStorage.getItem(AZURE_DEVOPS_SAVED_CONFIGS_LOCAL_STORAGE_KEY)
    if (raw) configs = JSON.parse(raw) as AzureDevOpsSavedConfig[]
  } catch {
    // ignore parse errors
  }

  try {
    if (typeof window !== 'undefined' && window.db?.setting) {
      const value = await window.db.setting.get(AZURE_DEVOPS_SAVED_CONFIGS_KEY)
      if (value) {
        configs = JSON.parse(value) as AzureDevOpsSavedConfig[]
        try {
          localStorage.setItem(AZURE_DEVOPS_SAVED_CONFIGS_LOCAL_STORAGE_KEY, JSON.stringify(configs))
        } catch {
          // ignore localStorage errors
        }
      }
    }
  } catch (error) {
    console.error('Failed to load Azure DevOps saved configs from database:', error)
  }

  const mcpConfigs = await loadAzureDevOpsConfigsFromMcpSettings()
  const byId = new Map<string, AzureDevOpsSavedConfig>()
  for (const config of mcpConfigs) byId.set(config.id, config)
  for (const config of configs) byId.set(config.id, config)

  return Array.from(byId.values())
    .filter((config) => config.id && config.settings)
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
}

export async function upsertAzureDevOpsSavedConfig(
  settings: Record<string, string>
): Promise<AzureDevOpsSavedConfig[]> {
  const id = azureDevOpsConfigId(settings)
  if (!id) return loadAzureDevOpsSavedConfigs()

  const configs = await loadAzureDevOpsSavedConfigs()
  const nextConfig: AzureDevOpsSavedConfig = {
    id,
    label: azureDevOpsConfigLabel(settings),
    settings: { ...settings },
    updatedAt: new Date().toISOString()
  }
  const withoutCurrent = configs.filter((config) => config.id !== id)
  const next = [...withoutCurrent, nextConfig].sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
  )

  try {
    localStorage.setItem(AZURE_DEVOPS_SAVED_CONFIGS_LOCAL_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // ignore localStorage errors
  }

  try {
    if (typeof window !== 'undefined' && window.db?.setting) {
      await window.db.setting.set(AZURE_DEVOPS_SAVED_CONFIGS_KEY, JSON.stringify(next))
    }
  } catch (error) {
    console.error('Failed to save Azure DevOps saved configs to database:', error)
  }

  return next
}
