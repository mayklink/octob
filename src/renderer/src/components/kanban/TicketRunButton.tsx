import { Play, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { TicketRunScriptState } from '@/hooks/useTicketRunScript'

interface TicketRunButtonProps {
  state: TicketRunScriptState
  testId: string
  className?: string
}

/**
 * Presentational Run/Stop button for the kanban ticket modal.
 * Renders null when the ticket has no attached worktree or the project has
 * no `run_script` configured.
 */
export function TicketRunButton({ state, testId, className }: TicketRunButtonProps): React.JSX.Element | null {
  const { hasRunScript, runRunning, handleRunScript, handleStopScript } = state
  if (!hasRunScript) return null

  return (
    <Button
      type="button"
      variant="outline"
      data-testid={testId}
      onClick={runRunning ? handleStopScript : handleRunScript}
      className={cn(
        'gap-1.5',
        runRunning
          ? 'border-red-500/30 text-red-500 hover:bg-red-500/10'
          : 'border-green-500/30 text-green-500 hover:bg-green-500/10',
        className
      )}
    >
      {runRunning ? (
        <>
          <Square className="h-3.5 w-3.5" /> Stop
        </>
      ) : (
        <>
          <Play className="h-3.5 w-3.5" /> Run
        </>
      )}
      <kbd className="ml-1 text-[10px] opacity-60 font-sans">⌘R</kbd>
    </Button>
  )
}
