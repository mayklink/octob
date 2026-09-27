import { create } from 'zustand'

export type DevToolsSection = 'overview' | 'logs'

export type ElectronProcessMetric = {
  pid: number
  type: string
  name: string
  cpuPercent: number
  workingSetKb: number
  privateBytesKb: number
}

export type DevToolsPerfSnapshot = {
  timestamp: string
  processScope?: 'electron-main' | 'web-runtime'
  cpu: { percentSinceLastSample: number }
  memory: { rss: number }
  electron?: { processes?: ElectronProcessMetric[] }
}

interface DevToolsState {
  isOpen: boolean
  section: DevToolsSection
  snapshot: DevToolsPerfSnapshot | null
  snapshotError: string | null
  snapshotRefreshedAt: number
  panelTransparencyPreview: number | null
  open: (section?: DevToolsSection) => void
  close: () => void
  selectSection: (section: DevToolsSection) => void
  setPanelTransparencyPreview: (value: number | null) => void
  refreshSnapshot: (force?: boolean) => Promise<void>
}

let snapshotRequest: Promise<void> | null = null

export const useDevToolsStore = create<DevToolsState>((set, get) => ({
  isOpen: false,
  section: 'overview',
  snapshot: null,
  snapshotError: null,
  snapshotRefreshedAt: 0,
  panelTransparencyPreview: null,
  open: (section) => set((state) => ({ isOpen: true, section: section ?? state.section })),
  close: () => set({ isOpen: false }),
  selectSection: (section) => set({ section }),
  setPanelTransparencyPreview: (value) => set({ panelTransparencyPreview: value }),
  refreshSnapshot: async (force = false) => {
    const state = get()
    if (snapshotRequest) return snapshotRequest
    if (!force && state.snapshot && Date.now() - state.snapshotRefreshedAt < 25_000) return

    snapshotRequest = window.perfDiagnosticsOps.getSnapshot()
      .then((value) => {
        set({
          snapshot: value as DevToolsPerfSnapshot,
          snapshotError: null,
          snapshotRefreshedAt: Date.now()
        })
      })
      .catch((error: unknown) => {
        set({ snapshotError: error instanceof Error ? error.message : 'Não foi possível ler as métricas.' })
      })
      .finally(() => {
        snapshotRequest = null
      })

    return snapshotRequest
  }
}))
