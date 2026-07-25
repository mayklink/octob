import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Code,
  Copy,
  ExternalLink,
  Folder,
  GitBranch,
  GitCommitHorizontal,
  Link,
  Loader2,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Settings2,
  Terminal,
  Trash2
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { KanbanBoard } from '@/components/kanban/KanbanBoard'
import { LanguageIcon } from './LanguageIcon'
import { GitInitDialog } from './GitInitDialog'
import { BranchPickerDialog } from '@/components/worktrees'
import { ManageConnectionWorktreesDialog } from '@/components/connections/ManageConnectionWorktreesDialog'
import {
  useConnectionStore,
  useKanbanStore,
  useLayoutStore,
  usePinnedStore,
  useProjectStore,
  useSessionStore,
  useWorktreeStatusStore,
  useWorktreeStore
} from '@/stores'
import { useGitStore } from '@/stores/useGitStore'
import { cn, parseColorQuad } from '@/lib/utils'
import { clipboardToast, gitToast, projectToast, toast } from '@/lib/toast'
import { formatRelativeTime } from '@/lib/format-utils'
import { OctobMark } from '@/components/brand/OctoBMark'

interface Project {
  id: string
  name: string
  path: string
  description: string | null
  tags: string | null
  language: string | null
  custom_icon: string | null
  detected_icon: string | null
  setup_script: string | null
  run_script: string | null
  archive_script: string | null
  auto_assign_port: boolean
  sort_order: number
  created_at: string
  last_accessed_at: string
}

interface Worktree {
  id: string
  project_id: string
  name: string
  branch_name: string
  path: string
  status: 'active' | 'archived'
  is_default: boolean
  last_message_at: number | null
  created_at: string
  last_accessed_at: string
  attachments: string
}

interface ConnectionMemberEnriched {
  id: string
  connection_id: string
  worktree_id: string
  project_id: string
  symlink_name: string
  added_at: string
  worktree_name: string
  worktree_branch: string
  worktree_path: string
  project_name: string
}

interface Connection {
  id: string
  name: string
  custom_name: string | null
  status: 'active' | 'archived'
  path: string
  color: string | null
  created_at: string
  updated_at: string
  members: ConnectionMemberEnriched[]
}

const EMPTY_WORKTREES: Worktree[] = []
const EMPTY_CONNECTIONS: Connection[] = []

function shortPath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length <= 4) return normalized
  return `.../${parts.slice(-4).join('/')}`
}

function projectLanguageLabel(project: Pick<Project, 'language' | 'detected_icon'>): string {
  const raw = (project.language || project.detected_icon || '').trim().toLowerCase()
  const known: Record<string, string> = {
    js: 'JavaScript',
    javascript: 'JavaScript',
    jsx: 'JavaScript',
    ts: 'TypeScript',
    typescript: 'TypeScript',
    tsx: 'TypeScript',
    py: 'Python',
    python: 'Python',
    go: 'Go',
    golang: 'Go',
    rs: 'Rust',
    rust: 'Rust',
    java: 'Java',
    kt: 'Kotlin',
    kotlin: 'Kotlin',
    php: 'PHP',
    rb: 'Ruby',
    ruby: 'Ruby',
    cs: 'C#',
    csharp: 'C#',
    cpp: 'C++',
    'c++': 'C++',
    c: 'C',
    swift: 'Swift',
    dart: 'Dart',
    lua: 'Lua',
    shell: 'Shell',
    bash: 'Shell',
    powershell: 'PowerShell'
  }

  if (!raw) return 'Other'
  if (known[raw]) return known[raw]

  return raw
    .replace(/[-_]/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function statusCountsFor(worktreeIds: string[]) {
  const statusStore = useWorktreeStatusStore.getState()
  return worktreeIds.reduce(
    (acc, id) => {
      const status = statusStore.getWorktreeStatus(id)
      if (status === 'working' || status === 'planning') acc.active += 1
      if (status === 'answering' || status === 'permission' || status === 'command_approval') {
        acc.needsAttention += 1
      }
      if (status === 'completed' || status === 'unread') acc.ready += 1
      return acc
    },
    { active: 0, needsAttention: 0, ready: 0 }
  )
}

function MetricPill({
  tone,
  icon,
  value,
  title
}: {
  tone: 'blue' | 'red' | 'cyan' | 'amber'
  icon: React.ReactNode
  value: number
  title: string
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex h-6 min-w-11 items-center justify-center gap-1 rounded-md border px-2 text-[11px] font-semibold tabular-nums',
        tone === 'blue' && 'border-blue-500/25 bg-blue-500/10 text-blue-300',
        tone === 'red' && 'border-red-500/25 bg-red-500/10 text-red-300',
        tone === 'cyan' && 'border-cyan-500/25 bg-cyan-500/10 text-cyan-300',
        tone === 'amber' && 'border-amber-500/25 bg-amber-500/10 text-amber-300'
      )}
    >
      {icon}
      {value}
    </span>
  )
}

function ProjectCard({ project }: { project: Project }) {
  const worktrees = useWorktreeStore((s) => s.worktreesByProject.get(project.id) ?? EMPTY_WORKTREES)
  const selectProject = useProjectStore((s) => s.selectProject)
  const selectWorktree = useWorktreeStore((s) => s.selectWorktree)
  const openProjectSettings = useProjectStore((s) => s.openProjectSettings)
  const removeProject = useProjectStore((s) => s.removeProject)
  const refreshLanguage = useProjectStore((s) => s.refreshLanguage)
  const { createWorktree, creatingForProjectId, syncWorktrees } = useWorktreeStore()
  const [branchPickerOpen, setBranchPickerOpen] = useState(false)
  const creating = creatingForProjectId === project.id
  const counts = statusCountsFor(worktrees.map((w) => w.id))
  const defaultWorktree = worktrees.find((w) => w.is_default) ?? worktrees[0]
  const languageLabel = projectLanguageLabel(project)

  const openProject = useCallback(() => {
    useConnectionStore.getState().selectConnection(null)
    useLayoutStore.getState().setWorkspaceView('project')
    useLayoutStore.getState().setWorkspaceContentView('overview')
    selectProject(project.id)
    selectWorktree(null)
    useKanbanStore.setState({ isBoardViewActive: false })
  }, [project.id, selectProject, selectWorktree])

  const createDefaultWorktree = useCallback(async () => {
    if (creating) return
    const hasCommits = await window.worktreeOps.hasCommits(project.path)
    if (!hasCommits) {
      toast.warning('Create an initial commit before adding worktrees.')
      return
    }
    const loadingToastId = toast.loading('Creating worktree...')
    try {
      const result = await createWorktree(project.id, project.path, project.name)
      toast.dismiss(loadingToastId)
      if (result.success) {
        gitToast.worktreeCreated(project.name)
        openProject()
      } else {
        gitToast.operationFailed('create worktree', result.error)
      }
    } catch (error) {
      toast.dismiss(loadingToastId)
      gitToast.operationFailed(
        'create worktree',
        error instanceof Error ? error.message : 'Unknown error'
      )
    }
  }, [createWorktree, creating, openProject, project])

  const handleBranchSelect = useCallback(
    async (branchName: string, prNumber?: number) => {
      setBranchPickerOpen(false)
      const loadingToastId = toast.loading('Creating worktree...')
      try {
        const result = await window.worktreeOps.createFromBranch(
          project.id,
          project.path,
          project.name,
          branchName,
          prNumber
        )
        toast.dismiss(loadingToastId)
        if (result.success && result.worktree) {
          await useWorktreeStore.getState().loadWorktrees(project.id)
          useWorktreeStore.getState().selectWorktree(result.worktree.id)
          openProject()
          gitToast.worktreeCreated(branchName)
        } else {
          gitToast.operationFailed('create worktree from branch', result.error)
        }
      } catch (error) {
        toast.dismiss(loadingToastId)
        gitToast.operationFailed(
          'create worktree from branch',
          error instanceof Error ? error.message : 'Unknown error'
        )
      }
    },
    [openProject, project]
  )

  return (
    <article
      className="group overflow-hidden rounded-lg border border-border/70 bg-card/80 shadow-[0_12px_28px_rgba(0,0,0,0.18)] transition-colors hover:border-blue-400/60"
      data-testid={`project-dashboard-card-${project.id}`}
    >
      <button type="button" className="w-full text-left" onClick={openProject}>
        <div className="flex items-center justify-between border-b border-border/60 bg-violet-500/10 px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2 text-xs font-semibold text-violet-300">
            <LanguageIcon
              language={project.language}
              customIcon={project.custom_icon}
              detectedIcon={project.detected_icon}
            />
            <span className="truncate">{languageLabel}</span>
          </div>
          {worktrees.length > 1 && (
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
              {worktrees.length} live
            </span>
          )}
        </div>
        <div className="space-y-3 p-4">
          <div>
            <h3 className="truncate text-base font-bold text-foreground">{project.name}</h3>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{shortPath(project.path)}</p>
            <p className="mt-3 line-clamp-2 min-h-9 text-sm text-muted-foreground">
              {project.description || 'Project workspace'}
            </p>
          </div>
          <div className="rounded-md border border-border/60 bg-background/45 p-2">
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <GitBranch className="h-3.5 w-3.5" />
              <span className="truncate">{defaultWorktree?.name ?? 'No worktrees yet'}</span>
              {defaultWorktree?.branch_name && (
                <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-violet-200">
                  {defaultWorktree.branch_name}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <MetricPill tone="blue" icon={<Loader2 className="h-3 w-3" />} value={counts.active} title="Active sessions" />
            <MetricPill tone="red" icon={<span className="h-2 w-2 rounded-full bg-current" />} value={counts.needsAttention} title="Needs attention" />
            <MetricPill tone="cyan" icon={<GitCommitHorizontal className="h-3 w-3" />} value={worktrees.length} title="Worktrees" />
            <MetricPill tone="amber" icon={<Folder className="h-3 w-3" />} value={counts.ready} title="Ready worktrees" />
          </div>
        </div>
      </button>
      <div className="grid grid-cols-5 gap-2 border-t border-border/60 px-4 py-2.5">
        <Button variant="outline" size="icon" className="h-8 w-full" title="Show in folder" onClick={() => window.projectOps.showInFolder(project.path)}>
          <Folder className="h-3.5 w-3.5" />
        </Button>
        <Button variant="outline" size="icon" className="h-8 w-full" title="Open terminal" onClick={() => defaultWorktree && window.worktreeOps.openInTerminal(defaultWorktree.path)}>
          <Terminal className="h-3.5 w-3.5" />
        </Button>
        <Button variant="outline" size="icon" className="h-8 w-full" title="New worktree" disabled={creating} onClick={createDefaultWorktree}>
          {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
        </Button>
        <Button variant="outline" size="icon" className="h-8 w-full" title="Refresh" onClick={() => syncWorktrees(project.id, project.path)}>
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" className="h-8 w-full" title="More">
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={() => setBranchPickerOpen(true)}>
              <GitBranch className="h-4 w-4 mr-2" />
              New Worktree From...
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => window.projectOps.copyToClipboard(project.path).then(() => clipboardToast.copied('Path'))}>
              <Copy className="h-4 w-4 mr-2" />
              Copy Path
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => refreshLanguage(project.id)}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh Language
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openProjectSettings(project.id)}>
              <Settings className="h-4 w-4 mr-2" />
              Project Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={async () => {
                if (await removeProject(project.id)) toast.success('Project removed from Octob')
              }}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Remove from Octob
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <BranchPickerDialog
        open={branchPickerOpen}
        onOpenChange={setBranchPickerOpen}
        projectPath={project.path}
        onSelect={handleBranchSelect}
      />
    </article>
  )
}

function ConnectionCard({
  connection,
  onManage
}: {
  connection: Connection
  onManage: (connectionId: string) => void
}) {
  const selectedConnectionId = useConnectionStore((s) => s.selectedConnectionId)
  const selectConnection = useConnectionStore((s) => s.selectConnection)
  const deleteConnection = useConnectionStore((s) => s.deleteConnection)
  const renameConnection = useConnectionStore((s) => s.renameConnection)
  const isPinned = usePinnedStore((s) => s.pinnedConnectionIds.has(connection.id))
  const pinConnection = usePinnedStore((s) => s.pinConnection)
  const unpinConnection = usePinnedStore((s) => s.unpinConnection)
  const connectionStatus = useWorktreeStatusStore((s) => s.getConnectionStatus(connection.id))
  const [isRenaming, setIsRenaming] = useState(false)
  const [nameInput, setNameInput] = useState(connection.custom_name || '')

  const projectNames = useMemo(
    () => [...new Set(connection.members?.map((member) => member.project_name) || [])],
    [connection.members]
  )
  const displayName = connection.custom_name || projectNames.join(' + ') || connection.name || 'Connection'
  const isSelected = selectedConnectionId === connection.id
  const statusTone =
    connectionStatus === 'working' || connectionStatus === 'planning'
      ? 'text-blue-300'
      : connectionStatus === 'answering' ||
          connectionStatus === 'permission' ||
          connectionStatus === 'command_approval'
        ? 'text-amber-300'
        : 'text-emerald-300'
  const statusLabel =
    connectionStatus === 'working'
      ? 'Working'
      : connectionStatus === 'planning'
        ? 'Planning'
        : connectionStatus === 'answering'
          ? 'Answer questions'
          : connectionStatus === 'permission'
            ? 'Permission'
            : connectionStatus === 'command_approval'
              ? 'Approve command'
              : 'Ready'

  const openConnection = useCallback(() => {
    selectConnection(connection.id)
    useLayoutStore.getState().setWorkspaceView('connection')
    useLayoutStore.getState().setWorkspaceContentView('overview')
    useProjectStore.getState().selectProject(null)
    useWorktreeStore.getState().selectWorktree(null)
    useSessionStore.getState().setActiveSession(null)
    useKanbanStore.setState({ isBoardViewActive: true, isPinnedBoardActive: false })
  }, [connection.id, selectConnection])

  const handleSaveRename = useCallback(async () => {
    const trimmed = nameInput.trim()
    await renameConnection(connection.id, trimmed || null)
    setIsRenaming(false)
  }, [connection.id, nameInput, renameConnection])

  const handleTogglePin = useCallback(async () => {
    if (isPinned) {
      await unpinConnection(connection.id)
    } else {
      await pinConnection(connection.id)
    }
  }, [connection.id, isPinned, pinConnection, unpinConnection])

  return (
    <article
      className={cn(
        'group overflow-hidden rounded-lg border bg-card/80 shadow-[0_12px_28px_rgba(0,0,0,0.18)] transition-colors hover:border-cyan-400/60',
        isSelected ? 'border-cyan-400/70' : 'border-border/70'
      )}
      data-testid={`connection-dashboard-card-${connection.id}`}
    >
      <button type="button" className="w-full text-left" onClick={openConnection}>
        <div className="flex items-center justify-between border-b border-border/60 bg-cyan-500/10 px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2 text-xs font-semibold text-cyan-300">
            {connection.color ? (
              <span
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: parseColorQuad(connection.color)[1] }}
              />
            ) : (
              <Link className="h-3.5 w-3.5" />
            )}
            <span>Connection</span>
            <span className="text-cyan-300/60">{connection.members.length} worktrees</span>
          </div>
          {isPinned && (
            <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[11px] font-semibold text-blue-300">
              Pinned
            </span>
          )}
        </div>
        <div className="space-y-3 p-4">
          <div>
            {isRenaming ? (
              <input
                autoFocus
                value={nameInput}
                onChange={(event) => setNameInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void handleSaveRename()
                  if (event.key === 'Escape') setIsRenaming(false)
                }}
                onClick={(event) => event.stopPropagation()}
                onBlur={() => setIsRenaming(false)}
                className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm font-semibold outline-none focus:ring-1 focus:ring-ring"
                placeholder={projectNames.join(' + ') || connection.name}
              />
            ) : (
              <h3 className="truncate text-base font-bold text-foreground">{displayName}</h3>
            )}
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{shortPath(connection.path)}</p>
            <p className="mt-3 line-clamp-2 min-h-9 text-sm text-muted-foreground">
              {projectNames.length > 0 ? projectNames.join(' + ') : 'Connected worktrees'}
            </p>
          </div>
          <div className="rounded-md border border-border/60 bg-background/45 p-2">
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Link className="h-3.5 w-3.5" />
              <span className={cn('font-semibold', statusTone)}>{statusLabel}</span>
              <span className="truncate">
                {connection.members.map((member) => member.worktree_branch).filter(Boolean).join(' / ')}
              </span>
            </div>
          </div>
        </div>
      </button>
      <div className="grid grid-cols-5 gap-2 border-t border-border/60 px-4 py-2.5">
        <Button variant="outline" size="icon" className="h-8 w-full" title="Open terminal" onClick={() => window.connectionOps.openInTerminal(connection.path)}>
          <Terminal className="h-3.5 w-3.5" />
        </Button>
        <Button variant="outline" size="icon" className="h-8 w-full" title="Open editor" onClick={() => window.connectionOps.openInEditor(connection.path)}>
          <Code className="h-3.5 w-3.5" />
        </Button>
        <Button variant="outline" size="icon" className="h-8 w-full" title="Manage worktrees" onClick={() => onManage(connection.id)}>
          <Settings2 className="h-3.5 w-3.5" />
        </Button>
        <Button variant="outline" size="icon" className="h-8 w-full" title={isPinned ? 'Unpin' : 'Pin'} onClick={handleTogglePin}>
          {isPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" className="h-8 w-full" title="More">
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={() => onManage(connection.id)}>
              <Settings2 className="h-4 w-4 mr-2" />
              Connection Worktrees
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                setNameInput(connection.custom_name || '')
                setIsRenaming(true)
              }}
            >
              <Pencil className="h-4 w-4 mr-2" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => window.projectOps.copyToClipboard(connection.path).then(() => clipboardToast.copied('Path'))}>
              <Copy className="h-4 w-4 mr-2" />
              Copy Path
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => deleteConnection(connection.id)}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </article>
  )
}

function WorktreeCard({ worktree, project }: { worktree: Worktree; project: Project }) {
  const selectWorktree = useWorktreeStore((s) => s.selectWorktree)
  const selectedWorktreeId = useWorktreeStore((s) => s.selectedWorktreeId)
  const selectProject = useProjectStore((s) => s.selectProject)
  const branchInfo = useGitStore((s) => s.branchInfoByWorktree.get(worktree.path))
  const status = useWorktreeStatusStore((s) => s.getWorktreeStatus(worktree.id))
  const lastMessage = useWorktreeStatusStore((s) => s.lastMessageTimeByWorktree[worktree.id] ?? null)
  const displayName = branchInfo?.name ?? worktree.name
  const languageLabel = projectLanguageLabel(project)
  const isSelected = selectedWorktreeId === worktree.id

  const openWorktree = useCallback(() => {
    useLayoutStore.getState().setWorkspaceView('project')
    useLayoutStore.getState().setWorkspaceContentView('overview')
    useConnectionStore.getState().selectConnection(null)
    selectProject(project.id)
    selectWorktree(worktree.id)
    useSessionStore.getState().setActiveSession(null)
  }, [project.id, selectProject, selectWorktree, worktree.id])

  return (
    <article
      className={cn(
        'rounded-lg border bg-card/75 p-4 shadow-[0_10px_24px_rgba(0,0,0,0.16)] transition-colors hover:border-blue-400/60',
        isSelected || status === 'unread' ? 'border-blue-400/70' : 'border-border/70'
      )}
      data-testid={`project-worktree-card-${worktree.id}`}
    >
      <button type="button" className="w-full text-left" onClick={openWorktree}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 text-xs font-semibold text-violet-300">
            <GitBranch className="h-3.5 w-3.5" />
            <span className="truncate">{languageLabel}</span>
          </div>
          {worktree.is_default && (
            <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[11px] font-semibold text-blue-300">
              Current
            </span>
          )}
        </div>
        <h3 className="truncate text-base font-bold">{displayName}</h3>
        <p className="mt-1 truncate text-xs text-muted-foreground">{shortPath(worktree.path)}</p>
        <p className="mt-3 line-clamp-2 min-h-9 text-sm text-muted-foreground">
          {worktree.is_default ? 'Main development worktree' : 'Feature worktree'}
        </p>
        <div className="mt-3 inline-flex max-w-full items-center gap-1 rounded-md border border-border/70 bg-background/45 px-2 py-1 text-[11px] text-muted-foreground">
          <GitBranch className="h-3 w-3" />
          <span className="truncate">{worktree.branch_name || 'detached'}</span>
        </div>
      </button>
      <div className="mt-4 flex items-center gap-2">
        <MetricPill tone="blue" icon={<Loader2 className="h-3 w-3" />} value={status === 'working' || status === 'planning' ? 1 : 0} title="Active" />
        <MetricPill tone="red" icon={<span className="h-2 w-2 rounded-full bg-current" />} value={status === 'answering' || status === 'permission' ? 1 : 0} title="Needs attention" />
        <MetricPill tone="cyan" icon={<GitCommitHorizontal className="h-3 w-3" />} value={status === 'completed' || status === 'unread' ? 1 : 0} title="Ready" />
        <span className="ml-auto text-[11px] text-muted-foreground">
          {lastMessage ? formatRelativeTime(lastMessage) : 'Idle'}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2">
        <Button variant="outline" size="icon" className="h-8 w-full" title="Open terminal" onClick={() => window.worktreeOps.openInTerminal(worktree.path)}>
          <Terminal className="h-3.5 w-3.5" />
        </Button>
        <Button variant="outline" size="icon" className="h-8 w-full" title="Open editor" onClick={() => window.worktreeOps.openInEditor(worktree.path)}>
          <Code className="h-3.5 w-3.5" />
        </Button>
        <Button variant="outline" size="icon" className="h-8 w-full" title="Show in folder" onClick={() => window.projectOps.showInFolder(worktree.path)}>
          <ExternalLink className="h-3.5 w-3.5" />
        </Button>
        <Button variant="outline" size="icon" className="h-8 w-full" title="Copy path" onClick={() => window.projectOps.copyToClipboard(worktree.path).then(() => clipboardToast.copied('Path'))}>
          <Copy className="h-3.5 w-3.5" />
        </Button>
      </div>
    </article>
  )
}

export function ProjectDashboard(): React.JSX.Element {
  const projects = useProjectStore((s) => s.projects)
  const connections = useConnectionStore((s) => s.connections ?? EMPTY_CONNECTIONS)
  const loadConnections = useConnectionStore((s) => s.loadConnections)
  const connectionModeActive = useConnectionStore((s) => s.connectionModeActive)
  const selectedConnection = useConnectionStore((s) =>
    s.selectedConnectionId ? s.connections.find((connection) => connection.id === s.selectedConnectionId) ?? null : null
  )
  const workspaceView = useLayoutStore((s) => s.workspaceView)
  const selectedProjectId = useProjectStore((s) => s.selectedProjectId)
  const selectedProject = useProjectStore((s) =>
    s.selectedProjectId ? s.projects.find((p) => p.id === s.selectedProjectId) ?? null : null
  )
  const loadProjects = useProjectStore((s) => s.loadProjects)
  const worktreesByProject = useWorktreeStore((s) => s.worktreesByProject)
  const worktrees = useWorktreeStore((s) =>
    selectedProjectId ? s.worktreesByProject.get(selectedProjectId) ?? EMPTY_WORKTREES : EMPTY_WORKTREES
  )
  const syncWorktrees = useWorktreeStore((s) => s.syncWorktrees)
  const createWorktree = useWorktreeStore((s) => s.createWorktree)
  const creatingForProjectId = useWorktreeStore((s) => s.creatingForProjectId)
  const [query, setQuery] = useState('')
  const [isAddingProject, setIsAddingProject] = useState(false)
  const [gitInitPath, setGitInitPath] = useState<string | null>(null)
  const [manageConnectionId, setManageConnectionId] = useState<string | null>(null)

  useEffect(() => {
    if (projects.length === 0) void loadProjects()
  }, [loadProjects, projects.length])

  useEffect(() => {
    void loadConnections()
  }, [loadConnections])

  useEffect(() => {
    if (selectedProject) void syncWorktrees(selectedProject.id, selectedProject.path)
  }, [selectedProject, syncWorktrees])

  const filteredProjects = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return projects
    return projects.filter((project) =>
      `${project.name} ${project.path} ${project.description ?? ''} ${projectLanguageLabel(project)}`
        .toLowerCase()
        .includes(q)
    )
  }, [projects, query])

  const projectGroups = useMemo(() => {
    const groups = new Map<string, { label: string; projects: Project[] }>()

    for (const project of filteredProjects) {
      const label = projectLanguageLabel(project)
      const key = label.toLowerCase()
      const group = groups.get(key)

      if (group) {
        group.projects.push(project)
      } else {
        groups.set(key, { label, projects: [project] })
      }
    }

    return [...groups.values()].sort((a, b) => {
      if (a.label === 'Other') return 1
      if (b.label === 'Other') return -1
      return a.label.localeCompare(b.label)
    })
  }, [filteredProjects])

  const handleCreateSelectedWorktree = useCallback(async () => {
    if (!selectedProject || creatingForProjectId === selectedProject.id) return
    const hasCommits = await window.worktreeOps.hasCommits(selectedProject.path)
    if (!hasCommits) {
      toast.warning('Create an initial commit before adding worktrees.')
      return
    }
    const loadingToastId = toast.loading('Creating worktree...')
    try {
      const result = await createWorktree(selectedProject.id, selectedProject.path, selectedProject.name)
      toast.dismiss(loadingToastId)
      if (result.success) {
        gitToast.worktreeCreated(selectedProject.name)
      } else {
        gitToast.operationFailed('create worktree', result.error)
      }
    } catch (error) {
      toast.dismiss(loadingToastId)
      gitToast.operationFailed(
        'create worktree',
        error instanceof Error ? error.message : 'Unknown error'
      )
    }
  }, [createWorktree, creatingForProjectId, selectedProject])

  const handleAddProject = useCallback(async (): Promise<void> => {
    if (isAddingProject) return

    setIsAddingProject(true)
    try {
      const selectedPath = await window.projectOps.openDirectoryDialog()
      if (!selectedPath) return

      const result = await useProjectStore.getState().addProject(selectedPath)
      if (result.success) {
        useLayoutStore.getState().setWorkspaceView('project')
        projectToast.added(selectedPath.split('/').pop() || selectedPath)
        return
      }

      if (result.error?.includes('not a Git repository')) {
        setGitInitPath(selectedPath)
        return
      }

      toast.error(result.error || 'Failed to add project', {
        retry: () => handleAddProject()
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to add project', {
        retry: () => handleAddProject()
      })
    } finally {
      setIsAddingProject(false)
    }
  }, [isAddingProject])

  const handleInitRepository = useCallback(async (): Promise<void> => {
    if (!gitInitPath) return

    const initResult = await window.projectOps.initRepository(gitInitPath)
    if (!initResult.success) {
      toast.error(initResult.error || 'Failed to initialize repository')
      setGitInitPath(null)
      return
    }

    toast.success('Git repository initialized')
    const addResult = await useProjectStore.getState().addProject(gitInitPath)
    if (addResult.success) {
      useLayoutStore.getState().setWorkspaceView('project')
      projectToast.added(gitInitPath.split('/').pop() || gitInitPath)
    } else {
      toast.error(addResult.error || 'Failed to add project')
    }
    setGitInitPath(null)
  }, [gitInitPath])

  if (selectedConnection && workspaceView === 'connection') {
    const displayName =
      selectedConnection.custom_name ||
      selectedConnection.members.map((member) => member.project_name).join(' + ') ||
      selectedConnection.name

    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-background">
        <section className="border-b border-border/70 px-8 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-4">
              <div
                className="flex h-12 w-12 items-center justify-center rounded-lg border border-cyan-500/25 bg-cyan-500/10"
                style={
                  selectedConnection.color
                    ? { borderColor: parseColorQuad(selectedConnection.color)[1] }
                    : undefined
                }
              >
                <Link className="h-5 w-5 text-cyan-300" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="truncate text-xl font-bold">{displayName}</h1>
                  <span className="rounded-full bg-cyan-500/15 px-2 py-0.5 text-[11px] font-semibold text-cyan-300">
                    Connection
                  </span>
                </div>
                <p className="mt-1 truncate text-sm text-muted-foreground">{selectedConnection.path}</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {selectedConnection.members.length} connected worktrees
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => window.connectionOps.openInTerminal(selectedConnection.path)}>
                <Terminal className="h-4 w-4" />
                Open in Terminal
              </Button>
              <Button variant="outline" size="icon" onClick={() => setManageConnectionId(selectedConnection.id)}>
                <Settings2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </section>

        <section className="px-8 py-5">
          <div className="mb-4">
            <h2 className="text-base font-bold">Worktrees</h2>
            <p className="text-sm text-muted-foreground">Connected worktrees in this connection</p>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
            {selectedConnection.members.map((member) => {
              const project = projects.find((item) => item.id === member.project_id)
              const worktree = (worktreesByProject.get(member.project_id) ?? EMPTY_WORKTREES).find(
                (item) => item.id === member.worktree_id
              )

              if (project && worktree) {
                return <WorktreeCard key={member.id} worktree={worktree} project={project} />
              }

              return (
                <article key={member.id} className="rounded-lg border border-border/70 bg-card/75 p-4">
                  <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-cyan-300">
                    <GitBranch className="h-3.5 w-3.5" />
                    <span className="truncate">{member.project_name}</span>
                  </div>
                  <h3 className="truncate text-base font-bold">{member.worktree_name}</h3>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{shortPath(member.worktree_path)}</p>
                  <p className="mt-3 text-sm text-muted-foreground">{member.worktree_branch}</p>
                </article>
              )
            })}
          </div>
        </section>

        <section className="mx-8 mb-8 flex min-h-[420px] flex-1 flex-col overflow-hidden rounded-lg border border-border/70 bg-card/45">
          <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
            <div>
              <h2 className="text-base font-bold">Board</h2>
              <p className="text-sm text-muted-foreground">Track work across this connection</p>
            </div>
          </div>
          <KanbanBoard connectionId={selectedConnection.id} />
        </section>

        <ManageConnectionWorktreesDialog
          connectionId={manageConnectionId}
          open={Boolean(manageConnectionId)}
          onOpenChange={(open) => {
            if (!open) setManageConnectionId(null)
          }}
        />
      </div>
    )
  }

  if (selectedProject && workspaceView === 'project') {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-background">
        <section className="border-b border-border/70 px-8 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-red-500/25 bg-red-500/10">
                <LanguageIcon
                  language={selectedProject.language}
                  customIcon={selectedProject.custom_icon}
                  detectedIcon={selectedProject.detected_icon}
                />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="truncate text-xl font-bold">{selectedProject.name}</h1>
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
                    Active
                  </span>
                </div>
                <p className="mt-1 truncate text-sm text-muted-foreground">{selectedProject.path}</p>
                {selectedProject.description && (
                  <p className="mt-2 text-sm text-muted-foreground">{selectedProject.description}</p>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => window.worktreeOps.openInTerminal(selectedProject.path)}>
                <Terminal className="h-4 w-4" />
                Open in Terminal
              </Button>
              <Button variant="outline" size="icon" onClick={() => useProjectStore.getState().openProjectSettings(selectedProject.id)}>
                <Settings className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </section>

        <section className="px-8 py-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold">Worktrees</h2>
              <p className="text-sm text-muted-foreground">Quick access to worktrees in this project</p>
            </div>
            <Button
              onClick={handleCreateSelectedWorktree}
              disabled={creatingForProjectId === selectedProject.id}
            >
              {creatingForProjectId === selectedProject.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              New Worktree
            </Button>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
            {worktrees.map((worktree) => (
              <WorktreeCard key={worktree.id} worktree={worktree} project={selectedProject} />
            ))}
          </div>
        </section>

        <section className="mx-8 mb-8 flex min-h-[420px] flex-1 flex-col overflow-hidden rounded-lg border border-border/70 bg-card/45">
          <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
            <div>
              <h2 className="text-base font-bold">Board</h2>
              <p className="text-sm text-muted-foreground">Track work and manage tasks in this project</p>
            </div>
          </div>
          <KanbanBoard projectId={selectedProject.id} projectPath={selectedProject.path} />
        </section>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-background">
      <section className="mx-auto flex w-full max-w-[1480px] flex-col gap-4 px-8 py-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-red-500/25 bg-red-500/10">
              <OctobMark className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold">Projects</h1>
                <span className="text-sm text-muted-foreground">
                  {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          </div>
          <Button
            onClick={handleAddProject}
            disabled={isAddingProject}
            data-testid="dashboard-add-project"
          >
            {isAddingProject ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Add Project
          </Button>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter projects..."
            className="h-10 pl-9"
          />
        </div>
        {!connectionModeActive && connections.length > 0 && (
          <>
            <div className="flex items-center gap-3 text-sm font-semibold text-cyan-300">
              <span>Connections</span>
              <span className="text-muted-foreground">({connections.length})</span>
              <div className="h-px flex-1 bg-border/70" />
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
              {connections.map((connection) => (
                <ConnectionCard
                  key={connection.id}
                  connection={connection}
                  onManage={setManageConnectionId}
                />
              ))}
            </div>
          </>
        )}
        {projectGroups.map((group) => (
          <section key={group.label} className="space-y-4">
            <div className="flex items-center gap-3 text-sm font-semibold text-violet-300">
              <span>{group.label} Projects</span>
              <span className="text-muted-foreground">({group.projects.length})</span>
              <div className="h-px flex-1 bg-border/70" />
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
              {group.projects.map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </div>
          </section>
        ))}
        {filteredProjects.length === 0 && (
          <div className="rounded-lg border border-dashed border-border/70 py-16 text-center text-sm text-muted-foreground">
            No matching projects
          </div>
        )}
      </section>
      <GitInitDialog
        open={!!gitInitPath}
        path={gitInitPath || ''}
        onCancel={() => setGitInitPath(null)}
        onConfirm={handleInitRepository}
      />
      {manageConnectionId && (
        <ManageConnectionWorktreesDialog
          connectionId={manageConnectionId}
          open={!!manageConnectionId}
          onOpenChange={(open) => {
            if (!open) setManageConnectionId(null)
          }}
        />
      )}
    </div>
  )
}
