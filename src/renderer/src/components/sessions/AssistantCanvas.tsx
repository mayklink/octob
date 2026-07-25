import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronRight, Loader2, X } from 'lucide-react'
import { ToolCard } from './ToolCard'
import { StreamingCursor } from './StreamingCursor'
import { MarkdownRenderer } from './MarkdownRenderer'
import { SubtaskCard } from './SubtaskCard'
import { ReasoningBlock } from './ReasoningBlock'
import { CompactionPill } from './CompactionPill'
import { cn } from '@/lib/utils'
import type { StreamingPart } from './SessionView'

interface AssistantCanvasProps {
  content: string
  timestamp: string
  isStreaming?: boolean
  /** Interleaved parts (text + tool uses) for rich rendering */
  parts?: StreamingPart[]
  /** Working directory for relative path display */
  cwd?: string | null
}

function hasMeaningfulText(text: string | undefined): boolean {
  if (!text) return false
  // Treat zero-width separators as whitespace so invisible deltas don't create "text" spacing blocks.
  return text.replace(/[\s\u200B-\u200D\uFEFF]/g, '').length > 0
}

function hasToolParts(parts: StreamingPart[] | undefined): boolean {
  if (!parts || parts.length === 0) return false

  for (const part of parts) {
    if (part.type === 'tool_use' && part.toolUse) {
      return true
    }
  }
  return false
}

function normalizeRenderableParts(parts: StreamingPart[]): StreamingPart[] {
  const normalized: StreamingPart[] = []

  for (const part of parts) {
    const previous = normalized[normalized.length - 1]

    if (part.type === 'text' && previous?.type === 'text') {
      normalized[normalized.length - 1] = {
        ...previous,
        text: `${previous.text ?? ''}${part.text ?? ''}`
      }
      continue
    }

    if (part.type === 'reasoning' && previous?.type === 'reasoning') {
      normalized[normalized.length - 1] = {
        ...previous,
        reasoning: `${previous.reasoning ?? ''}${part.reasoning ?? ''}`
      }
      continue
    }

    normalized.push(part)
  }

  return normalized
}

function isCollapsibleActivityPart(part: StreamingPart): boolean {
  if (part.type !== 'tool_use' || !part.toolUse) return false

  const name = part.toolUse.name.toLowerCase()
  return name !== 'exitplanmode' && name !== 'todowrite'
}

function toolActivityLabel(parts: StreamingPart[]): string {
  const categories = {
    commands: 0,
    changes: 0,
    inspected: 0,
    other: 0
  }

  for (const part of parts) {
    if (!part.toolUse) continue
    const name = part.toolUse.name.toLowerCase()
    if (/(bash|shell|command|terminal|exec)/.test(name)) categories.commands += 1
    else if (/(edit|write|patch|create|delete|move)/.test(name)) categories.changes += 1
    else if (/(read|search|find|list|glob|grep|inspect)/.test(name)) categories.inspected += 1
    else categories.other += 1
  }

  const labels: string[] = []
  if (categories.changes) labels.push(`${categories.changes} file ${categories.changes === 1 ? 'change' : 'changes'}`)
  if (categories.commands) labels.push(`${categories.commands} ${categories.commands === 1 ? 'command' : 'commands'}`)
  if (categories.inspected) labels.push(`${categories.inspected} ${categories.inspected === 1 ? 'inspection' : 'inspections'}`)
  if (categories.other) labels.push(`${categories.other} other ${categories.other === 1 ? 'action' : 'actions'}`)
  return labels.join(' · ')
}

export function ToolActivityGroup({
  parts,
  cwd,
  isStreaming
}: {
  parts: StreamingPart[]
  cwd?: string | null
  isStreaming: boolean
}): React.JSX.Element {
  const [isExpanded, setIsExpanded] = useState(isStreaming)
  const wasStreamingRef = useRef(isStreaming)

  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) {
      setIsExpanded(false)
    }
    wasStreamingRef.current = isStreaming
  }, [isStreaming])

  const tools = parts.flatMap((part) => (part.toolUse ? [part.toolUse] : []))
  const runningCount = tools.filter(
    (tool) => tool.status === 'pending' || tool.status === 'running'
  ).length
  const errorCount = tools.filter((tool) => tool.status === 'error').length
  const successCount = tools.filter((tool) => tool.status === 'success').length
  const summary = toolActivityLabel(parts)

  return (
    <div
      className="my-1 overflow-hidden rounded-md border border-border bg-muted/20 text-xs"
      data-testid="tool-activity-group"
    >
      <button
        type="button"
        onClick={() => setIsExpanded((expanded) => !expanded)}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left transition-colors hover:bg-muted/50"
        aria-expanded={isExpanded}
        data-testid="tool-activity-group-trigger"
      >
        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-150',
            isExpanded && 'rotate-90'
          )}
        />
        <span className="shrink-0 font-medium text-foreground">
          {isStreaming ? 'Working' : 'Activity summary'}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
          {summary}
        </span>
        {runningCount > 0 && (
          <span className="inline-flex shrink-0 items-center gap-1 text-blue-400">
            <Loader2 className="h-3 w-3 animate-spin" />
            {runningCount}
          </span>
        )}
        {successCount > 0 && (
          <span className="inline-flex shrink-0 items-center gap-1 text-emerald-400">
            <Check className="h-3 w-3" />
            {successCount}
          </span>
        )}
        {errorCount > 0 && (
          <span className="inline-flex shrink-0 items-center gap-1 text-red-400">
            <X className="h-3 w-3" />
            {errorCount}
          </span>
        )}
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {isExpanded ? 'Hide' : 'Show'}
        </span>
      </button>
      {isExpanded && (
        <div className="space-y-1 border-t border-border px-2 py-1.5" data-testid="tool-activity-group-content">
          {tools.map((tool) => (
            <ToolCard key={tool.id} toolUse={tool} cwd={cwd} compact />
          ))}
        </div>
      )}
    </div>
  )
}

/** Render interleaved parts (text + tool cards) */
function renderParts(
  normalizedParts: StreamingPart[],
  isStreaming: boolean,
  cwd?: string | null,
  forceCompactTools = false
): React.JSX.Element {
  const renderedParts: React.JSX.Element[] = []
  let index = 0

  while (index < normalizedParts.length) {
    const part = normalizedParts[index]

    if (part.type === 'text') {
      const text = part.text ?? ''
      const isLastPart = index === normalizedParts.length - 1
      if (!hasMeaningfulText(text)) {
        if (isStreaming && isLastPart) {
          renderedParts.push(<StreamingCursor key={`cursor-${index}`} />)
        }
        index += 1
        continue
      }
      renderedParts.push(
        <div key={`part-${index}`}>
          <MarkdownRenderer content={text} />
          {isStreaming && isLastPart && <StreamingCursor />}
        </div>
      )
      index += 1
      continue
    }

    if (part.type === 'tool_use') {
      if (isCollapsibleActivityPart(part)) {
        const activityParts: StreamingPart[] = []
        let activityIndex = index

        while (
          activityIndex < normalizedParts.length &&
          isCollapsibleActivityPart(normalizedParts[activityIndex])
        ) {
          activityParts.push(normalizedParts[activityIndex])
          activityIndex += 1
        }

        // Technical activity is supporting context, even when there is only one
        // command. Keep it summarized by default and reveal details on demand.
        if (activityParts.length >= 1) {
          const firstToolId = activityParts[0].toolUse?.id ?? index
          renderedParts.push(
            <ToolActivityGroup
              key={`tool-activity-${firstToolId}`}
              parts={activityParts}
              cwd={cwd}
              isStreaming={isStreaming}
            />
          )
          index = activityIndex
          continue
        }
      }

      if (part.toolUse) {
        renderedParts.push(
          <ToolCard
            key={`tool-${part.toolUse.id}`}
            toolUse={part.toolUse}
            cwd={cwd}
            compact={forceCompactTools}
          />
        )
      }
      index += 1
      continue
    }

    if (part.type === 'subtask' && part.subtask) {
      renderedParts.push(<SubtaskCard key={`subtask-${index}`} subtask={part.subtask} />)
      index += 1
      continue
    }

    if (part.type === 'reasoning' && part.reasoning) {
      // Reasoning is still streaming only if the overall message is streaming
      // AND there are no meaningful parts after this one (text with content, tool_use, etc.)
      const hasContentAfter = normalizedParts.slice(index + 1).some((p) => {
        if (p.type === 'tool_use') return true
        if (p.type === 'text' && hasMeaningfulText(p.text)) return true
        if (p.type === 'reasoning') return true
        return false
      })
      const isReasoningStreaming = isStreaming && !hasContentAfter

      renderedParts.push(
        <ReasoningBlock
          key={`reasoning-${index}`}
          text={part.reasoning}
          isStreaming={isReasoningStreaming}
        />
      )
      index += 1
      continue
    }

    if (part.type === 'compaction') {
      renderedParts.push(
        <CompactionPill key={`compaction-${index}`} auto={part.compactionAuto ?? false} />
      )
      index += 1
      continue
    }

    // step_start and step_finish are boundary markers — skip rendering
    if (part.type === 'step_start' || part.type === 'step_finish') {
      index += 1
      continue
    }

    index += 1
  }

  return (
    <>
      {renderedParts}
      {/* Show streaming cursor at end if last part is a tool (text will come after) */}
      {isStreaming &&
        normalizedParts.length > 0 &&
        normalizedParts[normalizedParts.length - 1].type === 'tool_use' && (
          <StreamingCursor />
        )}
    </>
  )
}

export const AssistantCanvas = memo(function AssistantCanvas({
  content,
  timestamp: _timestamp,
  isStreaming = false,
  parts,
  cwd
}: AssistantCanvasProps): React.JSX.Element {
  const hasParts = parts && parts.length > 0
  const normalizedParts = useMemo(
    () => (hasParts ? normalizeRenderableParts(parts!) : undefined),
    [hasParts, parts]
  )
  const shouldUseCompactToolSpacing = hasToolParts(parts)

  return (
    <div
      className={cn('px-6', shouldUseCompactToolSpacing ? 'py-3' : 'py-5')}
      data-testid="message-assistant"
    >
      <div className="text-sm text-foreground leading-relaxed space-y-2">
        {hasParts ? (
          renderParts(normalizedParts!, isStreaming, cwd, shouldUseCompactToolSpacing)
        ) : (
          <>
            <MarkdownRenderer content={content} />
            {isStreaming && <StreamingCursor />}
          </>
        )}
      </div>
    </div>
  )
})
