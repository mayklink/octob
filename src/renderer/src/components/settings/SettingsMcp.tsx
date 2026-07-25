import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Loader2,
  Check,
  X,
  Plus,
  Trash2,
  Server,
  Search,
  Github,
  Cloud,
  Database,
  PencilRuler,
  FileText,
  Settings2
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { McpKeyValue, McpServerConfig, McpTransport } from '@shared/types/mcp'

function createId(): string {
  return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)
}

function formatKeyValues(rows: McpKeyValue[]): string {
  return rows.map((row) => `${row.name}=${row.value}`).join('\n')
}

function parseKeyValues(value: string): McpKeyValue[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const equalsIndex = line.indexOf('=')
      if (equalsIndex === -1) return { name: line, value: '' }
      return {
        name: line.slice(0, equalsIndex).trim(),
        value: line.slice(equalsIndex + 1)
      }
    })
    .filter((row) => row.name.length > 0)
}

function createEmptyMcpServer(): McpServerConfig {
  return {
    id: createId(),
    enabled: true,
    name: '',
    transport: 'stdio',
    command: '',
    args: '',
    env: [],
    url: '',
    headers: []
  }
}

function createNotionPreset(): McpServerConfig {
  return {
    ...createEmptyMcpServer(),
    name: 'Notion',
    transport: 'http',
    url: 'https://mcp.notion.com/mcp'
  }
}

function createSupabasePreset(): McpServerConfig {
  return {
    ...createEmptyMcpServer(),
    name: 'Supabase',
    transport: 'http',
    url: 'https://mcp.supabase.com/mcp?read_only=true'
  }
}

function createAzurePreset(): McpServerConfig {
  return {
    ...createEmptyMcpServer(),
    name: 'Azure',
    transport: 'stdio',
    command: 'npx',
    args: '-y @azure/mcp@latest server start'
  }
}

function createGitHubPreset(): McpServerConfig {
  return {
    ...createEmptyMcpServer(),
    name: 'GitHub',
    transport: 'http',
    url: 'https://api.githubcopilot.com/mcp/'
  }
}

function createExcalidrawPreset(): McpServerConfig {
  return {
    ...createEmptyMcpServer(),
    name: 'Excalidraw',
    transport: 'stdio'
  }
}

type McpPresetCategory = 'productivity' | 'coding' | 'cloud'

interface McpPreset {
  id: string
  name: string
  description: string
  category: McpPresetCategory
  icon: typeof Server
  create: () => McpServerConfig
}

export function SettingsMcp(): React.JSX.Element {
  const { t } = useTranslation()
  const mcpServers = useSettingsStore((state) => state.mcpServers)
  const updateSetting = useSettingsStore((state) => state.updateSetting)
  const [presetSearch, setPresetSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState<McpPresetCategory | 'all'>('all')
  const [expandedServerId, setExpandedServerId] = useState<string | null>(null)
  const [testingMcp, setTestingMcp] = useState<string | null>(null)
  const [mcpTestResult, setMcpTestResult] = useState<
    Record<string, { success: boolean; message: string } | null>
  >({})

  const presets = useMemo(
    (): McpPreset[] => [
      {
        id: 'notion',
        name: 'Notion',
        description: t('settings.mcp.presetDescriptions.notion'),
        category: 'productivity',
        icon: FileText,
        create: createNotionPreset
      },
      {
        id: 'supabase',
        name: 'Supabase',
        description: t('settings.mcp.presetDescriptions.supabase'),
        category: 'coding',
        icon: Database,
        create: createSupabasePreset
      },
      {
        id: 'azure',
        name: 'Azure',
        description: t('settings.mcp.presetDescriptions.azure'),
        category: 'cloud',
        icon: Cloud,
        create: createAzurePreset
      },
      {
        id: 'github',
        name: 'GitHub',
        description: t('settings.mcp.presetDescriptions.github'),
        category: 'coding',
        icon: Github,
        create: createGitHubPreset
      },
      {
        id: 'excalidraw',
        name: 'Excalidraw',
        description: t('settings.mcp.presetDescriptions.excalidraw'),
        category: 'productivity',
        icon: PencilRuler,
        create: createExcalidrawPreset
      }
    ],
    [t]
  )

  const categoryOptions: Array<{ id: McpPresetCategory | 'all'; label: string }> = [
    { id: 'all', label: t('settings.mcp.categories.all') },
    { id: 'productivity', label: t('settings.mcp.categories.productivity') },
    { id: 'coding', label: t('settings.mcp.categories.coding') },
    { id: 'cloud', label: t('settings.mcp.categories.cloud') }
  ]

  const filteredPresets = useMemo(() => {
    const query = presetSearch.trim().toLowerCase()
    return presets.filter((preset) => {
      const matchesCategory = activeCategory === 'all' || preset.category === activeCategory
      const matchesSearch =
        !query ||
        preset.name.toLowerCase().includes(query) ||
        preset.description.toLowerCase().includes(query)
      return matchesCategory && matchesSearch
    })
  }, [activeCategory, presetSearch, presets])

  const configuredPresetIdsByName = useMemo(() => {
    const idsByName = new Map<string, string>()
    for (const server of mcpServers) {
      const name = server.name.trim().toLowerCase()
      if (name && !idsByName.has(name)) idsByName.set(name, server.id)
    }
    return idsByName
  }, [mcpServers])

  const updateMcpServers = (next: McpServerConfig[]): void => {
    updateSetting('mcpServers', next)
  }

  const addMcpServer = (server: McpServerConfig = createEmptyMcpServer()): void => {
    updateMcpServers([...mcpServers, server])
    setExpandedServerId(server.id)
  }

  const updateMcpServer = (id: string, patch: Partial<McpServerConfig>): void => {
    updateMcpServers(mcpServers.map((server) => (server.id === id ? { ...server, ...patch } : server)))
  }

  const removeMcpServer = (id: string): void => {
    updateMcpServers(mcpServers.filter((server) => server.id !== id))
  }

  const handleMcpTest = async (server: McpServerConfig): Promise<void> => {
    setTestingMcp(server.id)
    setMcpTestResult((prev) => ({ ...prev, [server.id]: null }))

    try {
      if (typeof window.settingsOps.testMcpServer !== 'function') {
        throw new Error(
          'A função de teste MCP ainda não foi carregada no preload. Reinicie o Octob/dev server e tente novamente.'
        )
      }

      const result = await window.settingsOps.testMcpServer(server)
      setMcpTestResult((prev) => ({
        ...prev,
        [server.id]: { success: result.success, message: result.message }
      }))
      if (result.success) {
        toast.success(result.message)
      } else {
        toast.error(result.message)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setMcpTestResult((prev) => ({
        ...prev,
        [server.id]: { success: false, message }
      }))
      toast.error(message)
    } finally {
      setTestingMcp(null)
    }
  }

  return (
    <div className="space-y-8">
      <div className="mx-auto max-w-3xl space-y-4 text-center">
        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {t('settings.mcp.eyebrow')}
          </p>
          <h3 className="text-xl font-semibold">{t('settings.mcp.heading')}</h3>
          <p className="mt-2 text-sm text-muted-foreground">{t('settings.mcp.description')}</p>
        </div>

        <div className="relative mx-auto max-w-xl">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={presetSearch}
            onChange={(event) => setPresetSearch(event.target.value)}
            placeholder={t('settings.mcp.searchPlaceholder')}
            className="h-9 pl-9 text-sm"
          />
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2">
          {categoryOptions.map((category) => (
            <Button
              key={category.id}
              type="button"
              variant={activeCategory === category.id ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setActiveCategory(category.id)}
              className="h-8 rounded-full px-3 text-xs"
            >
              {category.label}
            </Button>
          ))}
        </div>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-medium">{t('settings.mcp.presetHeading')}</h4>
            <p className="text-xs text-muted-foreground">{t('settings.mcp.presetDescription')}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => addMcpServer()}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            {t('settings.mcp.addCustom')}
          </Button>
        </div>

        {filteredPresets.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
            {t('settings.mcp.noPresetMatches')}
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {filteredPresets.map((preset) => {
              const Icon = preset.icon
              const configuredServerId = configuredPresetIdsByName.get(preset.name.toLowerCase())
              const isConfigured = Boolean(configuredServerId)
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    if (configuredServerId) {
                      setExpandedServerId(configuredServerId)
                      return
                    }
                    const nextServer = preset.create()
                    addMcpServer(nextServer)
                  }}
                  className={cn(
                    'group flex min-h-24 items-center gap-3 rounded-xl border bg-card p-4 text-left transition-colors',
                    'hover:border-primary/40 hover:bg-accent/30',
                    isConfigured && 'border-primary/30 bg-primary/5'
                  )}
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-background">
                    <Icon className="h-5 w-5 text-foreground" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-medium">{preset.name}</span>
                      {isConfigured && (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                          {t('settings.mcp.configuredBadge')}
                        </span>
                      )}
                    </span>
                    <span className="mt-1 line-clamp-2 block text-xs text-muted-foreground">
                      {preset.description}
                    </span>
                  </span>
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-background text-muted-foreground group-hover:text-foreground">
                    {isConfigured ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h4 className="text-sm font-medium">{t('settings.mcp.configuredHeading')}</h4>
          <p className="text-xs text-muted-foreground">{t('settings.mcp.configuredDescription')}</p>
        </div>

        {mcpServers.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
            {t('settings.mcp.noMcpServers')}
          </p>
        ) : (
          mcpServers.map((server) => {
            const result = mcpTestResult[server.id]
            const isExpanded = expandedServerId === server.id

            return (
              <div key={server.id} className="overflow-hidden rounded-xl border bg-card">
                <div className="flex items-center justify-between gap-3 p-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <Checkbox
                      checked={server.enabled}
                      onCheckedChange={(checked) => updateMcpServer(server.id, { enabled: checked })}
                      aria-label={t('settings.mcp.enabled')}
                    />
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-background">
                      <Server className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {server.name.trim() || t('settings.mcp.unnamedServer')}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {server.transport === 'stdio'
                          ? [server.command, server.args].filter(Boolean).join(' ')
                          : server.url || t('settings.mcp.missingUrl')}
                      </div>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {result?.success === true && <Check className="h-4 w-4 text-green-500" />}
                    {result?.success === false && <X className="h-4 w-4 text-red-500" />}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={testingMcp !== null}
                      onClick={() => void handleMcpTest(server)}
                    >
                      {testingMcp === server.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                      ) : null}
                      {t('settings.mcp.testMcp')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setExpandedServerId(isExpanded ? null : server.id)}
                    >
                      <Settings2 className="h-3.5 w-3.5 mr-1.5" />
                      {isExpanded ? t('settings.mcp.hideDetails') : t('settings.mcp.editDetails')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground"
                      aria-label={t('settings.mcp.removeMcp')}
                      onClick={() => removeMcpServer(server.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="space-y-4 border-t p-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">
                          {t('settings.mcp.name')}
                        </label>
                        <Input
                          value={server.name}
                          placeholder={t('settings.mcp.namePlaceholder')}
                          onChange={(event) =>
                            updateMcpServer(server.id, { name: event.target.value })
                          }
                          className="text-sm h-8"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">
                          {t('settings.mcp.transport')}
                        </label>
                        <select
                          value={server.transport}
                          onChange={(event) =>
                            updateMcpServer(server.id, {
                              transport: event.target.value as McpTransport
                            })
                          }
                          className="h-8 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                        >
                          <option value="stdio">{t('settings.mcp.stdio')}</option>
                          <option value="http">{t('settings.mcp.http')}</option>
                          <option value="sse">{t('settings.mcp.sse')}</option>
                        </select>
                      </div>
                    </div>

                    {server.transport === 'stdio' ? (
                      <div className="space-y-3">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">
                              {t('settings.mcp.command')}
                            </label>
                            <Input
                              value={server.command}
                              placeholder={t('settings.mcp.commandPlaceholder')}
                              onChange={(event) =>
                                updateMcpServer(server.id, { command: event.target.value })
                              }
                              className="text-sm h-8"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">
                              {t('settings.mcp.args')}
                            </label>
                            <Input
                              value={server.args}
                              placeholder={t('settings.mcp.argsPlaceholder')}
                              onChange={(event) =>
                                updateMcpServer(server.id, { args: event.target.value })
                              }
                              className="text-sm h-8"
                            />
                          </div>
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground">
                            {t('settings.mcp.env')}
                          </label>
                          <Textarea
                            value={formatKeyValues(server.env)}
                            placeholder={t('settings.mcp.envPlaceholder')}
                            onChange={(event) =>
                              updateMcpServer(server.id, { env: parseKeyValues(event.target.value) })
                            }
                            className="min-h-[72px] font-mono text-xs"
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground">
                            {t('settings.mcp.url')}
                          </label>
                          <Input
                            value={server.url}
                            placeholder={t('settings.mcp.urlPlaceholder')}
                            onChange={(event) =>
                              updateMcpServer(server.id, { url: event.target.value })
                            }
                            className="text-sm h-8"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground">
                            {t('settings.mcp.headers')}
                          </label>
                          <Textarea
                            value={formatKeyValues(server.headers)}
                            placeholder={t('settings.mcp.headersPlaceholder')}
                            onChange={(event) =>
                              updateMcpServer(server.id, {
                                headers: parseKeyValues(event.target.value)
                              })
                            }
                            className="min-h-[72px] font-mono text-xs"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {(result || isExpanded) && (
                  <div className="border-t px-4 py-3">
                    <p className="text-xs text-muted-foreground">{t('settings.mcp.supportHint')}</p>
                    {result && (
                      <p
                        className={
                          result.success ? 'mt-2 text-xs text-green-500' : 'mt-2 text-xs text-red-500'
                        }
                      >
                        {result.message}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </section>
    </div>
  )
}
