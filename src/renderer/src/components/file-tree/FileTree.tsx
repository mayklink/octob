import { useEffect, useCallback, useRef, useMemo, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { FilePlus, FolderOpen } from 'lucide-react'
import { useFileTreeStore } from '@/stores/useFileTreeStore'
import { useGitStore } from '@/stores/useGitStore'
import { useFileViewerStore } from '@/stores/useFileViewerStore'
import { useWorktreeStore } from '@/stores/useWorktreeStore'
import { FileTreeHeader } from './FileTreeHeader'
import { FileTreeFilter } from './FileTreeFilter'
import { VirtualFileTreeNode } from './FileTreeNode'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/toast'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@/components/ui/context-menu'

// File tree node structure
interface FileTreeNode {
  name: string
  path: string
  relativePath: string
  isDirectory: boolean
  isSymlink?: boolean
  extension: string | null
  children?: FileTreeNode[]
}

// Git file status
interface GitFileStatus {
  path: string
  relativePath: string
  status: 'M' | 'A' | 'D' | '?' | 'C' | ''
  staged: boolean
}

const EMPTY_TREE: FileTreeNode[] = []
const EMPTY_EXPANDED_PATHS = new Set<string>()
const EMPTY_GIT_STATUSES: GitFileStatus[] = []

interface FlatNode {
  node: FileTreeNode
  depth: number
  isExpanded: boolean
}

interface FileTreeProps {
  worktreePath: string | null
  isConnectionMode?: boolean
  onClose?: () => void
  onFileClick?: (node: FileTreeNode) => void
  className?: string
  hideHeader?: boolean
  hideGitIndicators?: boolean
  hideGitContextActions?: boolean
}

// Helper to check if a node matches the filter
function matchesFilter(node: FileTreeNode, filter: string): boolean {
  return node.name.toLowerCase().includes(filter.toLowerCase())
}

// Helper to check if any descendant matches the filter
function hasMatchingDescendant(node: FileTreeNode, filter: string): boolean {
  if (!node.children) return false
  for (const child of node.children) {
    if (matchesFilter(child, filter)) return true
    if (child.isDirectory && hasMatchingDescendant(child, filter)) return true
  }
  return false
}

// Flatten tree into a list for virtual scrolling
function flattenTree(
  nodes: FileTreeNode[],
  expandedPaths: Set<string>,
  filter: string,
  depth: number = 0
): FlatNode[] {
  const result: FlatNode[] = []
  const isFiltered = filter.length > 0

  for (const node of nodes) {
    // Filter check
    if (
      isFiltered &&
      !matchesFilter(node, filter) &&
      !(node.isDirectory && hasMatchingDescendant(node, filter))
    ) {
      continue
    }

    const isExpanded = expandedPaths.has(node.path)
    result.push({ node, depth, isExpanded })

    // Include children if expanded or filtered with matching descendants
    const showChildren =
      node.isDirectory &&
      node.children &&
      (isExpanded || (isFiltered && hasMatchingDescendant(node, filter)))

    if (showChildren && node.children) {
      result.push(...flattenTree(node.children, expandedPaths, filter, depth + 1))
    }
  }

  return result
}

const ROW_HEIGHT = 24

export function FileTree({
  worktreePath,
  isConnectionMode,
  onClose,
  onFileClick,
  className,
  hideHeader,
  hideGitIndicators,
  hideGitContextActions
}: FileTreeProps): React.JSX.Element {
  const {
    isLoading,
    error,
    getFileTree,
    getExpandedPaths,
    getFilter,
    loadFileTree,
    toggleExpanded,
    collapseAll,
    setFilter,
    startWatching,
    stopWatching
  } = useFileTreeStore()

  const { getFileStatuses, loadFileStatuses } = useGitStore()
  const worktreesByProject = useWorktreeStore((s) => s.worktreesByProject)

  const currentWorktreeRef = useRef<string | null>(null)
  const parentRef = useRef<HTMLDivElement>(null)
  const [newFileDialogOpen, setNewFileDialogOpen] = useState(false)
  const [newFilePath, setNewFilePath] = useState('')
  const [isCreatingFile, setIsCreatingFile] = useState(false)

  // Load file tree, git statuses, and start watching when worktree changes
  useEffect(() => {
    if (!worktreePath) return

    // If switching worktrees, stop watching the previous one
    if (currentWorktreeRef.current && currentWorktreeRef.current !== worktreePath) {
      stopWatching(currentWorktreeRef.current)
    }

    currentWorktreeRef.current = worktreePath

    // Load file tree
    loadFileTree(worktreePath)

    // Load git statuses (skip for connection paths — no .git directory)
    if (!isConnectionMode) loadFileStatuses(worktreePath)

    // Start watching (store handles onChange subscription internally)
    startWatching(worktreePath)
  }, [worktreePath, isConnectionMode, loadFileTree, loadFileStatuses, startWatching, stopWatching])

  // Cleanup watching on unmount
  useEffect(() => {
    return () => {
      if (currentWorktreeRef.current) {
        stopWatching(currentWorktreeRef.current)
      }
    }
  }, [stopWatching])

  const tree = worktreePath ? getFileTree(worktreePath) : EMPTY_TREE
  const expandedPaths = worktreePath ? getExpandedPaths(worktreePath) : EMPTY_EXPANDED_PATHS
  const filter = worktreePath ? getFilter(worktreePath) : ''
  const gitStatuses = worktreePath ? getFileStatuses(worktreePath) : EMPTY_GIT_STATUSES
  const currentWorktreeId = useMemo(() => {
    if (!worktreePath) return null
    for (const worktrees of worktreesByProject.values()) {
      const match = worktrees.find((worktree) => worktree.path === worktreePath)
      if (match) return match.id
    }
    return null
  }, [worktreePath, worktreesByProject])

  // Build a Map for fast git status lookup
  const gitStatusMap = useMemo(() => {
    const map = new Map<string, GitFileStatus>()
    for (const status of gitStatuses) {
      map.set(status.relativePath, status)
    }
    return map
  }, [gitStatuses])

  // Flatten tree for virtual scrolling
  const flatNodes = useMemo(
    () => flattenTree(tree, expandedPaths, filter),
    [tree, expandedPaths, filter]
  )

  // Virtual scrolling
  const virtualizer = useVirtualizer({
    count: flatNodes.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10
  })

  const handleToggle = useCallback(
    (path: string) => {
      if (worktreePath) {
        toggleExpanded(worktreePath, path)
      }
    },
    [worktreePath, toggleExpanded]
  )

  const handleCollapseAll = useCallback(() => {
    if (worktreePath) {
      collapseAll(worktreePath)
    }
  }, [worktreePath, collapseAll])

  const handleFilterChange = useCallback(
    (value: string) => {
      if (worktreePath) {
        setFilter(worktreePath, value)
      }
    },
    [worktreePath, setFilter]
  )

  const handleRefresh = useCallback(() => {
    if (worktreePath) {
      loadFileTree(worktreePath)
      if (!isConnectionMode) loadFileStatuses(worktreePath)
    }
  }, [worktreePath, isConnectionMode, loadFileTree, loadFileStatuses])

  const handleOpenNewFileDialog = useCallback((initialPath: string = '') => {
    setNewFilePath(initialPath)
    setNewFileDialogOpen(true)
  }, [])

  const handleCreateFile = useCallback(async (): Promise<void> => {
    if (!worktreePath || isCreatingFile) return

    const trimmedPath = newFilePath.trim()
    if (!trimmedPath) {
      toast.error('Enter a file path')
      return
    }

    setIsCreatingFile(true)
    try {
      const result = await window.fileOps.createFile(worktreePath, trimmedPath)
      if (!result.success || !result.filePath) {
        toast.error(result.error || 'Failed to create file')
        return
      }

      await loadFileTree(worktreePath)
      if (!isConnectionMode) loadFileStatuses(worktreePath)

      const parentPath = trimmedPath.replace(/\\/g, '/').split('/').slice(0, -1).join('/')
      if (parentPath) {
        const separator = worktreePath.includes('\\') ? '\\' : '/'
        const nextExpandedPaths = new Set(expandedPaths)
        const parentSegments = parentPath.split('/')
        for (let index = 1; index <= parentSegments.length; index++) {
          nextExpandedPaths.add(
            `${worktreePath}${separator}${parentSegments.slice(0, index).join(separator)}`
          )
        }
        useFileTreeStore.getState().setExpanded(worktreePath, nextExpandedPaths)
      }

      const fileName = trimmedPath.replace(/\\/g, '/').split('/').pop() || trimmedPath
      if (currentWorktreeId) {
        useFileViewerStore.getState().openFile(result.filePath, fileName, currentWorktreeId)
      }

      toast.success(`Created ${fileName}`)
      setNewFileDialogOpen(false)
      setNewFilePath('')
    } finally {
      setIsCreatingFile(false)
    }
  }, [
    worktreePath,
    isCreatingFile,
    newFilePath,
    loadFileTree,
    isConnectionMode,
    loadFileStatuses,
    expandedPaths,
    currentWorktreeId
  ])

  const createFileDialog = (
    <AlertDialog open={newFileDialogOpen} onOpenChange={setNewFileDialogOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>New file</AlertDialogTitle>
          <AlertDialogDescription>
            Enter a relative path. Folders in the path will be created automatically.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            void handleCreateFile()
          }}
        >
          <Input
            autoFocus
            value={newFilePath}
            onChange={(event) => setNewFilePath(event.target.value)}
            placeholder="src/example.ts"
            disabled={isCreatingFile}
            data-testid="new-file-path-input"
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isCreatingFile}>Cancel</AlertDialogCancel>
            <Button type="submit" disabled={!newFilePath.trim() || isCreatingFile}>
              {isCreatingFile ? 'Creating...' : 'Create'}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )

  const fileTreeContextMenu = worktreePath ? (
    <ContextMenuContent className="w-44">
      <ContextMenuItem onClick={() => handleOpenNewFileDialog()}>
        <FilePlus className="mr-2 h-4 w-4" />
        New File
      </ContextMenuItem>
    </ContextMenuContent>
  ) : null

  const headerElement = !hideHeader ? (
    <FileTreeHeader
      filter={filter}
      isLoading={isLoading}
      onFilterChange={handleFilterChange}
      onCreateFile={worktreePath ? handleOpenNewFileDialog : undefined}
      onRefresh={handleRefresh}
      onCollapseAll={handleCollapseAll}
      onClose={onClose}
    />
  ) : (
    <div className="p-2 border-b">
      <FileTreeFilter value={filter} onChange={handleFilterChange} />
    </div>
  )

  // No worktree selected
  if (!worktreePath) {
    return (
      <div className={cn('flex flex-col h-full', className)}>
        {!hideHeader ? (
          <FileTreeHeader
            filter=""
            isLoading={false}
            onFilterChange={() => {}}
            onRefresh={() => {}}
            onCollapseAll={() => {}}
            onClose={onClose}
          />
        ) : (
          <div className="p-2 border-b">
            <FileTreeFilter value="" onChange={() => {}} />
          </div>
        )}
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center text-muted-foreground">
            <FolderOpen className="h-10 w-10 mx-auto mb-3 opacity-50" />
            <p className="text-sm">Select a worktree</p>
            <p className="text-xs mt-1 opacity-75">to view its files</p>
          </div>
        </div>
        {createFileDialog}
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className={cn('flex flex-col h-full', className)}>
        {headerElement}
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center text-destructive">
            <p className="text-sm font-medium">Error loading files</p>
            <p className="text-xs mt-1 opacity-75">{error}</p>
          </div>
        </div>
        {createFileDialog}
      </div>
    )
  }

  // Loading state
  if (isLoading && tree.length === 0) {
    return (
      <div className={cn('flex flex-col h-full', className)}>
        {headerElement}
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center text-muted-foreground">
            <div
              className="h-6 w-6 mx-auto mb-3 border-2 border-current border-t-transparent rounded-full animate-spin"
              aria-label="Loading files"
            />
            <p className="text-sm">Loading files...</p>
          </div>
        </div>
        {createFileDialog}
      </div>
    )
  }

  // Empty state
  if (tree.length === 0) {
    return (
      <div className={cn('flex flex-col h-full', className)}>
        {headerElement}
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center text-muted-foreground">
            <FolderOpen className="h-10 w-10 mx-auto mb-3 opacity-50" />
            <p className="text-sm">No files found</p>
          </div>
        </div>
        {createFileDialog}
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className={cn('flex flex-col h-full', className)}>
        <FileTreeHeader
          filter={filter}
          isLoading={isLoading}
          onFilterChange={handleFilterChange}
          onCreateFile={worktreePath ? handleOpenNewFileDialog : undefined}
          onRefresh={handleRefresh}
          onCollapseAll={handleCollapseAll}
          onClose={onClose}
        />
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center text-destructive">
            <p className="text-sm font-medium">Error loading files</p>
            <p className="text-xs mt-1 opacity-75">{error}</p>
          </div>
        </div>
        {createFileDialog}
      </div>
    )
  }

  // Loading state
  if (isLoading && tree.length === 0) {
    return (
      <div className={cn('flex flex-col h-full', className)}>
        <FileTreeHeader
          filter={filter}
          isLoading={isLoading}
          onFilterChange={handleFilterChange}
          onCreateFile={worktreePath ? handleOpenNewFileDialog : undefined}
          onRefresh={handleRefresh}
          onCollapseAll={handleCollapseAll}
          onClose={onClose}
        />
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center text-muted-foreground">
            <div
              className="h-6 w-6 mx-auto mb-3 border-2 border-current border-t-transparent rounded-full animate-spin"
              aria-label="Loading files"
            />
            <p className="text-sm">Loading files...</p>
          </div>
        </div>
        {createFileDialog}
      </div>
    )
  }

  // Empty state
  if (tree.length === 0) {
    return (
      <div className={cn('flex flex-col h-full', className)}>
        <FileTreeHeader
          filter={filter}
          isLoading={isLoading}
          onFilterChange={handleFilterChange}
          onCreateFile={worktreePath ? handleOpenNewFileDialog : undefined}
          onRefresh={handleRefresh}
          onCollapseAll={handleCollapseAll}
          onClose={onClose}
        />
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center text-muted-foreground">
            <FolderOpen className="h-10 w-10 mx-auto mb-3 opacity-50" />
            <p className="text-sm">No files found</p>
          </div>
        </div>
        {createFileDialog}
      </div>
    )
  }

  const isFiltered = filter.length > 0

  return (
    <div className={cn('flex flex-col h-full', className)} data-testid="file-tree">
      {headerElement}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={parentRef}
            className="flex-1 overflow-auto py-1"
            role="tree"
            aria-label="File tree"
            data-testid="file-tree-content"
          >
            <div
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                width: '100%',
                position: 'relative'
              }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const { node, depth, isExpanded } = flatNodes[virtualRow.index]
                return (
                  <div
                    key={node.path}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`
                    }}
                  >
                    <VirtualFileTreeNode
                      node={node}
                      depth={depth}
                      isExpanded={isExpanded}
                      isFiltered={isFiltered}
                      filter={filter}
                      onToggle={handleToggle}
                      onFileClick={onFileClick}
                      onCreateFile={handleOpenNewFileDialog}
                      worktreePath={worktreePath}
                      gitStatusMap={gitStatusMap}
                      hideGitIndicators={hideGitIndicators}
                      hideGitContextActions={hideGitContextActions}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        </ContextMenuTrigger>
        {fileTreeContextMenu}
      </ContextMenu>
      {createFileDialog}
    </div>
  )
}
