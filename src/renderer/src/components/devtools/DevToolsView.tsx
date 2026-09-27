import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Activity, AlertCircle, ArrowDown, BarChart3, FileText, HardDrive, RefreshCw, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useSettingsStore } from '@/stores/useSettingsStore'
import type { DevToolsPanelPosition } from '@/stores/useSettingsStore'
import { useDevToolsStore } from './useDevToolsStore'

type LogFile = { name: string; size: number; modifiedAt: string }
type LogEntry = {
  timestamp: string
  level: string
  component: string
  message: string
  data?: string
  error?: string
  raw: string
}
type LogsPage = { entries: LogEntry[]; nextBefore: number | null; fileSize: number }
type DevToolsApi = {
  listLogs: () => Promise<{ files: LogFile[] }>
  readLogs: (args: { fileName: string; before?: number; limit?: number }) => Promise<LogsPage>
}
type WindowWithDevTools = Window & { devToolsOps?: DevToolsApi }

const REFRESH_INTERVAL_MS = 30_000
const PAGE_SIZE = 100
const DEV_TOOLS_PANEL_POSITIONS: Array<{ value: DevToolsPanelPosition; label: string }> = [
  { value: 'sidebar', label: 'Barra lateral' },
  { value: 'top-left', label: 'Superior esquerdo' },
  { value: 'top-right', label: 'Superior direito' },
  { value: 'bottom-left', label: 'Inferior esquerdo' },
  { value: 'bottom-right', label: 'Inferior direito' }
]

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}

function formatPercent(percent: number): string {
  return Number.isFinite(percent) && percent >= 0 ? `${percent.toFixed(1)}%` : 'Indisponível'
}

function formatDate(value?: string): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  muted = false,
  surfaceStyle
}: {
  label: string
  value: string
  detail: string
  icon: typeof Activity
  muted?: boolean
  surfaceStyle: React.CSSProperties
}): React.JSX.Element {
  return (
    <div className="rounded-lg border p-3" style={surfaceStyle}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        <span>{label}</span>
      </div>
      <div className={`mt-2 text-xl font-semibold tabular-nums ${muted ? 'text-muted-foreground' : ''}`}>
        {value}
      </div>
      <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{detail}</p>
    </div>
  )
}

export function DevToolsView(): React.JSX.Element {
  const section = useDevToolsStore((state) => state.section)
  const selectSection = useDevToolsStore((state) => state.selectSection)
  const snapshot = useDevToolsStore((state) => state.snapshot)
  const snapshotError = useDevToolsStore((state) => state.snapshotError)
  const refreshSnapshot = useDevToolsStore((state) => state.refreshSnapshot)
  const perfDiagnosticsEnabled = useSettingsStore((state) => state.perfDiagnosticsEnabled)
  const devToolsPanelVisible = useSettingsStore((state) => state.devToolsPanelVisible)
  const devToolsPanelPosition = useSettingsStore((state) => state.devToolsPanelPosition)
  const devToolsPanelTransparency = useSettingsStore((state) => state.devToolsPanelTransparency)
  const updateSetting = useSettingsStore((state) => state.updateSetting)
  const panelTransparencyPreview = useDevToolsStore((state) => state.panelTransparencyPreview)
  const setPanelTransparencyPreview = useDevToolsStore((state) => state.setPanelTransparencyPreview)
  const transparencyPreviewRef = useRef<number | null>(null)
  const [files, setFiles] = useState<LogFile[]>([])
  const [fileName, setFileName] = useState('')
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [nextBefore, setNextBefore] = useState<number | null>(null)
  const [fileSize, setFileSize] = useState(0)
  const [logsLoading, setLogsLoading] = useState(false)
  const [logsError, setLogsError] = useState<string | null>(null)
  const [hasLoadedLogs, setHasLoadedLogs] = useState(false)
  const [query, setQuery] = useState('')
  const [levelFilter, setLevelFilter] = useState('all')

  useEffect(() => {
    if (section !== 'overview' || !perfDiagnosticsEnabled) return
    void refreshSnapshot()
    const timer = window.setInterval(() => void refreshSnapshot(), REFRESH_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [section, perfDiagnosticsEnabled, refreshSnapshot])

  const loadFileList = useCallback(async () => {
    setLogsLoading(true)
    setLogsError(null)
    try {
      const api = (window as WindowWithDevTools).devToolsOps
      if (!api) throw new Error('A leitura de logs não está disponível nesta versão.')
      const result = await api.listLogs()
      setFiles(result.files)
      setFileName((current) => current && result.files.some((file) => file.name === current)
        ? current
        : result.files[0]?.name ?? '')
    } catch (error) {
      setLogsError(error instanceof Error ? error.message : 'Não foi possível listar os logs.')
    } finally {
      setLogsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (section !== 'logs') return
    void loadFileList()
  }, [section, loadFileList])

  const loadLogPage = useCallback(async (before?: number, append = false) => {
    if (!fileName) {
      setEntries([])
      setNextBefore(null)
      setHasLoadedLogs(true)
      return
    }
    setLogsLoading(true)
    setLogsError(null)
    try {
      const api = (window as WindowWithDevTools).devToolsOps
      if (!api) throw new Error('A leitura de logs não está disponível nesta versão.')
      const page = await api.readLogs({ fileName, ...(before === undefined ? {} : { before }), limit: PAGE_SIZE })
      setEntries((current) => append ? [...page.entries, ...current] : page.entries)
      setNextBefore(page.nextBefore)
      setFileSize(page.fileSize)
      setHasLoadedLogs(true)
    } catch (error) {
      setLogsError(error instanceof Error ? error.message : 'Não foi possível ler este arquivo.')
      setHasLoadedLogs(true)
    } finally {
      setLogsLoading(false)
    }
  }, [fileName])

  useEffect(() => {
    if (section !== 'logs') return
    setEntries([])
    setNextBefore(null)
    setHasLoadedLogs(false)
    setQuery('')
    void loadLogPage()
  }, [section, fileName, loadLogPage])

  const visibleEntries = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return entries.filter((entry) => {
      if (levelFilter !== 'all' && entry.level.toLowerCase() !== levelFilter) return false
      if (!needle) return true
      return `${entry.timestamp} ${entry.level} ${entry.component} ${entry.message} ${entry.data ?? ''} ${entry.error ?? ''}`
        .toLocaleLowerCase().includes(needle)
    })
  }, [entries, levelFilter, query])
  const logScrollRef = useRef<HTMLDivElement>(null)
  const logVirtualizer = useVirtualizer({
    count: visibleEntries.length > 50 ? visibleEntries.length : 0,
    getScrollElement: () => logScrollRef.current,
    estimateSize: () => 68,
    overscan: 8
  })

  const processScope = snapshot?.processScope ?? (snapshot?.electron?.processes?.length ? 'electron-main' : undefined)
  const isWebRuntime = processScope === 'web-runtime'
  const processScopeLabel = isWebRuntime ? 'runtime web' : 'processo Electron principal'
  const hasProcessMetrics = processScope !== undefined
  const gpuProcess = isWebRuntime
    ? undefined
    : snapshot?.electron?.processes?.find((process) => process.type.toLowerCase() === 'gpu')

  const setDiagnosticsEnabled = async (enabled: boolean): Promise<void> => {
    await updateSetting('perfDiagnosticsEnabled', enabled)
    await window.perfDiagnosticsOps.enable(enabled)
  }

  const previewPanelTransparency = (value: number): void => {
    const normalized = Math.round(Math.min(100, Math.max(0, value)))
    transparencyPreviewRef.current = normalized
    setPanelTransparencyPreview(normalized)
  }

  const commitPanelTransparency = useCallback((value?: number): void => {
    const preview = value === undefined ? transparencyPreviewRef.current : Math.round(Math.min(100, Math.max(0, value)))
    if (preview === null) return
    transparencyPreviewRef.current = null
    setPanelTransparencyPreview(null)
    void updateSetting('devToolsPanelTransparency', preview)
  }, [setPanelTransparencyPreview, updateSetting])

  useEffect(() => () => commitPanelTransparency(), [commitPanelTransparency])

  const displayedPanelTransparency = panelTransparencyPreview ?? devToolsPanelTransparency
  const metricCardStyle: React.CSSProperties = {
    backgroundColor: `color-mix(in srgb, var(--card) ${100 - displayedPanelTransparency}%, transparent)`,
    borderColor: `color-mix(in srgb, var(--border) ${100 - displayedPanelTransparency}%, transparent)`
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" aria-label="Dev Tools">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-6 py-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">Octob · Developer tools</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">Dev Tools</h1>
          <p className="mt-1 text-sm text-muted-foreground">Diagnóstico local do processo e arquivos de log.</p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/30 p-1" role="group" aria-label="Seções Dev Tools">
          <button type="button" aria-pressed={section === 'overview'} onClick={() => selectSection('overview')}
            className={`inline-flex h-8 items-center gap-2 rounded-md px-3 text-xs font-medium transition-colors ${section === 'overview' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
            <BarChart3 className="h-3.5 w-3.5" /> Visão geral
          </button>
          <button type="button" aria-pressed={section === 'logs'} onClick={() => selectSection('logs')}
            className={`inline-flex h-8 items-center gap-2 rounded-md px-3 text-xs font-medium transition-colors ${section === 'logs' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
            <FileText className="h-3.5 w-3.5" /> Logs
          </button>
        </div>
      </header>

      {section === 'overview' ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-auto p-6">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Uso do processo</h2>
                <p className="mt-1 text-xs text-muted-foreground">Amostra atualizada a cada 30 segundos enquanto esta aba está aberta.</p>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className={`h-2 w-2 rounded-full ${perfDiagnosticsEnabled ? 'bg-emerald-500' : 'bg-muted-foreground/50'}`} />
                {perfDiagnosticsEnabled ? 'Coleta ativada' : 'Coleta pausada'}
                {perfDiagnosticsEnabled && <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => void refreshSnapshot(true)} aria-label="Atualizar métricas"><RefreshCw className="h-3.5 w-3.5" /></Button>}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3" style={metricCardStyle}>
              <div className="min-w-0">
                <p className="text-sm font-medium">Coleta de métricas</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Controla a gravação de amostras; a visibilidade do painel é independente.</p>
              </div>
              <label className="flex shrink-0 items-center gap-2 text-xs font-medium">
                <span>{perfDiagnosticsEnabled ? 'Ativada' : 'Desativada'}</span>
                <input
                  type="checkbox"
                  role="switch"
                  aria-label="Ativar coleta de métricas"
                  checked={perfDiagnosticsEnabled}
                  onChange={(event) => void setDiagnosticsEnabled(event.currentTarget.checked)}
                  className="h-4 w-4 cursor-pointer accent-primary"
                />
              </label>
            </div>

            {!perfDiagnosticsEnabled ? (
              <div className="rounded-xl border border-dashed p-8 text-center" style={metricCardStyle}>
                <Activity className="mx-auto h-7 w-7 text-muted-foreground" aria-hidden="true" />
                <h3 className="mt-3 text-sm font-semibold">Coleta de métricas desativada</h3>
                <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted-foreground">Ative a coleta acima para registrar CPU e memória no intervalo de 30 segundos.</p>
              </div>
            ) : snapshotError ? (
              <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm" role="alert">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <div className="min-w-0 flex-1"><p className="font-medium">Não foi possível carregar as métricas.</p><p className="mt-1 break-words text-xs text-muted-foreground">{snapshotError}</p></div>
                <Button size="sm" variant="outline" onClick={() => void refreshSnapshot(true)}>Tentar novamente</Button>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-live="polite">
                <MetricCard label={`CPU · ${isWebRuntime ? 'web' : 'Electron'}`} value={snapshot ? hasProcessMetrics ? `${snapshot.cpu.percentSinceLastSample.toFixed(1)}%` : 'Indisponível' : 'Carregando…'} detail={isWebRuntime ? 'CPU do runtime web.' : 'CPU do processo Electron principal · cada core equivale a 100%.'} icon={Activity} muted={Boolean(snapshot && !hasProcessMetrics)} surfaceStyle={metricCardStyle} />
                <MetricCard label={`Memória residente · ${isWebRuntime ? 'web' : 'Electron'}`} value={snapshot ? hasProcessMetrics ? formatBytes(snapshot.memory.rss) : 'Indisponível' : 'Carregando…'} detail={`RSS do ${processScopeLabel}.`} icon={HardDrive} muted={Boolean(snapshot && !hasProcessMetrics)} surfaceStyle={metricCardStyle} />
                <MetricCard
                  label="Processo gráfico · CPU / RAM"
                  value={gpuProcess ? `${formatPercent(gpuProcess.cpuPercent)} CPU · ${formatBytes(gpuProcess.workingSetKb * 1024)}` : 'Indisponível'}
                  detail={gpuProcess ? 'CPU e working set do processo gráfico · memória do processo, não VRAM.' : isWebRuntime ? 'Indisponível no runtime web.' : 'Sem processo gráfico disponível nesta execução.'}
                  icon={BarChart3}
                  muted={!gpuProcess}
                  surfaceStyle={metricCardStyle}
                />
                <MetricCard
                  label="Uso da GPU / VRAM"
                  value="Indisponível"
                  detail="A coleta atual não consulta um contador confiável de utilização da placa nem de memória de vídeo."
                  icon={BarChart3}
                  muted
                  surfaceStyle={metricCardStyle}
                />
              </div>
            )}

            <section className="rounded-lg border p-4" style={metricCardStyle} aria-labelledby="devtools-panel-preferences-title">
              <div className="mb-4">
                <h3 id="devtools-panel-preferences-title" className="text-sm font-semibold">Painel compacto</h3>
                <p className="mt-1 text-xs text-muted-foreground">A visibilidade e a aparência se aplicam imediatamente. Os cantos usam a área de conteúdo, fora da navegação.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex min-h-10 items-center justify-between gap-4 rounded-md border border-border/70 px-3 py-2 text-sm">
                  <span className="min-w-0"><span className="block font-medium">Mostrar painel</span><span className="mt-0.5 block text-[11px] text-muted-foreground">Visibilidade independente da coleta.</span></span>
                  <input
                    type="checkbox"
                    role="switch"
                    aria-label="Mostrar painel compacto Dev Tools"
                    checked={devToolsPanelVisible}
                    onChange={(event) => void updateSetting('devToolsPanelVisible', event.currentTarget.checked)}
                    className="h-4 w-4 shrink-0 cursor-pointer accent-primary"
                  />
                </label>
                <label className="flex min-w-0 flex-col gap-1.5 text-sm">
                  <span className="font-medium">Posição</span>
                  <select
                    aria-label="Posição do painel compacto"
                    value={devToolsPanelPosition}
                    onChange={(event) => void updateSetting('devToolsPanelPosition', event.currentTarget.value as DevToolsPanelPosition)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/24"
                  >
                    {DEV_TOOLS_PANEL_POSITIONS.map((position) => <option key={position.value} value={position.value}>{position.label}</option>)}
                  </select>
                </label>
                <label className="flex min-w-0 flex-col gap-2 text-sm sm:col-span-2">
                  <span className="flex items-center justify-between gap-3">
                    <span className="font-medium">Transparência do fundo</span>
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">{displayedPanelTransparency}%</span>
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={displayedPanelTransparency}
                    aria-label="Transparência do fundo do painel compacto"
                    aria-valuetext={`${displayedPanelTransparency}% de transparência do fundo`}
                    onChange={(event) => previewPanelTransparency(Number(event.currentTarget.value))}
                    onPointerUp={(event) => commitPanelTransparency(Number(event.currentTarget.value))}
                    onKeyUp={(event) => commitPanelTransparency(Number(event.currentTarget.value))}
                    onBlur={() => commitPanelTransparency()}
                    className="h-4 w-full cursor-pointer accent-primary"
                  />
                  <span className="text-[11px] text-muted-foreground">0% deixa o fundo sólido; 100% deixa o fundo transparente. Texto e ícones permanecem opacos.</span>
                </label>
              </div>
            </section>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
              <div className="rounded-lg border p-4" style={metricCardStyle}>
                <h3 className="text-sm font-semibold">Escopo das métricas</h3>
                <ul className="mt-3 space-y-2 text-xs leading-5 text-muted-foreground">
                  <li>CPU e RSS descrevem {isWebRuntime ? 'o runtime web' : 'o processo Electron principal'}.</li>
                  {!isWebRuntime && <li>O percentual de CPU pode ultrapassar 100% quando mais de um core é usado.</li>}
                  <li>Workers externos e executáveis child não são incluídos nessas métricas.</li>
                  <li>CPU e working set do processo gráfico só aparecem quando Electron fornece esse processo; working set é memória do processo, não VRAM.</li>
                  <li>Utilização da GPU e memória de vídeo (VRAM) não são medidas por esta coleta.</li>
                  {!snapshot?.processScope && !hasProcessMetrics && <li>Sem processo reportado, CPU/RSS e métricas GPU ficam indisponíveis.</li>}
                </ul>
              </div>
              <div className="rounded-lg border p-4" style={metricCardStyle}>
                <h3 className="text-xs font-semibold text-muted-foreground">ÚLTIMA AMOSTRA</h3>
                <p className="mt-2 text-sm tabular-nums">{snapshot ? formatDate(snapshot.timestamp) : 'Aguardando dados'}</p>
                <p className="mt-2 text-[11px] leading-4 text-muted-foreground">As métricas aparecem quando a coleta está ativada.</p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
            <label className="sr-only" htmlFor="devtools-log-file">Arquivo de log</label>
            <select id="devtools-log-file" value={fileName} onChange={(event) => setFileName(event.target.value)} disabled={files.length === 0 || logsLoading}
              className="h-9 min-w-0 max-w-[280px] rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/24">
              {files.length === 0 ? <option value="">Nenhum arquivo de log</option> : files.map((file) => <option key={file.name} value={file.name}>{file.name}</option>)}
            </select>
            <div className="relative min-w-[180px] flex-1">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar nos itens carregados…" aria-label="Buscar nos logs" className="h-9 pl-9 pr-8 text-sm" />
              {query && <button type="button" onClick={() => setQuery('')} aria-label="Limpar busca" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>}
            </div>
            <label className="sr-only" htmlFor="devtools-log-level">Filtrar por nível</label>
            <select id="devtools-log-level" value={levelFilter} onChange={(event) => setLevelFilter(event.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/24">
              <option value="all">Todos os níveis</option><option value="error">Erro</option><option value="warn">Aviso</option><option value="info">Info</option><option value="debug">Debug</option>
            </select>
            <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => { void loadFileList(); void loadLogPage() }} aria-label="Atualizar arquivos e logs" disabled={logsLoading}><RefreshCw className={`h-3.5 w-3.5 ${logsLoading ? 'animate-spin' : ''}`} /></Button>
          </div>
          <div className="flex items-center justify-between border-b border-border px-5 py-2 text-[11px] text-muted-foreground">
            <span>{fileName ? `${visibleEntries.length} de ${entries.length} itens visíveis` : 'Selecione um arquivo'}</span>
            <span>{fileName ? `${formatBytes(fileSize)} · ${files.find((file) => file.name === fileName)?.modifiedAt ? formatDate(files.find((file) => file.name === fileName)?.modifiedAt) : ''}` : ''}</span>
          </div>
          <div ref={logScrollRef} className="min-h-0 flex-1 overflow-auto">
            {logsError ? (
              <div className="m-5 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm" role="alert"><AlertCircle className="mt-0.5 h-4 w-4 text-destructive" /><div className="flex-1"><p className="font-medium">Não foi possível abrir os logs.</p><p className="mt-1 break-words text-xs text-muted-foreground">{logsError}</p></div><Button variant="outline" size="sm" onClick={() => void loadFileList()}>Tentar novamente</Button></div>
            ) : logsLoading && !hasLoadedLogs ? (
              <div className="flex h-full min-h-48 items-center justify-center text-sm text-muted-foreground" role="status">Carregando logs…</div>
            ) : visibleEntries.length === 0 ? (
              <div className="flex h-full min-h-48 flex-col items-center justify-center px-6 text-center"><FileText className="h-7 w-7 text-muted-foreground/60" aria-hidden="true" /><p className="mt-3 text-sm font-medium">{hasLoadedLogs ? 'Nenhum item corresponde aos filtros.' : 'Nenhum arquivo de log disponível.'}</p><p className="mt-1 text-xs text-muted-foreground">{entries.length > 0 ? 'A busca considera os itens carregados. Carregue mais páginas para ampliar a busca.' : 'Os arquivos locais aparecerão aqui quando estiverem disponíveis.'}</p></div>
            ) : (
              <div className="divide-y divide-border/70">
                {visibleEntries.length > 50 ? (
                  <div style={{ height: `${logVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
                    {logVirtualizer.getVirtualItems().map((virtualRow) => {
                      const entry = visibleEntries[virtualRow.index]
                      return (
                        <article
                          key={`${entry.timestamp}-${virtualRow.index}`}
                          ref={logVirtualizer.measureElement}
                          data-index={virtualRow.index}
                          style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${virtualRow.start}px)` }}
                          className="grid grid-cols-[minmax(120px,170px)_58px_minmax(90px,140px)_minmax(0,1fr)] gap-3 px-5 py-3 text-xs hover:bg-muted/20"
                        >
                          <time className="truncate font-mono text-[10px] text-muted-foreground" dateTime={entry.timestamp} title={entry.timestamp}>{formatDate(entry.timestamp)}</time>
                          <span className={`w-fit self-start rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${entry.level.toLowerCase() === 'error' ? 'bg-destructive/10 text-destructive' : entry.level.toLowerCase() === 'warn' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'bg-muted text-muted-foreground'}`}>{entry.level}</span>
                          <span className="truncate text-muted-foreground" title={entry.component}>{entry.component}</span>
                          <details className="min-w-0"><summary className="cursor-pointer truncate text-foreground/90" title={entry.message}>{entry.message || entry.error || entry.raw}</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-3 font-mono text-[10px] leading-4 text-muted-foreground">{entry.error ? `${entry.message}\n${entry.error}` : entry.data ? `${entry.message}\n${entry.data}` : entry.raw}</pre></details>
                        </article>
                      )
                    })}
                  </div>
                ) : (
                  visibleEntries.map((entry, index) => (
                    <article key={`${entry.timestamp}-${index}`} className="grid grid-cols-[minmax(120px,170px)_58px_minmax(90px,140px)_minmax(0,1fr)] gap-3 px-5 py-3 text-xs hover:bg-muted/20">
                      <time className="truncate font-mono text-[10px] text-muted-foreground" dateTime={entry.timestamp} title={entry.timestamp}>{formatDate(entry.timestamp)}</time>
                      <span className={`w-fit self-start rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${entry.level.toLowerCase() === 'error' ? 'bg-destructive/10 text-destructive' : entry.level.toLowerCase() === 'warn' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'bg-muted text-muted-foreground'}`}>{entry.level}</span>
                      <span className="truncate text-muted-foreground" title={entry.component}>{entry.component}</span>
                      <details className="min-w-0"><summary className="cursor-pointer truncate text-foreground/90" title={entry.message}>{entry.message || entry.error || entry.raw}</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-3 font-mono text-[10px] leading-4 text-muted-foreground">{entry.error ? `${entry.message}\n${entry.error}` : entry.data ? `${entry.message}\n${entry.data}` : entry.raw}</pre></details>
                    </article>
                  ))
                )}
              </div>
            )}
          </div>
          {nextBefore !== null && (
            <div className="flex justify-center border-t border-border p-3">
              <Button variant="outline" size="sm" onClick={() => void loadLogPage(nextBefore, true)} disabled={logsLoading}><ArrowDown className="h-3.5 w-3.5" />{logsLoading ? 'Carregando…' : 'Carregar logs mais antigos'}</Button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
