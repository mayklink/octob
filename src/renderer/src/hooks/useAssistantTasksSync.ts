import { useEffect } from 'react'
import { useGlobalAssistantStore } from '@/stores/useGlobalAssistantStore'

/**
 * Keep delegated assistant jobs in sync app-wide, not just while the assistant
 * screen is mounted. The sidebar badge has to keep counting jobs that finish or
 * get blocked while the user is working inside a worktree.
 */
export function useAssistantTasksSync(): void {
  useEffect(() => {
    let cancelled = false

    const unsubscribeCreated = window.assistantOps.onTaskCreated((task) => {
      useGlobalAssistantStore.getState().addTask(task)
    })
    const unsubscribeChanged = window.assistantOps.onTasksChanged((tasks) => {
      useGlobalAssistantStore.getState().replaceTasks(tasks)
    })

    void window.assistantOps
      .listTasks()
      .then((tasks) => {
        if (!cancelled) useGlobalAssistantStore.getState().replaceTasks(tasks)
      })
      .catch((cause) => {
        console.warn('Failed to load delegated assistant tasks:', cause)
      })

    return () => {
      cancelled = true
      unsubscribeCreated()
      unsubscribeChanged()
    }
  }, [])
}
