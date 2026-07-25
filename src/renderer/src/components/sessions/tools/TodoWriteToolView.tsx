import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { wireValueToPrettyString } from '@/lib/tool-wire-display'
import type { ToolViewProps } from './types'
import { PriorityBadge, StatusIcon, todoBodyText, type TodoItem } from './todoIcons'

interface TodoInput {
  todos: TodoItem[]
}

export function TodoWriteToolView({ input, error }: ToolViewProps) {
  const errorStr = error !== undefined && error !== null ? wireValueToPrettyString(error) : ''
  const todoInput = input as unknown as TodoInput
  const todos = useMemo(
    () => (Array.isArray(todoInput?.todos) ? todoInput.todos : []),
    [todoInput?.todos]
  )

  if (todos.length === 0) {
    return (
      <div data-testid="todowrite-tool-view" className="text-xs text-muted-foreground">
        No tasks
      </div>
    )
  }

  return (
    <div data-testid="todowrite-tool-view">
      {/* Error */}
      {errorStr.length > 0 && (
        <div className="mb-2">
          <div className="text-red-400 font-mono text-xs whitespace-pre-wrap break-all bg-red-500/10 rounded p-2">
            {errorStr}
          </div>
        </div>
      )}

      {/* Todo list */}
      <div className="space-y-0.5">
        {todos.map((todo) => (
          <div
            key={todo.id}
            className={cn(
              'flex items-center gap-2 py-0.5 px-1 rounded-sm text-xs',
              todo.status === 'in_progress' && 'bg-blue-500/5'
            )}
          >
            <StatusIcon status={todo.status} />
            <span
              className={cn(
                'flex-1 min-w-0 truncate',
                (todo.status === 'completed' || todo.status === 'cancelled') &&
                  'line-through text-muted-foreground/50'
              )}
            >
              {todoBodyText(todo.content)}
            </span>
            <PriorityBadge priority={todo.priority} />
          </div>
        ))}
      </div>
    </div>
  )
}
