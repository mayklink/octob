import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FlaskConical, Loader2, RefreshCw, Trash2, X } from 'lucide-react'
import type { CapabilityDetail, CapabilityDraft } from '../../../../shared/types/capability-studio'
import { useCapabilityStudioStore } from '@/stores/useCapabilityStudioStore'
import { buildCapabilityPreviewDocument } from './capability-preview-document'

function CapabilityPreview({ detail, version }: { detail: CapabilityDetail; version: number }): React.JSX.Element {
  const iframe = useRef<HTMLIFrameElement>(null)
  const [nonce] = useState(() => Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join(''))
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const activeExecutions = useRef(new Set<string>())
  const artifact = detail.artifact

  useEffect(() => {
    if (ready || error) return
    const timer = window.setTimeout(() => setError('A prévia não iniciou. Reabra o experimento para tentar novamente.'), 5000)
    return () => window.clearTimeout(timer)
  }, [ready, error])

  useEffect(() => {
    const handleMessage = (event: MessageEvent): void => {
      if (event.source !== iframe.current?.contentWindow) return
      const message = event.data as { channel?: string; token?: string; type?: string; id?: string; input?: unknown; error?: string }
      if (!message || message.channel !== 'octob-capability' || message.token !== nonce) return
      if (message.type === 'ready') { setReady(true); return }
      if (message.type === 'error') { setError(message.error || 'Erro no script da capability'); return }
      if (message.type !== 'call' || typeof message.id !== 'string') return
      try {
        if ((JSON.stringify(message.input) ?? '').length > 100_000) throw new Error('Entrada da capability excede 100 KB')
      } catch (cause) {
        iframe.current?.contentWindow?.postMessage({ channel: 'octob-capability', token: nonce, type: 'result', id: message.id, ok: false, error: String(cause) }, '*')
        return
      }
      const executionId = crypto.randomUUID()
      activeExecutions.current.add(executionId)
      void window.capabilityOps.execute(detail.draft.id, message.input, version, executionId)
        .then((result) => {
          if (!activeExecutions.current.delete(executionId)) return
          iframe.current?.contentWindow?.postMessage({ channel: 'octob-capability', token: nonce, type: 'result', id: message.id, ok: true, result }, '*')
        })
        .catch((cause) => {
          if (!activeExecutions.current.delete(executionId)) return
          const reason = cause instanceof Error ? cause.message : String(cause)
          setError(reason)
          iframe.current?.contentWindow?.postMessage({ channel: 'octob-capability', token: nonce, type: 'result', id: message.id, ok: false, error: reason }, '*')
        })
    }
    window.addEventListener('message', handleMessage)
    return () => {
      window.removeEventListener('message', handleMessage)
      for (const executionId of activeExecutions.current) void window.capabilityOps.cancelExecution(executionId)
      activeExecutions.current.clear()
    }
  }, [detail.draft.id, nonce, version])

  const document = useMemo(() => artifact ? buildCapabilityPreviewDocument(artifact, nonce) : '', [artifact, nonce])

  if (!document) return <div className="p-6 text-sm text-muted-foreground">Preparando prévia…</div>
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <iframe key={`${detail.draft.id}:${version}`} ref={iframe} srcDoc={document} sandbox="allow-scripts" title={`Prévia de ${detail.draft.name}`} className="min-h-0 flex-1 w-full border-0 bg-[#151519]" />
      {!ready && !error && <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">Iniciando prévia…</div>}
      {error && <div role="alert" className="border-t border-red-500/30 px-4 py-2 text-xs text-red-400">{error}</div>}
    </div>
  )
}

export function CapabilityStudioView({ compact = false }: { compact?: boolean }): React.JSX.Element {
  const selectedId = useCapabilityStudioStore((state) => state.selectedId)
  const select = useCapabilityStudioStore((state) => state.select)
  const close = useCapabilityStudioStore((state) => state.close)
  const [drafts, setDrafts] = useState<CapabilityDraft[]>([])
  const [detail, setDetail] = useState<CapabilityDetail | null>(null)
  const [version, setVersion] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (preserveSelection = false): Promise<void> => {
    try {
      const items = await window.capabilityOps.list()
      setDrafts(items)
      const id = selectedId && items.some((item) => item.id === selectedId) ? selectedId : items[0]?.id
      if (id && id !== selectedId) select(id)
      if (id) {
        const latest = await window.capabilityOps.get(id)
        const targetVersion = preserveSelection && detail?.draft.id === id && version !== null && version !== detail.draft.latestVersion
          ? version
          : latest.draft.latestVersion
        const next = targetVersion && targetVersion !== latest.draft.latestVersion
          ? await window.capabilityOps.get(id, targetVersion)
          : latest
        setDetail((previous) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next)
        setVersion(targetVersion)
      } else {
        setDetail(null)
        setVersion(null)
      }
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [selectedId, select, detail, version])

  useEffect(() => { void refresh(true) }, [selectedId])
  useEffect(() => {
    const timer = window.setInterval(() => void refresh(true), 3000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const selectedVersion = detail?.versions.find((item) => item.version === version)
  const runAction = async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    setError(null)
    try { await action(); await refresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div><h1 className="flex items-center gap-2 text-lg font-semibold"><FlaskConical className="h-5 w-5 text-violet-400" /> Experimentos</h1><p className="text-xs text-muted-foreground">Teste uma capability antes de mantê-la no Octob.</p></div>
        <div className="flex items-center gap-1">
          {compact && <select aria-label="Experimento" value={selectedId ?? ''} onChange={(event) => select(event.target.value)} className="max-w-44 rounded border border-border bg-background px-2 py-1 text-sm">{drafts.length === 0 && <option value="">Nenhum experimento</option>}{drafts.map((draft) => <option key={draft.id} value={draft.id}>{draft.name}</option>)}</select>}
          <button type="button" onClick={() => void refresh(true)} aria-label="Atualizar experimentos" className="rounded p-2 hover:bg-muted"><RefreshCw className="h-4 w-4" /></button>
          <button type="button" onClick={close} aria-label="Fechar experimentos" className="rounded p-2 hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        {!compact && <aside className="w-60 shrink-0 overflow-y-auto border-r border-border p-2">
          {drafts.map((draft) => <button key={draft.id} type="button" onClick={() => { select(draft.id); setVersion(null) }} className={`mb-1 w-full rounded px-3 py-2 text-left text-sm hover:bg-muted ${selectedId === draft.id ? 'bg-muted' : ''}`}><span className="block truncate font-medium">{draft.name}</span><span className="text-xs text-muted-foreground">{draft.status === 'installed' ? 'Mantida' : draft.status === 'ready' ? 'Pronta para testar' : draft.status === 'failed' ? 'Validação falhou' : 'Rascunho'}</span></button>)}
          {drafts.length === 0 && <div className="p-3 text-xs text-muted-foreground">Peça ao Assistente para criar uma tela experimental.</div>}
        </aside>}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          {!detail ? <div className="m-auto max-w-md text-center text-sm text-muted-foreground">Descreva ao Assistente a tela que você quer experimentar. Ela aparecerá aqui depois da geração e dos testes.</div> : <>
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
              <div className="mr-auto min-w-52"><h2 className="font-medium">{selectedVersion?.spec.description ?? detail.draft.spec.description}</h2><p className="text-xs text-muted-foreground">{detail.draft.request}</p></div>
              <select aria-label="Versão" value={version ?? ''} onChange={(event) => { const next = Number(event.target.value); setVersion(next); void window.capabilityOps.get(detail.draft.id, next).then(setDetail) }} className="rounded border border-border bg-background px-2 py-1 text-sm">{detail.versions.map((item) => <option key={item.version} value={item.version}>v{item.version} · {item.status}</option>)}</select>
              <button type="button" disabled={busy || !version} onClick={() => void runAction(() => window.capabilityOps.validate(detail.draft.id, version!))} className="rounded border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Validar código'}</button>
              {selectedVersion?.status === 'ready' && detail.draft.installedVersion !== version && <button type="button" disabled={busy} onClick={() => void runAction(() => window.capabilityOps.install(detail.draft.id, version!))} className="rounded bg-violet-600 px-3 py-1.5 text-sm text-white disabled:opacity-50">Manter no Octob</button>}
              {detail.draft.status === 'installed' && <button type="button" disabled={busy} onClick={() => void runAction(() => window.capabilityOps.deactivate(detail.draft.id))} className="rounded border border-border px-3 py-1.5 text-sm">Desativar</button>}
              {detail.draft.status !== 'installed' && <button type="button" disabled={busy} onClick={() => void runAction(() => window.capabilityOps.discard(detail.draft.id))} aria-label="Descartar experimento" title="Descartar experimento" className="rounded border border-border p-2 text-red-400"><Trash2 className="h-4 w-4" /></button>}
            </div>
            {error && <div role="alert" className="px-4 py-2 text-sm text-red-400">{error}</div>}
            {selectedVersion?.validation && <div className="border-b border-border px-4 py-2 text-xs text-muted-foreground">{selectedVersion.validation.checks.map((check) => `${check.ok ? '✓' : '✗'} ${check.name}${check.detail ? `: ${check.detail}` : ''}`).join(' · ')}</div>}
            {selectedVersion?.status === 'ready' && version ? <CapabilityPreview key={`${detail.draft.id}:${version}`} detail={detail} version={version} /> : <div className="m-auto text-sm text-muted-foreground">Execute os testes para abrir a prévia.</div>}
            <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">Ações na prévia executam código real. Para mudar algo, descreva o ajuste na conversa ao lado.</div>
          </>}
        </section>
      </div>
    </div>
  )
}
