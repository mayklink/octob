import * as chokidar from 'chokidar'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { createLogger } from '../main/services/logger'

const log = createLogger({ component: 'RuntimeWatchers' })

export type RuntimeWatcherEvent =
  | {
      type: 'file-tree.change'
      payload: {
        worktreePath: string
        events: Array<{
          eventType: 'add' | 'addDir' | 'change' | 'unlink' | 'unlinkDir'
          changedPath: string
          relativePath: string
        }>
      }
    }
  | { type: 'git.statusChanged'; payload: { worktreePath: string } }
  | { type: 'git.branchChanged'; payload: { worktreePath: string } }

type Listener = (event: RuntimeWatcherEvent) => void
type FileChange = {
  eventType: 'add' | 'addDir' | 'change' | 'unlink' | 'unlinkDir'
  changedPath: string
  relativePath: string
}

const IGNORE = [
  '**/node_modules/**',
  '**/build/**',
  '**/dist/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/coverage/**',
  '**/.cache/**',
  '**/tmp/**',
  '**/*.log'
]

function resolveGitDir(worktreePath: string): string | null {
  const dotGit = join(worktreePath, '.git')
  if (!existsSync(dotGit)) return null
  try {
    if (statSync(dotGit).isDirectory()) return dotGit
    const match = readFileSync(dotGit, 'utf8').trim().match(/^gitdir:\s*(.+)$/)
    if (!match) return null
    return isAbsolute(match[1]) ? match[1] : resolve(worktreePath, match[1])
  } catch {
    return null
  }
}

interface RefWatcher {
  watcher: chokidar.FSWatcher
  refs: number
}

export class RuntimeWatcherService {
  private readonly listeners = new Set<Listener>()
  private readonly fileWatchers = new Map<string, RefWatcher>()
  private readonly gitWatchers = new Map<string, RefWatcher>()
  private readonly branchWatchers = new Map<string, RefWatcher>()
  private readonly fileQueues = new Map<string, FileChange[]>()
  private readonly timers = new Map<string, NodeJS.Timeout>()

  onEvent(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(event: RuntimeWatcherEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // Watcher listeners are isolated from filesystem events.
      }
    }
  }

  private queueFileEvent(
    worktreePath: string,
    eventType: 'add' | 'addDir' | 'change' | 'unlink' | 'unlinkDir',
    changedPath: string
  ): void {
    const queue = this.fileQueues.get(worktreePath) ?? []
    queue.push({
      eventType,
      changedPath,
      relativePath: relative(worktreePath, changedPath)
    })
    this.fileQueues.set(worktreePath, queue)

    const existing = this.timers.get(`file:${worktreePath}`)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      this.timers.delete(`file:${worktreePath}`)
      const events = this.fileQueues.get(worktreePath) ?? []
      this.fileQueues.delete(worktreePath)
      if (events.length > 0) {
        this.emit({
          type: 'file-tree.change',
          payload: { worktreePath, events }
        })
      }
    }, 100)
    this.timers.set(`file:${worktreePath}`, timer)
  }

  private debounceGit(worktreePath: string): void {
    const key = `git:${worktreePath}`
    const existing = this.timers.get(key)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      this.timers.delete(key)
      this.emit({ type: 'git.statusChanged', payload: { worktreePath } })
    }, 150)
    this.timers.set(key, timer)
  }

  async watchFiles(worktreePath: string): Promise<void> {
    const existing = this.fileWatchers.get(worktreePath)
    if (existing) {
      existing.refs += 1
      return
    }

    const watcher = chokidar.watch(worktreePath, {
      ignored: [...IGNORE, '**/.git/**'],
      persistent: true,
      ignoreInitial: true,
      depth: 10,
      followSymlinks: false,
      ignorePermissionErrors: true
    })

    watcher.on('add', (path) => this.queueFileEvent(worktreePath, 'add', path))
    watcher.on('addDir', (path) => this.queueFileEvent(worktreePath, 'addDir', path))
    watcher.on('change', (path) => this.queueFileEvent(worktreePath, 'change', path))
    watcher.on('unlink', (path) => this.queueFileEvent(worktreePath, 'unlink', path))
    watcher.on('unlinkDir', (path) => this.queueFileEvent(worktreePath, 'unlinkDir', path))
    watcher.on('error', (error) => log.warn('File watcher error', {
      worktreePath,
      error: error instanceof Error ? error.message : String(error)
    }))
    this.fileWatchers.set(worktreePath, { watcher, refs: 1 })
  }

  async unwatchFiles(worktreePath: string): Promise<void> {
    await this.release(this.fileWatchers, worktreePath)
  }

  async watchGit(worktreePath: string): Promise<void> {
    const existing = this.gitWatchers.get(worktreePath)
    if (existing) {
      existing.refs += 1
      return
    }
    const watcher = chokidar.watch(worktreePath, {
      ignored: IGNORE,
      persistent: true,
      ignoreInitial: true,
      depth: 10,
      followSymlinks: false,
      ignorePermissionErrors: true
    })
    for (const event of ['add', 'addDir', 'change', 'unlink', 'unlinkDir'] as const) {
      watcher.on(event, () => this.debounceGit(worktreePath))
    }
    watcher.on('error', (error) => log.warn('Git runtime watcher error', {
      worktreePath,
      error: error instanceof Error ? error.message : String(error)
    }))
    this.gitWatchers.set(worktreePath, { watcher, refs: 1 })
  }

  async unwatchGit(worktreePath: string): Promise<void> {
    await this.release(this.gitWatchers, worktreePath)
  }

  async watchBranch(worktreePath: string): Promise<void> {
    const existing = this.branchWatchers.get(worktreePath)
    if (existing) {
      existing.refs += 1
      return
    }
    const gitDir = resolveGitDir(worktreePath)
    if (!gitDir) return
    const headPath = join(gitDir, 'HEAD')
    if (!existsSync(headPath)) return

    const watcher = chokidar.watch(headPath, {
      persistent: true,
      ignoreInitial: true
    })
    watcher.on('change', () => {
      this.emit({ type: 'git.branchChanged', payload: { worktreePath } })
    })
    watcher.on('error', (error) => log.warn('Branch runtime watcher error', {
      worktreePath,
      error: error instanceof Error ? error.message : String(error)
    }))
    this.branchWatchers.set(worktreePath, { watcher, refs: 1 })
  }

  async unwatchBranch(worktreePath: string): Promise<void> {
    await this.release(this.branchWatchers, worktreePath)
  }

  private async release(map: Map<string, RefWatcher>, worktreePath: string): Promise<void> {
    const entry = map.get(worktreePath)
    if (!entry) return
    entry.refs = Math.max(0, entry.refs - 1)
    if (entry.refs > 0) return
    map.delete(worktreePath)
    await entry.watcher.close()
  }

  async cleanup(): Promise<void> {
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    this.fileQueues.clear()

    const all = [
      ...this.fileWatchers.values(),
      ...this.gitWatchers.values(),
      ...this.branchWatchers.values()
    ]
    this.fileWatchers.clear()
    this.gitWatchers.clear()
    this.branchWatchers.clear()
    await Promise.allSettled(all.map((entry) => entry.watcher.close()))
    this.listeners.clear()
  }
}

export const runtimeWatchers = new RuntimeWatcherService()
