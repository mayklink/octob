import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { APP_SETTINGS_DB_KEY } from '@shared/types/settings'
import type { UsageProvider } from '@shared/types/usage'
import type { PetSettings } from '@shared/types/pet'
import type { McpServerConfig } from '@shared/types/mcp'
import {
  DEFAULT_REVIEW_PROMPT_PRESET_ID,
  getBuiltinReviewPromptType,
  reviewPromptPresetIdForBuiltin,
  type ReviewPromptType
} from '@/constants/reviewPrompts'

// ==========================================
// Types
// ==========================================

export type EditorOption = 'vscode' | 'cursor' | 'sublime' | 'webstorm' | 'zed' | 'custom'
export type TerminalOption =
  | 'terminal'
  | 'iterm'
  | 'warp'
  | 'alacritty'
  | 'kitty'
  | 'ghostty'
  | 'powershell'
  | 'cmd'
  | 'custom'
export type EmbeddedTerminalBackend = 'xterm' | 'ghostty'
export type TerminalPosition = 'sidebar' | 'bottom'
export type MergeConflictMode = 'build' | 'plan' | 'always-ask'
export type FollowUpTriggerColumn = 'review' | 'done'

export interface SelectedModel {
  providerID: string
  modelID: string
  variant?: string
}

export type AgentSdk = 'opencode' | 'claude-code' | 'codex' | 'mistral-vibe' | 'cursor-cli' | 'antigravity' | 'terminal'
export type HandoffAgentSdk = Exclude<AgentSdk, 'terminal'>

export interface ModeDefaultModels {
  build: SelectedModel | null
  plan: SelectedModel | null
  ask: SelectedModel | null
}

export type QuickActionType = 'cursor' | 'terminal' | 'copy-path' | 'finder'

export interface CommandFilterSettings {
  allowlist: string[]
  blocklist: string[]
  defaultBehavior: 'ask' | 'allow' | 'block'
  enabled: boolean
  enterToApprove: boolean
}

export type UiLocale = 'en' | 'pt-BR'

/** Saved instructional text prepended before the ticket XML block in Start Session. */
export interface TaskSessionPromptTemplate {
  id: string
  name: string
  body: string
}

export interface AppSettings {
  // Locale
  uiLocale: UiLocale

  // General
  autoStartSession: boolean
  autoPullBeforeWorktree: boolean
  breedType: 'dogs' | 'cats'
  vimModeEnabled: boolean
  keepAwakeEnabled: boolean
  taskListCollapsed: boolean
  mergeConflictMode: MergeConflictMode
  boardMode: 'toggle' | 'sticky-tab'
  followUpTriggerColumn: FollowUpTriggerColumn
  autoCodeReviewEnabled: boolean

  // Editor
  defaultEditor: EditorOption
  customEditorCommand: string

  // Terminal
  defaultTerminal: TerminalOption
  customTerminalCommand: string
  embeddedTerminalBackend: EmbeddedTerminalBackend
  ghosttyFontSize: number
  ghosttyPromotionDismissed: boolean
  terminalPosition: TerminalPosition

  // Model
  selectedModel: SelectedModel | null
  selectedModelByProvider: Record<string, SelectedModel>
  defaultModels: ModeDefaultModels | null
  lastHandoffOverride: {
    agentSdk: HandoffAgentSdk
    providerID: string
    modelID: string
    variant?: string
  } | null

  // Quick Actions
  lastOpenAction: QuickActionType | null

  // Favorites
  favoriteModels: string[] // Array of "providerID::modelID" keys

  // Chrome
  customChromeCommand: string // Custom chrome launch command, e.g. "open -a Chrome {url}"

  // Variant defaults per model
  modelVariantDefaults: Record<string, string> // "providerID::modelID" → variant

  // Model icons
  showModelIcons: boolean

  // Model provider
  showModelProvider: boolean

  // Usage indicator
  usageIndicatorMode: 'current-agent' | 'specific-providers'
  usageIndicatorProviders: UsageProvider[]

  // Agent SDK
  defaultAgentSdk: AgentSdk
  customCodexBinaryPath: string

  // Setup
  initialSetupComplete: boolean

  // Chat
  stripAtMentions: boolean
  codexFastMode: boolean
  codexFastModeAccepted: boolean

  // Updates
  updateChannel: 'stable' | 'canary'
  skippedUpdateVersion: string | null

  // Command Filter
  commandFilter: CommandFilterSettings

  // Privacy
  telemetryEnabled: boolean

  // Tips
  tipsEnabled: boolean

  // Pet
  pet: PetSettings

  // Advanced
  environmentVariables: Array<{ key: string; value: string }>

  // MCP
  mcpServers: McpServerConfig[]

  // Diagnostics
  perfDiagnosticsEnabled: boolean
  codexJsonlLoggingEnabled: boolean
  codexJsonlResetPerSession: boolean

  // Code review (header Review → AI branch review)
  /** `builtin:${type}` for built-ins, otherwise a UUID of an entry in `codeReviewPromptTemplates`. */
  reviewPromptPresetId: string
  codeReviewPromptTemplates: TaskSessionPromptTemplate[]

  // Kanban / Start Session
  /** User-defined instructional prompts combined with structured ticket XML. */
  taskSessionPromptTemplates: TaskSessionPromptTemplate[]
  /** Starts the picker with this template applied when valid; null uses built-in prefixes. */
  lastTaskSessionPromptTemplateId: string | null

  // Migration flags
  _boardModeMigratedToStickyTab?: boolean
}

const DEFAULT_SETTINGS: AppSettings = {
  uiLocale: 'en',
  autoStartSession: true,
  autoPullBeforeWorktree: true,
  breedType: 'dogs',
  vimModeEnabled: false,
  keepAwakeEnabled: false,
  taskListCollapsed: false,
  mergeConflictMode: 'always-ask',
  boardMode: 'sticky-tab',
  followUpTriggerColumn: 'done',
  autoCodeReviewEnabled: true,
  defaultEditor: 'vscode',
  customEditorCommand: '',
  defaultTerminal: 'terminal',
  customTerminalCommand: '',
  embeddedTerminalBackend: 'xterm',
  ghosttyFontSize: 14,
  ghosttyPromotionDismissed: false,
  terminalPosition: 'sidebar',
  selectedModel: null,
  selectedModelByProvider: {},
  defaultModels: null,
  lastHandoffOverride: null,
  lastOpenAction: null,
  favoriteModels: [],
  customChromeCommand: '',
  modelVariantDefaults: {},
  showModelIcons: false,
  showModelProvider: false,
  usageIndicatorMode: 'current-agent',
  usageIndicatorProviders: [],
  defaultAgentSdk: 'opencode',
  customCodexBinaryPath: '',
  stripAtMentions: true,
  codexFastMode: false,
  codexFastModeAccepted: false,
  updateChannel: 'stable',
  skippedUpdateVersion: null,
  initialSetupComplete: false,
  commandFilter: {
    allowlist: ['edit: **', 'write: **'],
    blocklist: [
      'bash: rm -rf *',
      'bash: sudo rm *',
      'bash: sudo *',
      'edit: **/.env',
      'edit: **/*.key',
      'edit: **/credentials*',
      'write: **/.env',
      'write: **/*.key',
      'write: **/credentials*'
    ],
    defaultBehavior: 'ask',
    enabled: false,
    enterToApprove: false
  },
  telemetryEnabled: true,
  tipsEnabled: true,
  pet: {
    enabled: false,
    petId: 'octob',
    size: 'M',
    opacity: 1,
    hasHatched: false
  },
  environmentVariables: [],
  mcpServers: [],
  perfDiagnosticsEnabled: false,
  codexJsonlLoggingEnabled: false,
  codexJsonlResetPerSession: true,
  reviewPromptPresetId: DEFAULT_REVIEW_PROMPT_PRESET_ID,
  codeReviewPromptTemplates: [],
  taskSessionPromptTemplates: [],
  lastTaskSessionPromptTemplateId: null,
  _boardModeMigratedToStickyTab: false
}

interface SettingsState extends AppSettings {
  isOpen: boolean
  activeSection: string
  isLoading: boolean

  // Cached SDK availability (non-persisted, re-detected each launch)
  availableAgentSdks: {
    opencode: boolean
    claude: boolean
    codex: boolean
    mistralVibe: boolean
    cursorCli: boolean
    antigravity: boolean
    antigravityVersion: string | null
  } | null

  // Actions
  openSettings: (section?: string) => void
  closeSettings: () => void
  setActiveSection: (section: string) => void
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>
  setSelectedModel: (
    model: SelectedModel | null,
    agentSdk?: AppSettings['defaultAgentSdk']
  ) => Promise<void>
  setSelectedModelForSdk: (
    agentSdk: AppSettings['defaultAgentSdk'],
    model: SelectedModel | null,
    options?: { skipBackendPush?: boolean }
  ) => Promise<void>
  setModeDefaultModel: (
    mode: 'build' | 'plan' | 'ask',
    model: SelectedModel | null
  ) => Promise<void>
  getModelForMode: (mode: 'build' | 'plan' | 'ask') => SelectedModel | null
  setLastHandoffOverride: (value: AppSettings['lastHandoffOverride']) => void
  toggleFavoriteModel: (providerID: string, modelID: string) => void
  setModelVariantDefault: (providerID: string, modelID: string, variant: string) => void
  getModelVariantDefault: (providerID: string, modelID: string) => string | undefined
  resetToDefaults: () => void
  loadFromDatabase: () => Promise<void>
  detectAvailableAgentSdks: () => Promise<void>
}

async function saveToDatabase(settings: AppSettings): Promise<void> {
  try {
    if (typeof window !== 'undefined' && window.db?.setting) {
      await window.db.setting.set(APP_SETTINGS_DB_KEY, JSON.stringify(settings))
    }
  } catch (error) {
    console.error('Failed to save settings to database:', error)
  }
}

function normalizeKeyValues(value: unknown): Array<{ name: string; value: string }> {
  if (!Array.isArray(value)) return []
  return value
    .map((row) => {
      if (!row || typeof row !== 'object') return null
      const typed = row as Record<string, unknown>
      const name = typeof typed.name === 'string' ? typed.name.trim() : ''
      const rowValue = typeof typed.value === 'string' ? typed.value : ''
      if (!name) return null
      return { name, value: rowValue }
    })
    .filter((row): row is { name: string; value: string } => row !== null)
}

function normalizeMcpServers(value: unknown): McpServerConfig[] {
  if (!Array.isArray(value)) return []
  return value
    .map((row) => {
      if (!row || typeof row !== 'object') return null
      const typed = row as Record<string, unknown>
      const id = typeof typed.id === 'string' && typed.id ? typed.id : crypto.randomUUID()
      const name = typeof typed.name === 'string' ? typed.name : ''
      const transport =
        typed.transport === 'http' || typed.transport === 'sse' || typed.transport === 'stdio'
          ? typed.transport
          : 'stdio'
      return {
        id,
        enabled: typed.enabled !== false,
        name,
        transport,
        command: typeof typed.command === 'string' ? typed.command : '',
        args: typeof typed.args === 'string' ? typed.args : '',
        env: normalizeKeyValues(typed.env),
        url: typeof typed.url === 'string' ? typed.url : '',
        headers: normalizeKeyValues(typed.headers)
      }
    })
    .filter((server): server is McpServerConfig => server !== null)
}

async function loadSettingsFromDatabase(): Promise<AppSettings | null> {
  try {
    if (typeof window !== 'undefined' && window.db?.setting) {
      const value = await window.db.setting.get(APP_SETTINGS_DB_KEY)
      if (value) {
        const parsed = JSON.parse(value) as Record<string, unknown>
        const rawTaskTemplates = parsed.taskSessionPromptTemplates
        const normalizedTaskTemplates =
          Array.isArray(rawTaskTemplates) ?
            rawTaskTemplates.filter(
              (row): row is TaskSessionPromptTemplate =>
                !!row &&
                typeof row === 'object' &&
                typeof (row as TaskSessionPromptTemplate).id === 'string' &&
                typeof (row as TaskSessionPromptTemplate).name === 'string' &&
                typeof (row as TaskSessionPromptTemplate).body === 'string'
            )
          : undefined

        const rawCodeReviewTemplates = parsed.codeReviewPromptTemplates
        const normalizedCodeReviewTemplates =
          Array.isArray(rawCodeReviewTemplates) ?
            rawCodeReviewTemplates.filter(
              (row): row is TaskSessionPromptTemplate =>
                !!row &&
                typeof row === 'object' &&
                typeof (row as TaskSessionPromptTemplate).id === 'string' &&
                typeof (row as TaskSessionPromptTemplate).name === 'string' &&
                typeof (row as TaskSessionPromptTemplate).body === 'string'
            )
          : undefined

        let migratedReviewPresetId: string | undefined
        if (typeof parsed.reviewPromptPresetId === 'string' && parsed.reviewPromptPresetId.length > 0) {
          migratedReviewPresetId = parsed.reviewPromptPresetId as string
        } else if (
          parsed.reviewPromptType === 'superpowers' ||
          parsed.reviewPromptType === 'adversarial' ||
          parsed.reviewPromptType === 'standard'
        ) {
          migratedReviewPresetId = reviewPromptPresetIdForBuiltin(parsed.reviewPromptType as ReviewPromptType)
        }

        const result = {
          ...DEFAULT_SETTINGS,
          ...parsed,
          ...(normalizedTaskTemplates !== undefined ?
            { taskSessionPromptTemplates: normalizedTaskTemplates }
          : {}),
          ...(normalizedCodeReviewTemplates !== undefined ?
            { codeReviewPromptTemplates: normalizedCodeReviewTemplates }
          : {}),
          ...(migratedReviewPresetId !== undefined ?
            { reviewPromptPresetId: migratedReviewPresetId }
          : {}),
          // Deep-merge commandFilter so new fields (e.g. `enabled`) always have defaults
          // even for users whose saved settings pre-date those fields being added.
          commandFilter: {
            ...DEFAULT_SETTINGS.commandFilter,
            ...(parsed.commandFilter || {})
          },
          pet: {
            ...DEFAULT_SETTINGS.pet,
            ...(parsed.pet || {})
          },
          mcpServers: normalizeMcpServers(parsed.mcpServers)
        }

        if (result.pet.petId === 'bee' || result.pet.petId === 'corgi') {
          result.pet = { ...result.pet, petId: 'octob' }
        }

        const petWasLegacy =
          typeof parsed.pet === 'object' &&
          parsed.pet !== null &&
          ((parsed.pet as PetSettings).petId === 'bee' ||
            (parsed.pet as PetSettings).petId === 'corgi')

        delete (result as Record<string, unknown>).reviewPromptType

        const validBuiltinReview = getBuiltinReviewPromptType(result.reviewPromptPresetId) !== null
        const validCustomReview = result.codeReviewPromptTemplates.some(
          (t) => t.id === result.reviewPromptPresetId
        )
        if (!validBuiltinReview && !validCustomReview) {
          result.reviewPromptPresetId = DEFAULT_REVIEW_PROMPT_PRESET_ID
        }

        // Migrate legacy showUsageIndicator boolean
        if ('showUsageIndicator' in parsed && !('usageIndicatorMode' in parsed)) {
          if (parsed.showUsageIndicator === false) {
            result.usageIndicatorMode = 'specific-providers'
            result.usageIndicatorProviders = []
          } else {
            result.usageIndicatorMode = 'current-agent'
            result.usageIndicatorProviders = []
          }
          delete (result as Record<string, unknown>).showUsageIndicator
        }

        // Migrate boardMode default from 'toggle' to 'sticky-tab' (one-time)
        if (!parsed._boardModeMigratedToStickyTab) {
          if (result.boardMode === 'toggle') {
            result.boardMode = 'sticky-tab'
          }
          result._boardModeMigratedToStickyTab = true
        }

        if (result.uiLocale !== 'en' && result.uiLocale !== 'pt-BR') {
          result.uiLocale = DEFAULT_SETTINGS.uiLocale
        }

        if (typeof result.customCodexBinaryPath !== 'string') {
          result.customCodexBinaryPath = ''
        }

        if (
          typeof result.lastTaskSessionPromptTemplateId === 'string' &&
          result.lastTaskSessionPromptTemplateId.length > 0 &&
          !result.taskSessionPromptTemplates.some(
            (t) => t.id === result.lastTaskSessionPromptTemplateId
          )
        ) {
          result.lastTaskSessionPromptTemplateId = null
        }

        if (petWasLegacy) {
          await saveToDatabase(result)
        }

        return result
      }
    }
  } catch (error) {
    console.error('Failed to load settings from database:', error)
  }
  return null
}

function extractSettings(state: SettingsState): AppSettings {
  return {
    uiLocale: state.uiLocale,
    autoStartSession: state.autoStartSession,
    autoPullBeforeWorktree: state.autoPullBeforeWorktree,
    breedType: state.breedType,
    vimModeEnabled: state.vimModeEnabled,
    keepAwakeEnabled: state.keepAwakeEnabled,
    taskListCollapsed: state.taskListCollapsed,
    mergeConflictMode: state.mergeConflictMode,
    boardMode: state.boardMode,
    followUpTriggerColumn: state.followUpTriggerColumn,
    autoCodeReviewEnabled: state.autoCodeReviewEnabled,
    defaultEditor: state.defaultEditor,
    customEditorCommand: state.customEditorCommand,
    defaultTerminal: state.defaultTerminal,
    customTerminalCommand: state.customTerminalCommand,
    embeddedTerminalBackend: state.embeddedTerminalBackend,
    ghosttyFontSize: state.ghosttyFontSize,
    ghosttyPromotionDismissed: state.ghosttyPromotionDismissed,
    terminalPosition: state.terminalPosition,
    selectedModel: state.selectedModel,
    selectedModelByProvider: state.selectedModelByProvider,
    defaultModels: state.defaultModels,
    lastHandoffOverride: state.lastHandoffOverride,
    lastOpenAction: state.lastOpenAction,
    favoriteModels: state.favoriteModels,
    customChromeCommand: state.customChromeCommand,
    modelVariantDefaults: state.modelVariantDefaults,
    showModelIcons: state.showModelIcons,
    showModelProvider: state.showModelProvider,
    usageIndicatorMode: state.usageIndicatorMode,
    usageIndicatorProviders: state.usageIndicatorProviders,
    defaultAgentSdk: state.defaultAgentSdk,
    customCodexBinaryPath: state.customCodexBinaryPath,
    stripAtMentions: state.stripAtMentions,
    codexFastMode: state.codexFastMode,
    codexFastModeAccepted: state.codexFastModeAccepted,
    updateChannel: state.updateChannel,
    skippedUpdateVersion: state.skippedUpdateVersion,
    initialSetupComplete: state.initialSetupComplete,
    commandFilter: state.commandFilter,
    telemetryEnabled: state.telemetryEnabled,
    tipsEnabled: state.tipsEnabled,
    pet: state.pet,
    environmentVariables: state.environmentVariables,
    mcpServers: state.mcpServers,
    perfDiagnosticsEnabled: state.perfDiagnosticsEnabled,
    codexJsonlLoggingEnabled: state.codexJsonlLoggingEnabled,
    codexJsonlResetPerSession: state.codexJsonlResetPerSession,
    reviewPromptPresetId: state.reviewPromptPresetId,
    codeReviewPromptTemplates: state.codeReviewPromptTemplates,
    taskSessionPromptTemplates: state.taskSessionPromptTemplates,
    lastTaskSessionPromptTemplateId: state.lastTaskSessionPromptTemplateId,
    _boardModeMigratedToStickyTab: state._boardModeMigratedToStickyTab
  }
}

/**
 * Resolve the default model for a given agent SDK using the per-provider priority chain.
 * Priority: per-provider default → (legacy only) global selectedModel.
 * Returns null when per-provider defaults exist but none matches the requested SDK.
 *
 * Accepts an optional state snapshot so it can be used inside Zustand selectors
 * (where getState() must not be called). Falls back to store.getState() when omitted.
 */
export function resolveModelForSdk(
  agentSdk: string,
  state?: Pick<AppSettings, 'selectedModelByProvider' | 'selectedModel'>
): SelectedModel | null {
  const s = state ?? useSettingsStore.getState()
  const perProvider = s.selectedModelByProvider[agentSdk]
  if (perProvider) return perProvider
  // Legacy fallback only when per-provider feature not yet active (migration)
  if (Object.keys(s.selectedModelByProvider).length > 0) return null
  return s.selectedModel
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      // Default values
      ...DEFAULT_SETTINGS,
      isOpen: false,
      activeSection: 'appearance',
      isLoading: true,
      availableAgentSdks: null,

      openSettings: (section?: string) => {
        set({ isOpen: true, activeSection: section || get().activeSection })
      },

      closeSettings: () => {
        set({ isOpen: false })
      },

      setActiveSection: (section: string) => {
        set({ activeSection: section })
      },

      updateSetting: async <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
        set({ [key]: value } as Partial<SettingsState>)
        // Persist to database
        const settings = extractSettings({ ...get(), [key]: value } as SettingsState)
        await saveToDatabase(settings)
        if (key === 'pet' && window.petOps) {
          const pet = value as PetSettings
          window.petOps.updateSettings(pet)
          if (pet.enabled) {
            window.petOps.show().catch(() => {})
          } else {
            window.petOps.hide().catch(() => {})
          }
        }
        // Handle board mode switching side effects
        if (key === 'boardMode') {
          // setTimeout ensures the state update completes before side effects run.
          // Dynamic import() avoids circular dependency (useSessionStore imports useSettingsStore).
          setTimeout(() => {
            Promise.all([
              import('./useKanbanStore'),
              import('./useSessionStore')
            ]).then(([{ useKanbanStore }, { useSessionStore, BOARD_TAB_ID }]) => {
              if (value === 'sticky-tab') {
                // Toggle → Sticky Tab: deactivate toggle board view, activate board tab
                if (useKanbanStore.getState().isBoardViewActive) {
                  useKanbanStore.getState().toggleBoardView()
                }
                useSessionStore.getState().setActiveSession(BOARD_TAB_ID)
              } else {
                // Sticky Tab → Toggle: if on board tab, fall back to first real session
                const sessionStore = useSessionStore.getState()
                if (sessionStore.activeSessionId === BOARD_TAB_ID) {
                  const worktreeId = sessionStore.activeWorktreeId
                  if (worktreeId) {
                    const tabOrder =
                      sessionStore.tabOrderByWorktree.get(worktreeId) || []
                    const sessions =
                      sessionStore.sessionsByWorktree.get(worktreeId) || []
                    const fallbackId =
                      tabOrder.find((id) => id !== BOARD_TAB_ID) ||
                      (sessions.length > 0 ? sessions[0].id : null)
                    sessionStore.setActiveSession(fallbackId)
                  } else {
                    sessionStore.setActiveSession(null)
                  }
                }
              }
            }).catch(console.error)
          }, 0)
        }
      },

      setSelectedModel: async (
        model: SelectedModel | null,
        agentSdk?: AppSettings['defaultAgentSdk']
      ) => {
        if (agentSdk) {
          return get().setSelectedModelForSdk(agentSdk, model)
        }
        set({ selectedModel: model })
        // Persist to backend (settings DB + opencode service)
        try {
          await window.opencodeOps.setModel(model)
        } catch (error) {
          console.error('Failed to persist model selection:', error)
        }
        // Always save to app settings (including null to clear)
        const settings = extractSettings({ ...get(), selectedModel: model } as SettingsState)
        saveToDatabase(settings)
      },

      setSelectedModelForSdk: async (
        agentSdk: AppSettings['defaultAgentSdk'],
        model: SelectedModel | null,
        options?: { skipBackendPush?: boolean }
      ) => {
        // null clears the per-SDK entry
        const current = { ...get().selectedModelByProvider }
        if (model) {
          current[agentSdk] = model
        } else {
          delete current[agentSdk]
        }
        set({ selectedModelByProvider: current })
        // Push to backend (skip for terminal — no backend service, or when caller already pushed)
        if (agentSdk !== 'terminal' && !options?.skipBackendPush) {
          try {
            await window.opencodeOps.setModel(model ? { ...model, agentSdk } : null)
          } catch (error) {
            console.error('Failed to persist model selection for SDK:', error)
          }
        }
        // Persist to app settings DB
        const settings = extractSettings({
          ...get(),
          selectedModelByProvider: current
        } as SettingsState)
        saveToDatabase(settings)
      },

      setModeDefaultModel: async (mode: 'build' | 'plan' | 'ask', model: SelectedModel | null) => {
        const currentDefaults = get().defaultModels || { build: null, plan: null, ask: null }
        const updated = { ...currentDefaults, [mode]: model }
        set({ defaultModels: updated })

        // Save to database (preference only — don't mutate the live service model)
        const settings = extractSettings({ ...get(), defaultModels: updated } as SettingsState)
        await saveToDatabase(settings)
      },

      getModelForMode: (mode: 'build' | 'plan' | 'ask') => {
        // Return only the mode-specific default (no global fallback).
        // Callers that need a fallback chain should check selectedModel separately.
        return get().defaultModels?.[mode] ?? null
      },

      setLastHandoffOverride: (value) => {
        set({ lastHandoffOverride: value })
        const settings = extractSettings({ ...get(), lastHandoffOverride: value } as SettingsState)
        saveToDatabase(settings)
      },

      setModelVariantDefault: (providerID: string, modelID: string, variant: string) => {
        const key = `${providerID}::${modelID}`
        const updated = { ...get().modelVariantDefaults, [key]: variant }
        set({ modelVariantDefaults: updated })
        const settings = extractSettings({
          ...get(),
          modelVariantDefaults: updated
        } as SettingsState)
        saveToDatabase(settings)
      },

      getModelVariantDefault: (providerID: string, modelID: string) => {
        const key = `${providerID}::${modelID}`
        return get().modelVariantDefaults[key]
      },

      toggleFavoriteModel: (providerID: string, modelID: string) => {
        const key = `${providerID}::${modelID}`
        const current = get().favoriteModels
        const updated = current.includes(key) ? current.filter((k) => k !== key) : [...current, key]
        set({ favoriteModels: updated })
        const settings = extractSettings({ ...get(), favoriteModels: updated } as SettingsState)
        saveToDatabase(settings)
      },

      resetToDefaults: () => {
        set({ ...DEFAULT_SETTINGS })
        saveToDatabase(DEFAULT_SETTINGS)
        window.systemOps?.configureCodexBinaryPath('').then(() => {
          get().detectAvailableAgentSdks()
        }).catch(() => {})
        window.petOps?.updateSettings(DEFAULT_SETTINGS.pet)
        window.petOps?.hide().catch(() => {})
      },

      loadFromDatabase: async () => {
        const dbSettings = await loadSettingsFromDatabase()
        if (dbSettings) {
          set({
            ...dbSettings,
            // Existing users upgrading: if field missing, they've already set up
            initialSetupComplete: dbSettings.initialSetupComplete ?? true,
            isLoading: false
          })
          window.petOps?.updateSettings(dbSettings.pet)
          if (dbSettings.pet.enabled) {
            window.petOps?.show().catch(() => {})
          }
        } else {
          set({ isLoading: false })
          await saveToDatabase(extractSettings(get()))
          window.petOps?.updateSettings(get().pet)
        }
      },

      detectAvailableAgentSdks: async () => {
        try {
          const result = await window.systemOps.detectAgentSdks()
          set({ availableAgentSdks: result })
        } catch {
          // Fail gracefully — context menu just won't show
          set({ availableAgentSdks: null })
        }
      }
    }),
    {
      name: 'octob-settings',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        uiLocale: state.uiLocale,
        autoStartSession: state.autoStartSession,
        autoPullBeforeWorktree: state.autoPullBeforeWorktree,
        breedType: state.breedType,
        vimModeEnabled: state.vimModeEnabled,
        keepAwakeEnabled: state.keepAwakeEnabled,
        taskListCollapsed: state.taskListCollapsed,
        mergeConflictMode: state.mergeConflictMode,
        boardMode: state.boardMode,
        followUpTriggerColumn: state.followUpTriggerColumn,
        autoCodeReviewEnabled: state.autoCodeReviewEnabled,
        defaultEditor: state.defaultEditor,
        customEditorCommand: state.customEditorCommand,
        defaultTerminal: state.defaultTerminal,
        customTerminalCommand: state.customTerminalCommand,
        embeddedTerminalBackend: state.embeddedTerminalBackend,
        ghosttyFontSize: state.ghosttyFontSize,
        ghosttyPromotionDismissed: state.ghosttyPromotionDismissed,
        terminalPosition: state.terminalPosition,
        selectedModel: state.selectedModel,
        selectedModelByProvider: state.selectedModelByProvider,
        defaultModels: state.defaultModels,
        lastHandoffOverride: state.lastHandoffOverride,
        lastOpenAction: state.lastOpenAction,
        favoriteModels: state.favoriteModels,
        customChromeCommand: state.customChromeCommand,
        modelVariantDefaults: state.modelVariantDefaults,
        showModelIcons: state.showModelIcons,
        showModelProvider: state.showModelProvider,
        usageIndicatorMode: state.usageIndicatorMode,
        usageIndicatorProviders: state.usageIndicatorProviders,
        defaultAgentSdk: state.defaultAgentSdk,
        customCodexBinaryPath: state.customCodexBinaryPath,
        activeSection: state.activeSection,
        stripAtMentions: state.stripAtMentions,
        codexFastMode: state.codexFastMode,
        codexFastModeAccepted: state.codexFastModeAccepted,
        updateChannel: state.updateChannel,
        skippedUpdateVersion: state.skippedUpdateVersion,
        initialSetupComplete: state.initialSetupComplete,
        commandFilter: state.commandFilter,
        telemetryEnabled: state.telemetryEnabled,
        tipsEnabled: state.tipsEnabled,
        pet: state.pet,
        environmentVariables: state.environmentVariables,
        mcpServers: state.mcpServers,
        perfDiagnosticsEnabled: state.perfDiagnosticsEnabled,
        codexJsonlLoggingEnabled: state.codexJsonlLoggingEnabled,
        codexJsonlResetPerSession: state.codexJsonlResetPerSession,
        reviewPromptPresetId: state.reviewPromptPresetId,
        codeReviewPromptTemplates: state.codeReviewPromptTemplates,
        taskSessionPromptTemplates: state.taskSessionPromptTemplates,
        lastTaskSessionPromptTemplateId: state.lastTaskSessionPromptTemplateId,
        _boardModeMigratedToStickyTab: state._boardModeMigratedToStickyTab
      })
    }
  )
)

// Load from database on startup, then detect available agent SDKs
if (typeof window !== 'undefined') {
  setTimeout(() => {
    useSettingsStore
      .getState()
      .loadFromDatabase()
      .then(() => {
        useSettingsStore.getState().detectAvailableAgentSdks()
      })
  }, 200)

  // Listen for settings updates from main process (e.g., when "Allow always" adds to allowlist)
  window.settingsOps?.onSettingsUpdated((data) => {
    const typedData = data as { commandFilter?: CommandFilterSettings }
    if (typedData.commandFilter) {
      useSettingsStore.setState({ commandFilter: typedData.commandFilter })
    }
  })
}
