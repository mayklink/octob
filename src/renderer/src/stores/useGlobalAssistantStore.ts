import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { AssistantTask } from '@shared/types/assistant'

interface GlobalAssistantState {
  isOpen: boolean
  assistantSessionId: string | null
  tasks: AssistantTask[]
  open: () => void
  close: () => void
  setAssistantSessionId: (sessionId: string) => void
  addTask: (task: GlobalAssistantState['tasks'][number]) => void
  mergeTasks: (tasks: AssistantTask[]) => void
}

export const useGlobalAssistantStore = create<GlobalAssistantState>()(
  persist(
    (set) => ({
      isOpen: false,
      assistantSessionId: null,
      tasks: [],
      open: () => set({ isOpen: true }),
      close: () => set({ isOpen: false }),
      setAssistantSessionId: (assistantSessionId) => set({ assistantSessionId }),
      addTask: (task) => set((state) => ({
        tasks: [task, ...state.tasks.filter((item) => item.sessionId !== task.sessionId)]
      })),
      mergeTasks: (tasks) => set((state) => ({
        tasks: [...tasks, ...state.tasks].filter(
          (task, index, all) => all.findIndex((item) => item.sessionId === task.sessionId) === index
        )
      }))
    }),
    {
      name: 'octob-global-assistant',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        assistantSessionId: state.assistantSessionId,
        tasks: state.tasks
      })
    }
  )
)
