import { useEffect } from 'react'
import { Activity, ArrowUpRight, HardDrive } from 'lucide-react'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useDevToolsStore } from './useDevToolsStore'

const REFRESH_INTERVAL_MS = 30_000

function formatMiB(bytes: number): string {
  return Number.isFinite(bytes) && bytes >= 0 ? `${(bytes / 1024 / 1024).toFixed(1)} MiB` : 'Indisponível'
}

function formatPercent(percent: number): string {
  return Number.isFinite(percent) && percent >= 0 ? `${percent.toFixed(1)}%` : 'Indisponível'
}

interface DevToolsMiniPanelProps {
  floating?: boolean
  transparency?: number
}

export function DevToolsMiniPanel({ floating = false, transparency = 8 }: DevToolsMiniPanelProps): React.JSX.Element {
  const diagnosticsEnabled = useSettingsStore((state) => state.perfDiagnosticsEnabled)
  const panelTransparencyPreview = useDevToolsStore((state) => state.panelTransparencyPreview)
  const snapshot = useDevToolsStore((state) => state.snapshot)
  const snapshotError = useDevToolsStore((state) => state.snapshotError)
  const refreshSnapshot = useDevToolsStore((state) => state.refreshSnapshot)

  useEffect(() => {
    if (!diagnosticsEnabled) return
    void refreshSnapshot()
    const timer = window.setInterval(() => void refreshSnapshot(), REFRESH_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [diagnosticsEnabled, refreshSnapshot])

  const processScope = snapshot?.processScope ?? (snapshot?.electron?.processes?.length ? 'electron-main' : undefined)
  const isWebRuntime = processScope === 'web-runtime'
  const hasProcessMetrics = processScope !== undefined
  const gpuProcess = isWebRuntime
    ? undefined
    : snapshot?.electron?.processes?.find((process) => process.type.toLowerCase() === 'gpu')
  const unavailable = !diagnosticsEnabled || Boolean(snapshotError)
  const displayedTransparency = panelTransparencyPreview ?? transparency
  const backgroundMix = `calc(100% - ${displayedTransparency}%)`
  const surfaceColor = floating ? '--background' : '--sidebar-accent'
  const metricSurfaceColor = floating ? '--card' : '--sidebar-accent'
  const borderColor = floating ? '--border' : '--sidebar-border'
  const translucentBorder = `color-mix(in srgb, var(${borderColor}) ${backgroundMix}, transparent)`
  const metricCellStyle: React.CSSProperties = {
    backgroundColor: `color-mix(in srgb, var(${metricSurfaceColor}) ${backgroundMix}, transparent)`,
    borderColor: translucentBorder
  }
  const className = floating
    ? 'w-64 max-w-[calc(100%-2rem)] overflow-hidden rounded-lg border shadow-xl'
    : 'mx-2 mb-2 overflow-hidden rounded-lg border'
  const foregroundClass = floating ? 'text-foreground' : 'text-sidebar-foreground'
  const headerHoverClass = floating ? 'hover:bg-accent/70' : 'hover:bg-sidebar-accent/60'

  return (
    <section
      className={className}
      style={{
        backgroundColor: `color-mix(in srgb, var(${surfaceColor}) ${backgroundMix}, transparent)`,
        borderColor: translucentBorder
      }}
      aria-label="Resumo de métricas"
    >
      <button
        type="button"
        onClick={() => useDevToolsStore.getState().open('overview')}
        className={`flex h-8 w-full items-center justify-between gap-2 px-2.5 text-left text-[11px] font-semibold ${foregroundClass} transition-colors ${headerHoverClass}`}
        aria-label="Abrir Dev Tools"
      >
        <span className="flex min-w-0 items-center gap-2"><Activity className="h-3.5 w-3.5 shrink-0 text-sky-400" /><span className="truncate">Métricas</span></span>
        <span className="flex shrink-0 items-center gap-1 text-[10px] font-normal text-muted-foreground">
          {isWebRuntime ? 'runtime web' : diagnosticsEnabled ? '30 s' : 'pausadas'}<ArrowUpRight className="h-3 w-3" aria-hidden="true" />
        </span>
      </button>
      <div className="grid grid-cols-2 gap-1.5 border-t px-2.5 py-2 text-[10px]" style={{ borderColor: translucentBorder }}>
        <div className="min-w-0 rounded border p-1.5" style={metricCellStyle}>
          <p className="truncate text-muted-foreground">CPU {isWebRuntime ? 'runtime web' : 'principal'}</p>
          <p className={`truncate font-mono font-medium tabular-nums ${foregroundClass}`}>
            {unavailable || (snapshot && !hasProcessMetrics) ? 'Indisponível' : snapshot ? `${snapshot.cpu.percentSinceLastSample.toFixed(1)}%` : 'Carregando…'}
          </p>
        </div>
        <div className="min-w-0 rounded border p-1.5" style={metricCellStyle}>
          <p className="truncate text-muted-foreground">RSS {isWebRuntime ? 'runtime web' : 'principal'}</p>
          <p className={`truncate font-mono font-medium tabular-nums ${foregroundClass}`}>
            {unavailable || (snapshot && !hasProcessMetrics) ? 'Indisponível' : snapshot ? formatMiB(snapshot.memory.rss) : 'Carregando…'}
          </p>
        </div>
        <div className="col-span-2 flex min-w-0 items-start gap-1.5 rounded border p-1.5" style={metricCellStyle}>
          <HardDrive className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0 flex-1 space-y-0.5 text-muted-foreground">
            <p className="truncate" title={gpuProcess ? `Processo gráfico: CPU ${formatPercent(gpuProcess.cpuPercent)}; working set ${formatMiB(gpuProcess.workingSetKb * 1024)}. Working set é memória do processo, não VRAM.` : 'Métricas do processo gráfico indisponíveis.'}>
              Processo gráfico · CPU/RAM&nbsp;
              {unavailable || (snapshot && !hasProcessMetrics) || isWebRuntime ? 'indisponíveis' : gpuProcess
                ? `${formatPercent(gpuProcess.cpuPercent)} · ${formatMiB(gpuProcess.workingSetKb * 1024)}`
                : 'indisponíveis'}
            </p>
            <p className="truncate" title="Utilização da GPU e memória de vídeo (VRAM) não são medidas por esta coleta.">
              Uso da GPU/VRAM · indisponível (não medido)
            </p>
          </div>
        </div>
        {snapshotError && diagnosticsEnabled && <p className="col-span-2 truncate text-[9px] text-destructive" title={snapshotError}>Falha ao ler métricas</p>}
      </div>
    </section>
  )
}
