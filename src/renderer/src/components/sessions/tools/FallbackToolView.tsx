import { HelpCircle } from 'lucide-react'
import { truncateText, wireValueToPrettyString } from '@/lib/tool-wire-display'
import type { ToolViewProps } from './types'

const MAX_OUTPUT_LENGTH = 500

export function FallbackToolView({ name, input, output, error, status }: ToolViewProps) {
  let inputJson: string
  try {
    inputJson = JSON.stringify(input, null, 2)
  } catch {
    inputJson = '[unserializable input]'
  }

  const outputDisplay =
    output !== undefined && output !== null
      ? truncateText(wireValueToPrettyString(output), MAX_OUTPUT_LENGTH)
      : undefined

  const errorDisplay =
    error !== undefined && error !== null ? wireValueToPrettyString(error) : undefined

  const isBusy = status === 'pending' || status === 'running'
  const missingResult =
    (outputDisplay === undefined || outputDisplay === '') &&
    (errorDisplay === undefined || errorDisplay === '')

  return (
    <div data-testid="fallback-tool-view">
      {/* Header with TODO badge */}
      <div className="flex items-center gap-1.5 text-muted-foreground mb-2">
        <HelpCircle className="h-3.5 w-3.5" />
        <span className="font-mono text-xs font-medium text-foreground">{name}</span>
        <span className="text-[10px] bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 rounded px-1.5 py-0.5 font-medium">
          TODO
        </span>
      </div>

      {/* Separator */}
      <div className="border-t border-border mb-2" />

      {/* In-flight hint (ACP often delivers input/output incrementally). */}
      {isBusy && missingResult && (
        <div className="mb-2 rounded-md border border-blue-500/25 bg-blue-500/10 px-2 py-1.5 text-[11px] text-blue-200/90 leading-relaxed">
          Tool is executing — inputs or results may stream in gradually. Expand again in a moment if
          this panel looked empty at first.
        </div>
      )}

      {/* Error */}
      {errorDisplay !== undefined && errorDisplay !== '' && (
        <div className="mb-2">
          <div className="text-[10px] text-red-400 font-medium mb-1">Error:</div>
          <div className="text-red-400 font-mono text-xs whitespace-pre-wrap break-all">
            {errorDisplay}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="mb-2">
        <div className="text-[10px] text-muted-foreground font-medium mb-1">Input:</div>
        <pre className="text-xs font-mono text-muted-foreground bg-muted/50 rounded p-2 whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
          {inputJson}
        </pre>
      </div>

      {/* Output */}
      {outputDisplay !== undefined && outputDisplay !== '' && (
        <div className="mb-2">
          <div className="text-[10px] text-muted-foreground font-medium mb-1">Output:</div>
          <pre className="text-xs font-mono text-muted-foreground bg-muted/50 rounded p-2 whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
            {outputDisplay}
          </pre>
        </div>
      )}

      {/* Note */}
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground/60 mt-1">
        <span>No custom renderer — showing raw data</span>
      </div>
    </div>
  )
}
