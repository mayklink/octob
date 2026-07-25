import {
  ChevronDown,
  ChevronUp,
  ChevronsUp,
  Circle,
  CircleCheck,
  CircleDot,
  CircleX
} from 'lucide-react'

export interface TodoItem {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  priority: 'high' | 'medium' | 'low'
}

/**
 * Some backends (e.g. Cursor ACP) send todo bodies as `{ content: string }`
 * instead of a plain string. React cannot render plain objects as children.
 */
export function todoBodyText(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (raw !== null && typeof raw === 'object' && 'content' in raw) {
    const inner = (raw as { content: unknown }).content
    if (typeof inner === 'string') return inner
    if (inner != null) {
      try {
        return JSON.stringify(inner)
      } catch {
        return String(inner)
      }
    }
  }
  if (raw == null) return ''
  try {
    return JSON.stringify(raw)
  } catch {
    return String(raw)
  }
}

export function StatusIcon({ status }: { status: TodoItem['status'] }) {
  switch (status) {
    case 'completed':
      return <CircleCheck className="h-3.5 w-3.5 text-green-500 shrink-0" />
    case 'in_progress':
      return <CircleDot className="h-3.5 w-3.5 text-blue-500 shrink-0 animate-pulse" />
    case 'cancelled':
      return <CircleX className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
    case 'pending':
    default:
      return <Circle className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
  }
}

export function PriorityBadge({ priority }: { priority: TodoItem['priority'] }) {
  switch (priority) {
    case 'high':
      return <ChevronsUp className="h-3.5 w-3.5 text-red-500 shrink-0" />
    case 'medium':
      return <ChevronUp className="h-3.5 w-3.5 text-amber-500 shrink-0" />
    case 'low':
      return <ChevronDown className="h-3.5 w-3.5 text-blue-500 shrink-0" />
    default:
      return null
  }
}
