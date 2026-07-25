import { Plus } from 'lucide-react'
import { useTerminalTabActions } from '@/hooks/useTerminalTabActions'
import { TerminalTabEntry } from './TerminalTabEntry'
import { TerminalCloseConfirmDialog } from './TerminalCloseConfirmDialog'

interface TerminalTabSidebarProps {
  worktreeId: string
}

export function TerminalTabSidebar({ worktreeId }: TerminalTabSidebarProps): React.JSX.Element {
  const {
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
  } = useTerminalTabActions(worktreeId)

  return (
    <div className="w-[140px] border-l border-border flex flex-col h-full bg-background/50">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1 border-b border-border shrink-0">
        <span className="text-xs text-muted-foreground font-medium select-none">Terminals</span>
        <button
          onClick={handleCreateTab}
          className="p-0.5 text-muted-foreground hover:text-foreground rounded transition-colors"
          title="New Terminal"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      {/* Scrollable tab list */}
      <div className="flex-1 overflow-y-auto py-0.5">
        {tabs.map((tab) => (
          <TerminalTabEntry
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            onSelect={() => handleSelectTab(tab.id)}
            onClose={() => handleCloseTab(tab.id)}
            onRename={(name) => handleRenameTab(tab.id, name)}
            onCloseOthers={() => handleCloseOtherTabs(tab.id)}
          />
        ))}
      </div>
      <TerminalCloseConfirmDialog
        open={closeConfirmTab !== null}
        onOpenChange={(open) => {
          if (!open) cancelCloseConfirm()
        }}
        terminalName={closeConfirmTab?.name ?? ''}
        description={
          closeConfirmTab?.mode === 'close-others'
            ? `${closeConfirmTab.name} ${closeConfirmTab.name.startsWith('1 ') ? 'has' : 'have'} a running process. Close anyway?`
            : undefined
        }
        onConfirm={confirmCloseTab}
      />
    </div>
  )
}
