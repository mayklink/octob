import { Code2, GitBranch } from 'lucide-react'
import { FileTree } from '@/components/file-tree/FileTree'
import { ChangesView } from '@/components/file-tree/ChangesView'
import { useFileViewerStore } from '@/stores/useFileViewerStore'
import type { WorkspaceMode } from '@/stores/useLayoutStore'

interface WorkspaceFocusViewProps {
  mode: Extract<WorkspaceMode, 'code' | 'git'>
  worktreeId: string
  worktreePath: string
}

export function WorkspaceFocusView({
  mode,
  worktreeId,
  worktreePath
}: WorkspaceFocusViewProps): React.JSX.Element {
  const handleFileClick = (node: { path: string; name: string; isDirectory: boolean }): void => {
    if (!node.isDirectory) {
      useFileViewerStore.getState().openFile(node.path, node.name, worktreeId)
    }
  }

  if (mode === 'git') {
    return (
      <section className="flex min-h-0 flex-1 flex-col bg-background" data-testid="git-workspace-mode">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b px-5">
          <GitBranch className="h-4 w-4 text-primary" />
          <div>
            <h2 className="text-sm font-semibold">Changes & review</h2>
            <p className="text-[11px] text-muted-foreground">Stage, inspect and commit this worktree</p>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden px-3 py-2">
          <ChangesView worktreePath={worktreePath} />
        </div>
      </section>
    )
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background" data-testid="code-workspace-mode">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-5">
        <Code2 className="h-4 w-4 text-primary" />
        <div>
          <h2 className="text-sm font-semibold">Code</h2>
          <p className="text-[11px] text-muted-foreground">Choose a file to open it in the main editor</p>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <FileTree
          worktreePath={worktreePath}
          onClose={() => undefined}
          onFileClick={handleFileClick}
          hideGitContextActions
        />
      </div>
    </section>
  )
}
