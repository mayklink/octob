import { Globe, ExternalLink } from 'lucide-react'
import { wireValueToPrettyString } from '@/lib/tool-wire-display'
import type { ToolViewProps } from './types'

function formatResponseSize(content: string): string {
  const byteCount = new TextEncoder().encode(content).length

  if (byteCount < 1024) {
    return `${byteCount} byte${byteCount === 1 ? '' : 's'}`
  }

  if (byteCount < 1024 * 1024) {
    return `${(byteCount / 1024).toFixed(1)} KB`
  }

  return `${(byteCount / (1024 * 1024)).toFixed(1)} MB`
}

export function WebFetchToolView({ input, output, error }: ToolViewProps): React.JSX.Element {
  const url = (input.url || '') as string
  const prompt = (input.prompt || '') as string
  const outputStr = output !== undefined && output !== null ? wireValueToPrettyString(output) : ''
  const errorStr = error !== undefined && error !== null ? wireValueToPrettyString(error) : ''
  const responseSize = outputStr ? formatResponseSize(outputStr) : null

  return (
    <div className="text-xs" data-testid="webfetch-tool-view">
      {/* URL display */}
      <div className="flex items-center gap-2 px-3 pt-3 pb-1">
        <Globe className="h-4 w-4 text-blue-400 shrink-0" />
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 hover:text-blue-300 hover:underline truncate font-mono transition-colors"
          title={url}
        >
          {url}
        </a>
        <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
      </div>

      {/* Prompt */}
      {prompt && (
        <div className="px-3 pb-2 text-muted-foreground/70 truncate" title={prompt}>
          {prompt}
        </div>
      )}

      {/* Error */}
      {errorStr.length > 0 && (
        <div className="px-3 pb-2">
          <div className="text-red-400 font-mono whitespace-pre-wrap break-all bg-red-500/10 rounded p-2">
            {errorStr}
          </div>
        </div>
      )}

      {/* Output */}
      {outputStr.length > 0 && !errorStr.length && <div className="border-t border-border mx-3" />}
      {outputStr.length > 0 && !errorStr.length && (
        <>
          {responseSize && (
            <div
              className="px-3 pt-2 text-[10px] uppercase tracking-wide text-muted-foreground/70"
              data-testid="webfetch-response-size"
            >
              {responseSize}
            </div>
          )}
          <pre className="px-3 py-2 text-muted-foreground font-mono whitespace-pre-wrap break-words max-h-[300px] overflow-y-auto">
            {outputStr}
          </pre>
        </>
      )}
    </div>
  )
}
