import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  memo,
  forwardRef,
  useImperativeHandle
} from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { AlertCircle, RefreshCw, Minimize2 } from 'lucide-react'
import { MessageRenderer } from './MessageRenderer'
import { ToolActivityGroup } from './AssistantCanvas'
import { QueuedMessageBubble } from './QueuedMessageBubble'
import type { OpenCodeMessage } from './SessionView'
import { formatCompletionDuration } from '@/lib/format-utils'
import octobMascotIcon from '@/pet/registry/octob/assets/octob.png'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type VirtualItem =
  | { key: string; type: 'message'; message: OpenCodeMessage }
  | { key: string; type: 'tool-activity-group'; messages: OpenCodeMessage[] }
  | { key: string; type: 'revert-banner' }
  | { key: string; type: 'error-banner' }
  | { key: string; type: 'retry-banner' }
  | { key: string; type: 'streaming'; message: OpenCodeMessage }
  | { key: string; type: 'typing-indicator' }
  | { key: string; type: 'queued'; queuedMessage: { id: string; content: string } }
  | { key: string; type: 'completion' }

export interface VirtualizedMessageListProps {
  messages: OpenCodeMessage[]
  streamingMessage: OpenCodeMessage | null
  isStreaming: boolean
  isSending: boolean
  isCompacting: boolean
  cwd: string | null
  onForkAssistantMessage: (message: OpenCodeMessage) => void | Promise<void>
  forkingMessageId: string | null
  revertMessageID: string | null
  revertedUserCount: number
  onRedoRevert: () => void
  sessionErrorMessage: string | null
  sessionErrorStderr: string | null
  sessionRetry: { attempt?: number; message?: string } | null
  retrySecondsRemaining: number | null
  hasVisibleWritingCursor: boolean
  queuedMessages: { id: string; content: string }[]
  canSteer: boolean
  onSteerMessage: (messageId: string, content: string) => void | Promise<void>
  steeringMessageId: string | null
  completionEntry: { word?: string; durationMs?: number } | null
  scrollElement: HTMLDivElement | null
  lockViewport: boolean
  disableVirtualization?: boolean
}

export interface VirtualizedMessageListHandle {
  scrollToEnd: (behavior?: ScrollBehavior) => void
  captureViewportAnchor: () => VirtualizedMessageListViewportAnchor | null
  restoreViewportAnchor: (anchor: VirtualizedMessageListViewportAnchor) => boolean
}

export interface VirtualizedMessageListViewportAnchor {
  itemKey: string
  offsetWithinItem: number
  fallbackScrollTop: number
  fallbackScrollHeight: number
  distanceFromBottom: number
}

export function getVirtualizedMessageListItemKey(item: VirtualItem): string {
  return item.key
}

function isCollapsibleToolMessage(message: OpenCodeMessage): boolean {
  if (message.role !== 'assistant' || message.content.trim().length > 0) return false
  if (!message.parts || message.parts.length === 0) return false

  return message.parts.every((part) => {
    if (part.type !== 'tool_use' || !part.toolUse) return false
    const name = part.toolUse.name.toLowerCase()
    return name !== 'exitplanmode' && name !== 'todowrite'
  })
}

function getNearestMeasuredItemForOffset<T extends { start: number; end: number }>(
  measurements: T[],
  offset: number
): T | undefined {
  const containingItem = measurements.find((item) => item.start <= offset && item.end > offset)
  if (containingItem) return containingItem

  for (let i = measurements.length - 1; i >= 0; i--) {
    if (measurements[i].start <= offset) {
      return measurements[i]
    }
  }

  return measurements[0]
}

function shouldRestoreFromBottomDistance(anchor: VirtualizedMessageListViewportAnchor): boolean {
  return anchor.distanceFromBottom >= 0 && anchor.distanceFromBottom < 480
}

function VirtualizedMessageRow({
  index,
  start,
  measureElement,
  children
}: {
  index: number
  start: number
  measureElement: (element: Element | null) => void
  children: React.ReactNode
}): React.JSX.Element {
  const rowRef = useRef<HTMLDivElement | null>(null)

  const setRowRef = useCallback(
    (element: HTMLDivElement | null) => {
      rowRef.current = element
      measureElement(element)
    },
    [measureElement]
  )

  useEffect(() => {
    const row = rowRef.current
    if (!row) return

    let animationFrame: number | null = null
    let timeout: number | null = null
    const measureSoon = () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame)
      }
      if (timeout !== null) {
        window.clearTimeout(timeout)
      }

      const measure = () => {
        timeout = null
        animationFrame = null
        measureElement(row)
      }

      if (typeof window.requestAnimationFrame === 'function') {
        animationFrame = window.requestAnimationFrame(measure)
      } else {
        timeout = window.setTimeout(measure, 0)
      }
    }

    measureSoon()

    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measureSoon) : null
    observer?.observe(row)

    const images = Array.from(row.querySelectorAll('img'))
    images.forEach((image) => {
      if (!image.complete) {
        image.addEventListener('load', measureSoon)
        image.addEventListener('error', measureSoon)
      }
    })

    return () => {
      observer?.disconnect()
      images.forEach((image) => {
        image.removeEventListener('load', measureSoon)
        image.removeEventListener('error', measureSoon)
      })
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame)
      }
      if (timeout !== null) {
        window.clearTimeout(timeout)
      }
    }
  }, [children, measureElement])

  return (
    <div
      data-index={index}
      ref={setRowRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        overflowAnchor: 'none',
        transform: `translateY(${start}px)`
      }}
    >
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const VirtualizedMessageList = memo(
  forwardRef<VirtualizedMessageListHandle, VirtualizedMessageListProps>(
    function VirtualizedMessageList(
      {
        messages,
        streamingMessage,
        isStreaming,
        isSending,
        isCompacting,
        cwd,
        onForkAssistantMessage,
        forkingMessageId,
        revertMessageID,
        revertedUserCount,
        onRedoRevert,
        sessionErrorMessage,
        sessionErrorStderr,
        sessionRetry,
        retrySecondsRemaining,
        hasVisibleWritingCursor,
        queuedMessages,
        canSteer,
        onSteerMessage,
        steeringMessageId,
        completionEntry,
        scrollElement,
        lockViewport,
        disableVirtualization = false
      }: VirtualizedMessageListProps,
      ref
    ): React.JSX.Element {
      // Build the flat item array that drives the virtualizer
      const items = useMemo(() => {
        const result: VirtualItem[] = []

        // Messages
        for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
          const message = messages[messageIndex]

          if (isCollapsibleToolMessage(message)) {
            const toolMessages = [message]
            let nextIndex = messageIndex + 1

            while (
              nextIndex < messages.length &&
              isCollapsibleToolMessage(messages[nextIndex])
            ) {
              toolMessages.push(messages[nextIndex])
              nextIndex += 1
            }

            if (toolMessages.length >= 2) {
              result.push({
                key: `tool-activity-group:${toolMessages[0].id}`,
                type: 'tool-activity-group' as const,
                messages: toolMessages
              })
              messageIndex = nextIndex - 1
              continue
            }
          }

          result.push({ key: `message:${message.id}`, type: 'message' as const, message })
        }

        // Revert banner
        if (revertMessageID && revertedUserCount > 0) {
          result.push({ key: `revert-banner:${revertMessageID}`, type: 'revert-banner' as const })
        }

        // Error banner
        if (sessionErrorMessage) {
          result.push({ key: 'error-banner', type: 'error-banner' as const })
        }

        // Retry banner
        if (sessionRetry) {
          result.push({ key: 'retry-banner', type: 'retry-banner' as const })
        }

        // Streaming message
        if (streamingMessage) {
          result.push({
            key: `streaming:${streamingMessage.id}`,
            type: 'streaming' as const,
            message: streamingMessage
          })
        }

        // Typing indicator
        if (isSending && !hasVisibleWritingCursor) {
          result.push({ key: 'typing-indicator', type: 'typing-indicator' as const })
        }

        // Queued messages
        for (const msg of queuedMessages) {
          result.push({ key: `queued:${msg.id}`, type: 'queued' as const, queuedMessage: msg })
        }

        // Completion badge
        if (completionEntry && !isSending && !sessionErrorMessage) {
          result.push({ key: 'completion', type: 'completion' as const })
        }

        return result
      }, [
        messages,
        revertMessageID,
        revertedUserCount,
        sessionErrorMessage,
        sessionRetry,
        streamingMessage,
        isSending,
        hasVisibleWritingCursor,
        queuedMessages,
        completionEntry
      ])

      const virtualizer = useVirtualizer({
        count: items.length,
        getScrollElement: () => scrollElement,
        getItemKey: (index) => getVirtualizedMessageListItemKey(items[index]),
        estimateSize: () => 150,
        overscan: 5
      })
      virtualizer.shouldAdjustScrollPositionOnItemSizeChange =
        lockViewport || disableVirtualization ? () => false : undefined

      const scrollToEndCorrectionFramesRef = useRef<number[]>([])

      const cancelScrollToEndCorrections = useCallback(() => {
        for (const frame of scrollToEndCorrectionFramesRef.current) {
          window.cancelAnimationFrame(frame)
        }
        scrollToEndCorrectionFramesRef.current = []
      }, [])

      const scheduleScrollToEndCorrection = useCallback(() => {
        if (!scrollElement || typeof window.requestAnimationFrame !== 'function') return

        cancelScrollToEndCorrections()

        const correctToEnd = () => {
          const maxScrollTop = Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight)
          if (Math.abs(scrollElement.scrollTop - maxScrollTop) >= 1) {
            scrollElement.scrollTop = maxScrollTop
          }
        }

        const firstFrame = window.requestAnimationFrame(() => {
          correctToEnd()

          const secondFrame = window.requestAnimationFrame(() => {
            correctToEnd()
            scrollToEndCorrectionFramesRef.current = []
          })
          scrollToEndCorrectionFramesRef.current = [secondFrame]
        })
        scrollToEndCorrectionFramesRef.current = [firstFrame]
      }, [cancelScrollToEndCorrections, scrollElement])

      useEffect(() => cancelScrollToEndCorrections, [cancelScrollToEndCorrections])

      useImperativeHandle(
        ref,
        () => ({
          scrollToEnd: (behavior?: ScrollBehavior) => {
            if (items.length > 0) {
              cancelScrollToEndCorrections()
              if (disableVirtualization && scrollElement) {
                const top = Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight)
                scrollElement.scrollTo?.({ top, behavior: behavior ?? 'instant' })
                if (Math.abs(scrollElement.scrollTop - top) >= 1) {
                  scrollElement.scrollTop = top
                }
              } else {
                virtualizer.scrollToIndex(items.length - 1, {
                  align: 'end',
                  behavior: behavior ?? 'instant'
                })
              }
              scheduleScrollToEndCorrection()
            }
          },
          captureViewportAnchor: () => {
            if (!scrollElement || items.length === 0) return null

            const scrollTop = scrollElement.scrollTop
            const anchorItem =
              virtualizer.getVirtualItemForOffset(scrollTop) ??
              getNearestMeasuredItemForOffset(virtualizer.measurementsCache, scrollTop)

            if (!anchorItem) return null

            return {
              itemKey: String(anchorItem.key),
              offsetWithinItem: Math.max(0, scrollTop - anchorItem.start),
              fallbackScrollTop: scrollTop,
              fallbackScrollHeight: scrollElement.scrollHeight,
              distanceFromBottom: Math.max(
                0,
                scrollElement.scrollHeight - scrollTop - scrollElement.clientHeight
              )
            }
          },
          restoreViewportAnchor: (anchor: VirtualizedMessageListViewportAnchor) => {
            if (!scrollElement) return false

            const anchorItem = virtualizer.measurementsCache.find(
              (measurement) => String(measurement.key) === anchor.itemKey
            )
            const fallbackScrollTop =
              anchor.fallbackScrollTop + (scrollElement.scrollHeight - anchor.fallbackScrollHeight)
            const bottomDistanceScrollTop =
              scrollElement.scrollHeight - scrollElement.clientHeight - anchor.distanceFromBottom
            const nextScrollTop = shouldRestoreFromBottomDistance(anchor)
              ? bottomDistanceScrollTop
              : anchorItem
                ? anchorItem.start + anchor.offsetWithinItem
                : fallbackScrollTop
            const maxScrollTop = Math.max(
              0,
              scrollElement.scrollHeight - scrollElement.clientHeight
            )
            const clampedScrollTop = Math.max(0, Math.min(nextScrollTop, maxScrollTop))

            if (Math.abs(scrollElement.scrollTop - clampedScrollTop) < 1) {
              return true
            }

            scrollElement.scrollTop = clampedScrollTop
            return true
          }
        }),
        [
          cancelScrollToEndCorrections,
          disableVirtualization,
          items,
          scheduleScrollToEndCorrection,
          scrollElement,
          virtualizer
        ]
      )

      // Render a single virtual item
      const renderItem = (item: VirtualItem) => {
        switch (item.type) {
          case 'message':
            return (
              <MessageRenderer
                key={item.message.id}
                message={item.message}
                cwd={cwd}
                onForkAssistantMessage={onForkAssistantMessage}
                forkDisabled={forkingMessageId !== null && forkingMessageId !== item.message.id}
                isForking={forkingMessageId === item.message.id}
              />
            )

          case 'tool-activity-group':
            return (
              <div className="px-6 py-3">
                <ToolActivityGroup
                  parts={item.messages.flatMap((message) => message.parts ?? [])}
                  cwd={cwd}
                  isStreaming={
                    isStreaming &&
                    item.messages.some((message) =>
                      message.parts?.some(
                        (part) =>
                          part.toolUse?.status === 'pending' || part.toolUse?.status === 'running'
                      )
                    )
                  }
                />
              </div>
            )

          case 'revert-banner':
            return (
              <div
                className="mx-6 my-3 rounded-lg border border-border/50 bg-muted/30 px-4 py-3"
                data-testid="revert-banner"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {revertedUserCount} {revertedUserCount === 1 ? 'message' : 'messages'} reverted
                  </span>
                  <button
                    className="text-xs text-primary hover:text-primary/80 font-medium transition-colors"
                    onClick={onRedoRevert}
                  >
                    /redo to restore
                  </button>
                </div>
              </div>
            )

          case 'error-banner':
            return (
              <div
                className="mx-6 my-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3"
                data-testid="session-error-banner"
              >
                <div className="flex items-start gap-2 text-destructive">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="text-sm font-medium">Session error</p>
                    <p className="mt-0.5 text-sm text-destructive/90">{sessionErrorMessage}</p>
                    {sessionErrorStderr && (
                      <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-destructive/10 px-2 py-1.5 font-mono text-xs text-destructive/80">
                        {sessionErrorStderr}
                      </pre>
                    )}
                  </div>
                </div>
              </div>
            )

          case 'retry-banner':
            return (
              <div
                className="mx-6 my-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3"
                data-testid="session-retry-banner"
              >
                <div className="flex items-start gap-2 text-destructive">
                  <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
                  <div>
                    <p className="text-sm font-medium">
                      Retrying
                      {retrySecondsRemaining !== null ? ` in ${retrySecondsRemaining}s` : ''}{' '}
                      (attempt {sessionRetry?.attempt ?? 1})
                    </p>
                    {sessionRetry?.message && (
                      <p className="mt-0.5 text-sm text-destructive/90">{sessionRetry.message}</p>
                    )}
                  </div>
                </div>
              </div>
            )

          case 'streaming':
            return (
              <MessageRenderer
                message={item.message}
                isStreaming={isStreaming}
                cwd={cwd}
                onForkAssistantMessage={onForkAssistantMessage}
                forkDisabled={true}
              />
            )

          case 'typing-indicator':
            return (
              <div className="px-6 py-5" data-testid="typing-indicator">
                {isCompacting ? (
                  <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
                    <Minimize2 className="h-3.5 w-3.5 animate-pulse" />
                    <span>Compacting conversation...</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce" />
                    <span
                      className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce"
                      style={{ animationDelay: '0.1s' }}
                    />
                    <span
                      className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce"
                      style={{ animationDelay: '0.2s' }}
                    />
                  </div>
                )}
              </div>
            )

          case 'queued':
            return (
              <QueuedMessageBubble
                key={item.queuedMessage.id}
                content={item.queuedMessage.content}
                canSteer={canSteer}
                isLoading={steeringMessageId === item.queuedMessage.id}
                onSteer={() => onSteerMessage(item.queuedMessage.id, item.queuedMessage.content)}
              />
            )

          case 'completion':
            return (
              <div
                className="flex items-center gap-1.5 px-6 py-2 text-xs"
                style={{ color: '#C15F3C' }}
                data-testid="completion-badge"
              >
                <img src={octobMascotIcon} alt="" className="h-7 w-7" />
                <span className="font-medium">
                  {completionEntry?.word ?? 'Worked'} for{' '}
                  {formatCompletionDuration(completionEntry?.durationMs ?? 0)}
                </span>
              </div>
            )

          default:
            return null
        }
      }

      if (disableVirtualization) {
        return (
          <div className="py-4" style={{ overflowAnchor: 'none' }}>
            {items.map((item) => (
              <div key={item.key} style={{ overflowAnchor: 'none' }}>
                {renderItem(item)}
              </div>
            ))}
          </div>
        )
      }

      return (
        <div className="py-4" style={{ overflowAnchor: 'none' }}>
          <div
            style={{
              height: virtualizer.getTotalSize(),
              width: '100%',
              position: 'relative',
              overflowAnchor: 'none'
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const item = items[virtualRow.index]
              if (!item) return null
              return (
                <VirtualizedMessageRow
                  key={item.key}
                  index={virtualRow.index}
                  start={virtualRow.start}
                  measureElement={virtualizer.measureElement}
                >
                  {renderItem(item)}
                </VirtualizedMessageRow>
              )
            })}
          </div>
        </div>
      )
    }
  )
)
