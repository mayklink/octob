import { create } from 'zustand'

interface CapabilityStudioState {
  isOpen: boolean
  selectedId: string | null
  open: (id?: string) => void
  close: () => void
  select: (id: string) => void
}

export const useCapabilityStudioStore = create<CapabilityStudioState>((set) => ({
  isOpen: false,
  selectedId: null,
  open: (id) => {
    set((state) => ({ isOpen: true, selectedId: id ?? state.selectedId }))
  },
  close: () => set({ isOpen: false }),
  select: (id) => set({ selectedId: id })
}))
