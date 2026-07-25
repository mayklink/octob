import { useState, useEffect, useCallback, useRef } from 'react'
import { toast } from '@/lib/toast'

export interface BashRunView {
  id: string
  command: string
  output: string
  status: 'running' | 'exited' | 'killed' | 'truncated' | 'error'
  startedAt: number
}

export function useBashRuns(sessionId: string): {
  runs: BashRunView[]
  isRunning: boolean
  runCommand: (command: string, cwd: string) => Promise<void>
  abort: () => Promise<void>
} {
  const [runs, setRuns] = useState<BashRunView[]>([])
  const runsRef = useRef(runs)
  runsRef.current = runs

  // Seed state from any existing run on mount
  useEffect(() => {
    let cancelled = false
    window.bash.getRun(sessionId).then((snapshot) => {
      if (cancelled || !snapshot) return
      // Avoid duplicates if a stream event already added this run
      setRuns((prev) => {
        if (prev.some((r) => r.id === snapshot.id)) return prev
        return [
          ...prev,
          {
            id: snapshot.id,
            command: snapshot.command,
            output: snapshot.outputBuffer,
            status: snapshot.status,
            startedAt: snapshot.startedAt
          }
        ]
      })
    })
    return () => {
      cancelled = true
    }
  }, [sessionId])

  // Subscribe to stream events
  useEffect(() => {
    const unsubscribe = window.bash.onStream((event: BashStreamEvent) => {
      if (event.sessionId !== sessionId) return

      if (event.type === 'start') {
        setRuns((prev) => {
          // Dedup in case seed already added it
          if (prev.some((r) => r.id === event.runId)) return prev
          return [
            ...prev,
            {
              id: event.runId,
              command: event.command,
              output: '',
              status: 'running',
              startedAt: event.startedAt
            }
          ]
        })
      } else if (event.type === 'output') {
        setRuns((prev) =>
          prev.map((r) => (r.id === event.runId ? { ...r, output: r.output + event.data } : r))
        )
      } else if (event.type === 'end') {
        setRuns((prev) =>
          prev.map((r) => (r.id === event.runId ? { ...r, status: event.status } : r))
        )
      }
    })

    return unsubscribe
  }, [sessionId])

  const isRunning = runs.some((r) => r.status === 'running')

  const runCommand = useCallback(
    async (command: string, cwd: string) => {
      const result = await window.bash.run(sessionId, command, cwd)
      if (!result.success) {
        toast.error(result.error ?? 'Failed to run command')
      }
    },
    [sessionId]
  )

  const abort = useCallback(async () => {
    await window.bash.abort(sessionId)
  }, [sessionId])

  return { runs, isRunning, runCommand, abort }
}
