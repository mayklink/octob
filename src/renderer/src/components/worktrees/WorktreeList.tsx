import { useCallback, useEffect, useMemo, useState } from 'react'
import { useWorktreeStore } from '@/stores'
import { useSidebarBranchWatcher } from '@/hooks/useSidebarBranchWatcher'
import { WorktreeItem } from './WorktreeItem'
import { DirtyFilesConfirmDialog, type DiffStatFile } from './DirtyFilesConfirmDialog'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { Trash2, Loader2, X } from 'lucide-react'

interface Project {
  id: string
  name: string
  path: string
}

interface WorktreeListProps {
  project: Project
}

export function WorktreeList({ project }: WorktreeListProps): React.JSX.Element {
  const {
    getWorktreesForProject,
    syncWorktrees,
    reorderWorktrees,
    archiveWorktree,
    unbranchWorktree
  } = useWorktreeStore()
  const archivingWorktreeIds = useWorktreeStore((s) => s.archivingWorktreeIds)

  const worktrees = getWorktreesForProject(project.id)

  // Watch all worktree paths for branch changes (lightweight HEAD-only watchers)
  const worktreePaths = useMemo(() => worktrees.map((w) => w.path), [worktrees])
  useSidebarBranchWatcher(worktreePaths)

  // Drag state
  const [draggedWorktreeId, setDraggedWorktreeId] = useState<string | null>(null)
  const [dragOverWorktreeId, setDragOverWorktreeId] = useState<string | null>(null)
  const [selectedWorktreeIds, setSelectedWorktreeIds] = useState<Set<string>>(new Set())
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [dirtyConfirmOpen, setDirtyConfirmOpen] = useState(false)
  const [dirtyConfirmFiles, setDirtyConfirmFiles] = useState<DiffStatFile[]>([])
  const [isBulkDeleting, setIsBulkDeleting] = useState(false)

  const selectableWorktrees = useMemo(
    () => worktrees.filter((worktree) => !worktree.is_default),
    [worktrees]
  )

  const selectedWorktrees = useMemo(
    () => selectableWorktrees.filter((worktree) => selectedWorktreeIds.has(worktree.id)),
    [selectableWorktrees, selectedWorktreeIds]
  )

  const selectedCount = selectedWorktrees.length
  const selectionActive = selectedCount > 0
  const allSelected =
    selectableWorktrees.length > 0 && selectedCount === selectableWorktrees.length

  // Sync with git first (heals orphaned folders), then load — avoids flashing broken paths in git IPC
  useEffect(() => {
    void syncWorktrees(project.id, project.path)
  }, [project.id, project.path, syncWorktrees])

  useEffect(() => {
    const selectableIds = new Set(selectableWorktrees.map((worktree) => worktree.id))
    setSelectedWorktreeIds((prev) => {
      const next = new Set([...prev].filter((id) => selectableIds.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [selectableWorktrees])

  const handleDragStart = useCallback((e: React.DragEvent, worktreeId: string) => {
    setDraggedWorktreeId(worktreeId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', worktreeId)
  }, [])

  const handleDragOver = useCallback(
    (e: React.DragEvent, worktreeId: string) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (draggedWorktreeId && draggedWorktreeId !== worktreeId) {
        setDragOverWorktreeId(worktreeId)
      }
    },
    [draggedWorktreeId]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent, targetWorktreeId: string) => {
      e.preventDefault()
      if (!draggedWorktreeId || draggedWorktreeId === targetWorktreeId) return

      // Compute indices among non-default worktrees only
      const nonDefault = worktrees.filter((w) => !w.is_default)
      const fromIndex = nonDefault.findIndex((w) => w.id === draggedWorktreeId)
      const toIndex = nonDefault.findIndex((w) => w.id === targetWorktreeId)

      if (fromIndex !== -1 && toIndex !== -1) {
        reorderWorktrees(project.id, fromIndex, toIndex)
      }

      setDraggedWorktreeId(null)
      setDragOverWorktreeId(null)
    },
    [draggedWorktreeId, worktrees, project.id, reorderWorktrees]
  )

  const handleDragEnd = useCallback(() => {
    setDraggedWorktreeId(null)
    setDragOverWorktreeId(null)
  }, [])

  const toggleWorktreeSelection = useCallback((worktreeId: string): void => {
    setSelectedWorktreeIds((prev) => {
      const next = new Set(prev)
      if (next.has(worktreeId)) {
        next.delete(worktreeId)
      } else {
        next.add(worktreeId)
      }
      return next
    })
  }, [])

  const clearSelection = useCallback((): void => {
    setSelectedWorktreeIds(new Set())
  }, [])

  const selectAllWorktrees = useCallback((): void => {
    setSelectedWorktreeIds(new Set(selectableWorktrees.map((worktree) => worktree.id)))
  }, [selectableWorktrees])

  const toggleSelectAllWorktrees = useCallback((): void => {
    if (allSelected) {
      clearSelection()
      return
    }
    selectAllWorktrees()
  }, [allSelected, clearSelection, selectAllWorktrees])

  const doBulkDelete = useCallback(async (): Promise<void> => {
    if (selectedWorktrees.length === 0 || isBulkDeleting) return

    setDeleteConfirmOpen(false)
    setDirtyConfirmOpen(false)
    setDirtyConfirmFiles([])
    setIsBulkDeleting(true)

    const deletedIds: string[] = []
    const failures: string[] = []

    for (const worktree of selectedWorktrees) {
      const result = worktree.branch_name
        ? await archiveWorktree(worktree.id, worktree.path, worktree.branch_name, project.path)
        : await unbranchWorktree(worktree.id, worktree.path, worktree.branch_name, project.path)

      if (result.success) {
        deletedIds.push(worktree.id)
      } else {
        failures.push(`${worktree.name}: ${result.error || 'Unknown error'}`)
      }
    }

    setSelectedWorktreeIds((prev) => {
      const next = new Set(prev)
      for (const id of deletedIds) next.delete(id)
      return next
    })
    setIsBulkDeleting(false)

    if (deletedIds.length > 0) {
      toast.success(
        deletedIds.length === 1
          ? 'Workspace deleted'
          : `${deletedIds.length} workspaces deleted`
      )
    }

    if (failures.length > 0) {
      toast.error(`Failed to delete ${failures.length} workspace${failures.length === 1 ? '' : 's'}`)
    }
  }, [
    selectedWorktrees,
    isBulkDeleting,
    archiveWorktree,
    unbranchWorktree,
    project.path
  ])

  const handleBulkDelete = useCallback(async (): Promise<void> => {
    if (selectedWorktrees.length === 0 || isBulkDeleting) return

    const dirtyFiles: DiffStatFile[] = []
    for (const worktree of selectedWorktrees) {
      try {
        const result = await window.gitOps.getDiffStat(worktree.path)
        if (result.success && result.files && result.files.length > 0) {
          dirtyFiles.push(
            ...result.files.map((file) => ({
              ...file,
              path: `${worktree.name}/${file.path}`
            }))
          )
        }
      } catch {
        // If the diff check fails, still show the regular confirmation before deleting.
      }
    }

    if (dirtyFiles.length > 0) {
      setDirtyConfirmFiles(dirtyFiles)
      setDirtyConfirmOpen(true)
      return
    }

    setDeleteConfirmOpen(true)
  }, [selectedWorktrees, isBulkDeleting])

  return (
    <div className="mt-1" data-testid={`worktree-list-${project.id}`}>
      {selectableWorktrees.length > 1 && (
        <div
          className={cn(
            'ml-4 mb-1 flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors',
            selectionActive ? 'bg-muted/60' : 'text-muted-foreground'
          )}
        >
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={toggleSelectAllWorktrees}
            disabled={isBulkDeleting}
          >
            {allSelected ? 'Clear all' : 'Select all'}
          </Button>

          {selectionActive ? (
            <>
              <span className="flex-1 truncate">
                {allSelected ? 'All selected' : `${selectedCount} selected`}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-destructive hover:text-destructive"
                onClick={handleBulkDelete}
                disabled={isBulkDeleting}
              >
                {isBulkDeleting ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <Trash2 className="mr-1 h-3 w-3" />
                )}
                Delete
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={clearSelection}
                disabled={isBulkDeleting}
                aria-label="Clear workspace selection"
              >
                <X className="h-3 w-3" />
              </Button>
            </>
          ) : (
            <span className="flex-1 truncate text-[11px]">
              Or hover a workspace checkbox to select multiple
            </span>
          )}
        </div>
      )}

      {worktrees.map((worktree, index) => (
        <WorktreeItem
          key={worktree.id}
          worktree={worktree}
          projectPath={project.path}
          index={index}
          isFirstItem={index === 0}
          isDragging={draggedWorktreeId === worktree.id}
          isDragOver={dragOverWorktreeId === worktree.id}
          isMultiSelected={selectedWorktreeIds.has(worktree.id)}
          showSelectionControls={selectionActive}
          selectionDisabled={isBulkDeleting || archivingWorktreeIds.has(worktree.id)}
          onToggleMultiSelect={toggleWorktreeSelection}
          onDragStart={(e) => handleDragStart(e, worktree.id)}
          onDragOver={(e) => handleDragOver(e, worktree.id)}
          onDrop={(e) => handleDrop(e, worktree.id)}
          onDragEnd={handleDragEnd}
        />
      ))}

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete selected workspaces?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete {selectedCount} selected workspace{selectedCount === 1 ? '' : 's'}.
              Named workspace branches will also be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBulkDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={doBulkDelete}
              disabled={isBulkDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <DirtyFilesConfirmDialog
        open={dirtyConfirmOpen}
        worktreeName={`${selectedCount} selected workspace${selectedCount === 1 ? '' : 's'}`}
        files={dirtyConfirmFiles}
        description="have uncommitted changes that will be permanently lost."
        confirmLabel="Delete Anyway"
        confirmVariant="destructive"
        onCancel={() => {
          setDirtyConfirmOpen(false)
          setDirtyConfirmFiles([])
        }}
        onConfirm={doBulkDelete}
      />
    </div>
  )
}
