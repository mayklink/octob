import { useCallback, useEffect, useState } from 'react'
import { useTerminalTabStore } from '@/stores/useTerminalTabStore'
import type { TerminalTab } from '@/stores/useTerminalTabStore'
import { useTerminalStore } from '@/stores/useTerminalStore'
import { useShallow } from 'zustand/react/shallow'

/**
 * Stable empty array to avoid infinite re-render loops in useShallow selectors.
 *
 * `useShallow` uses `Object.is` to compare each property of the selector result.
 * An inline `?? []` creates a new array reference on every selector invocation,
 * which `Object.is([]_prev, []_next)` considers different. During React's commit
 * phase, `useSyncExternalStore` re-runs the selector for tearing detection — if
 * the result is always "different" (due to unstable `[]`), it forces a synchronous
 * re-render, which triggers another tearing check, creating an infinite loop.
 */
const EMPTY_TABS: TerminalTab[] = []

export interface UseTerminalTabActionsReturn {
  tabs: TerminalTab[]
  activeTabId: string | undefined
  handleCreateTab: () => void
  handleCloseTab: (tabId: string) => void
  handleCloseOtherTabs: (keepTabId: string) => void
  handleSelectTab: (tabId: string) => void
  handleRenameTab: (tabId: string, name: string) => void
  closeConfirmTab: { id: string; name: string; mode: 'single' | 'close-others' } | null
  confirmCloseTab: () => void
  cancelCloseConfirm: () => void
}

export function useTerminalTabActions(worktreeId: string): UseTerminalTabActionsReturn {
  const { tabs, activeTabId } = useTerminalTabStore(
    useShallow((s) => ({
      tabs: s.tabsByWorktree.get(worktreeId) ?? EMPTY_TABS,
      activeTabId: s.activeTabByWorktree.get(worktreeId)
    }))
  )

  const { createTab, setActiveTab, closeTab, renameTab, closeOtherTabs } = useTerminalTabStore(
    useShallow((s) => ({
      createTab: s.createTab,
      setActiveTab: s.setActiveTab,
      closeTab: s.closeTab,
      renameTab: s.renameTab,
      closeOtherTabs: s.closeOtherTabs
    }))
  )

  const destroyTerminal = useTerminalStore((s) => s.destroyTerminal)

  const [closeConfirmTab, setCloseConfirmTab] = useState<{
    id: string
    name: string
    mode: 'single' | 'close-others'
  } | null>(null)

  const handleCreateTab = useCallback(() => {
    createTab(worktreeId)
  }, [createTab, worktreeId])

  const handleCloseTab = useCallback(
    (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId)
      if (!tab) return

      if (tab.status === 'running') {
        setCloseConfirmTab({ id: tab.id, name: tab.name, mode: 'single' })
      } else {
        closeTab(worktreeId, tabId)
        destroyTerminal(tabId)
      }
    },
    [tabs, worktreeId, closeTab, destroyTerminal]
  )

  const confirmCloseTab = useCallback(() => {
    if (!closeConfirmTab) return

    if (closeConfirmTab.mode === 'close-others') {
      const tabsToClose = tabs.filter((t) => t.id !== closeConfirmTab.id)
      for (const tab of tabsToClose) {
        destroyTerminal(tab.id)
      }
      closeOtherTabs(worktreeId, closeConfirmTab.id)
    } else {
      closeTab(worktreeId, closeConfirmTab.id)
      destroyTerminal(closeConfirmTab.id)
    }

    setCloseConfirmTab(null)
  }, [closeConfirmTab, tabs, worktreeId, closeTab, closeOtherTabs, destroyTerminal])

  const handleCloseOtherTabs = useCallback(
    (keepTabId: string) => {
      const tabsToClose = tabs.filter((t) => t.id !== keepTabId)
      const runningCount = tabsToClose.filter((t) => t.status === 'running').length

      if (runningCount > 0) {
        setCloseConfirmTab({
          id: keepTabId,
          name: `${runningCount} running terminal${runningCount > 1 ? 's' : ''}`,
          mode: 'close-others'
        })
      } else {
        for (const tab of tabsToClose) {
          destroyTerminal(tab.id)
        }
        closeOtherTabs(worktreeId, keepTabId)
      }
    },
    [tabs, worktreeId, destroyTerminal, closeOtherTabs]
  )

  const handleSelectTab = useCallback(
    (tabId: string) => {
      setActiveTab(worktreeId, tabId)
    },
    [setActiveTab, worktreeId]
  )

  const handleRenameTab = useCallback(
    (tabId: string, name: string) => {
      renameTab(worktreeId, tabId, name)
    },
    [renameTab, worktreeId]
  )

  const cancelCloseConfirm = useCallback(() => {
    setCloseConfirmTab(null)
  }, [])

  // Listen for close-terminal-tab events dispatched by Cmd+W keyboard shortcut
  useEffect(() => {
    const handler = (e: CustomEvent): void => {
      const { tabId, tabName } = e.detail
      setCloseConfirmTab({ id: tabId, name: tabName, mode: 'single' })
    }
    window.addEventListener('octob:close-terminal-tab', handler as EventListener)
    return () => window.removeEventListener('octob:close-terminal-tab', handler as EventListener)
  }, [])

  return {
    tabs,
    activeTabId,
    handleCreateTab,
    handleCloseTab,
    handleCloseOtherTabs,
    handleSelectTab,
    handleRenameTab,
    closeConfirmTab,
    confirmCloseTab,
    cancelCloseConfirm
  }
}
