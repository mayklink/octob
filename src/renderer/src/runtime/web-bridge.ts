import { octobRuntime } from './runtime-client'

type AnyFn = (...args: any[]) => any

const noopSubscription = (): (() => void) => () => {}
const ok = async (): Promise<{ success: true }> => ({ success: true })
const unsupported = async (name: string): Promise<{ success: false; error: string }> => ({
  success: false,
  error: `${name} is not available in browser mode yet`
})

let browserWakeLock: { release: () => Promise<void> } | null = null

async function setBrowserKeepAwake(active: boolean): Promise<void> {
  if (!active) {
    await browserWakeLock?.release().catch(() => {})
    browserWakeLock = null
    return
  }

  const wakeLock = (navigator as Navigator & {
    wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> }
  }).wakeLock
  if (!wakeLock || browserWakeLock) return

  try {
    browserWakeLock = await wakeLock.request('screen')
  } catch {
    // Browsers can deny the lock when the tab is hidden or the API is absent.
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length))
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

function dbCall<T>(method: string, ...args: unknown[]): Promise<T> {
  return octobRuntime.dbCall<T>(method, args)
}

function scopedDbCall<T>(scope: string, method: string, ...args: unknown[]): Promise<T> {
  return octobRuntime.dbCall<T>(method, args, `db:${scope}`)
}

const fileTreeChangeListeners = new Set<AnyFn>()
const gitStatusListeners = new Set<AnyFn>()
const gitBranchListeners = new Set<AnyFn>()
let disposeWatcherStream: (() => void) | null = null

function ensureWatcherStream(): void {
  if (disposeWatcherStream) return
  disposeWatcherStream = octobRuntime.streamWatchers((event: any) => {
    if (event.type === 'file-tree.change') {
      for (const listener of fileTreeChangeListeners) listener(event.payload)
    } else if (event.type === 'git.statusChanged') {
      for (const listener of gitStatusListeners) listener(event.payload)
    } else if (event.type === 'git.branchChanged') {
      for (const listener of gitBranchListeners) listener(event.payload)
    }
  })
}

function addWatcherListener(set: Set<AnyFn>, callback: AnyFn): () => void {
  set.add(callback)
  ensureWatcherStream()
  return () => {
    set.delete(callback)
    if (
      fileTreeChangeListeners.size === 0 &&
      gitStatusListeners.size === 0 &&
      gitBranchListeners.size === 0
    ) {
      disposeWatcherStream?.()
      disposeWatcherStream = null
    }
  }
}

function watcherPost(operation: string, worktreePath: string): Promise<any> {
  return octobRuntime.api(`/v1/watchers/${operation}`, 'POST', { worktreePath })
}

function installDatabaseBridge(target: any): void {
  target.db = {
    setting: {
      get: (key: string) => dbCall('getSetting', key),
      set: async (key: string, value: string) => {
        await dbCall('setSetting', key, value)
        return true
      },
      delete: async (key: string) => {
        await dbCall('deleteSetting', key)
        return true
      },
      getAll: () => dbCall('getAllSettings')
    },
    project: {
      create: (data: unknown) => dbCall('createProject', data),
      get: (id: string) => dbCall('getProject', id),
      getByPath: (path: string) => dbCall('getProjectByPath', path),
      getAll: () => dbCall('getAllProjects'),
      update: (id: string, data: unknown) => dbCall('updateProject', id, data),
      delete: (id: string) => dbCall('deleteProject', id),
      touch: async (id: string) => {
        await dbCall('touchProject', id)
        return true
      },
      reorder: async (ids: string[]) => {
        await dbCall('reorderProjects', ids)
        return true
      },
      sortByLastMessage: () => dbCall('getProjectIdsSortedByLastMessage')
    },
    worktree: {
      create: (data: unknown) => dbCall('createWorktree', data),
      get: (id: string) => dbCall('getWorktree', id),
      getByProject: (id: string) => dbCall('getWorktreesByProject', id),
      getActiveByProject: (id: string) => dbCall('getActiveWorktreesByProject', id),
      getRecentlyActive: (cutoff: number) => dbCall('getRecentlyActiveWorktrees', cutoff),
      update: (id: string, data: unknown) => dbCall('updateWorktree', id, data),
      delete: (id: string) => dbCall('deleteWorktree', id),
      archive: (id: string) => dbCall('archiveWorktree', id),
      touch: async (id: string) => {
        await dbCall('touchWorktree', id)
        return true
      },
      appendSessionTitle: async (id: string, title: string) => {
        await dbCall('appendSessionTitle', id, title)
        return { success: true }
      },
      updateModel: async (p: any) => {
        await dbCall(
          'updateWorktreeModel',
          p.worktreeId,
          p.modelProviderId,
          p.modelId,
          p.modelVariant
        )
        return { success: true }
      },
      addAttachment: (id: string, attachment: unknown) => dbCall('addAttachment', id, attachment),
      removeAttachment: (id: string, attachmentId: string) =>
        dbCall('removeAttachment', id, attachmentId),
      attachPR: (id: string, number: number, url: string) =>
        dbCall('attachPR', id, number, url),
      detachPR: (id: string) => dbCall('detachPR', id),
      setPinned: async (id: string, pinned: boolean) => {
        await dbCall('updateWorktree', id, { pinned: pinned ? 1 : 0 })
        return { success: true }
      },
      getPinned: () => dbCall('getPinnedWorktrees')
    },
    session: {
      create: (data: unknown) => dbCall('createSession', data),
      get: (id: string) => dbCall('getSession', id),
      getByWorktree: (id: string) => dbCall('getSessionsByWorktree', id),
      getByProject: (id: string) => dbCall('getSessionsByProject', id),
      getActiveByWorktree: (id: string) =>
        scopedDbCall(`session-worktree:${id}`, 'getActiveSessionsByWorktree', id),
      update: (id: string, data: unknown) => dbCall('updateSession', id, data),
      delete: (id: string) => dbCall('deleteSession', id),
      search: (options: unknown) => dbCall('searchSessions', options),
      getDraft: (id: string) => dbCall('getSessionDraft', id),
      updateDraft: (id: string, draft: string | null) => dbCall('updateSessionDraft', id, draft),
      getByConnection: (id: string) => dbCall('getSessionsByConnection', id),
      getActiveByConnection: (id: string) => dbCall('getActiveSessionsByConnection', id)
    },
    sessionMessage: {
      list: (id: string) => dbCall('getSessionMessages', id)
    },
    sessionActivity: {
      list: (id: string) => dbCall('getSessionActivities', id)
    },
    space: {
      list: () => dbCall('listSpaces'),
      create: (data: unknown) => dbCall('createSpace', data),
      update: (id: string, data: unknown) => dbCall('updateSpace', id, data),
      delete: (id: string) => dbCall('deleteSpace', id),
      assignProject: async (projectId: string, spaceId: string) => {
        await dbCall('assignProjectToSpace', projectId, spaceId)
        return true
      },
      removeProject: async (projectId: string, spaceId: string) => {
        await dbCall('removeProjectFromSpace', projectId, spaceId)
        return true
      },
      getProjectIds: (spaceId: string) => dbCall('getProjectIdsForSpace', spaceId),
      getAllAssignments: () => dbCall('getAllProjectSpaceAssignments'),
      reorder: async (ids: string[]) => {
        await dbCall('reorderSpaces', ids)
        return true
      }
    },
    diffComment: {
      create: (data: unknown) => dbCall('createDiffComment', data),
      list: (id: string) => dbCall('getDiffCommentsByWorktree', id),
      update: (id: string, data: unknown) => dbCall('updateDiffComment', id, data),
      setOutdated: (id: string, value: boolean) =>
        dbCall('setDiffCommentOutdated', id, value),
      delete: (id: string) => dbCall('deleteDiffComment', id),
      clearAll: (id: string) => dbCall('clearAllDiffComments', id)
    },
    schemaVersion: () => dbCall('getSchemaVersion'),
    tableExists: (name: string) => dbCall('tableExists', name),
    getIndexes: () => dbCall('getIndexes'),
    cancelPending: (scope: string) => octobRuntime.cancelScope(`db:${scope}`)
  }
}

function installFileBridge(target: any): void {
  target.fileOps = {
    readFile: (path: string) => octobRuntime.readFile(path),
    writeFile: (path: string, content: string) => octobRuntime.writeFile(path, content),
    readImageAsBase64: (path: string) =>
      octobRuntime.api(`/v1/files/image?path=${encodeURIComponent(path)}`),
    createFile: (worktreePath: string, relativePath: string, content = '') =>
      octobRuntime.api('/v1/files', 'POST', { worktreePath, relativePath, content }),
    deleteFile: (worktreePath: string, filePath: string) =>
      octobRuntime.api('/v1/files', 'DELETE', { worktreePath, filePath }),
    getPathForFile: () => ''
  }
}

function gitScope(worktreePath: string): string {
  return `git:${worktreePath}`
}

function gitPost(
  path: string,
  body: Record<string, unknown>,
  scope?: string
): Promise<any> {
  return octobRuntime.api(`/v1/git/${path}`, 'POST', body, scope)
}

function gitReadPost(path: string, body: Record<string, unknown>): Promise<any> {
  const worktreePath =
    typeof body.worktreePath === 'string'
      ? body.worktreePath
      : typeof body.projectPath === 'string'
        ? body.projectPath
        : null
  return gitPost(path, body, worktreePath ? gitScope(worktreePath) : undefined)
}

function installGitBridge(target: any): void {
  target.gitOps = {
    getFileStatuses: (worktreePath: string) => gitReadPost('status', { worktreePath }),
    getBranchInfo: (worktreePath: string) => gitReadPost('branch', { worktreePath }),
    stageFile: (worktreePath: string, filePath: string) =>
      gitPost('stage', { worktreePath, filePath }),
    unstageFile: (worktreePath: string, filePath: string) =>
      gitPost('unstage', { worktreePath, filePath }),
    discardChanges: (worktreePath: string, filePath: string) =>
      gitPost('discard', { worktreePath, filePath }),
    stageAll: (worktreePath: string) => gitPost('stage-all', { worktreePath }),
    unstageAll: (worktreePath: string) => gitPost('unstage-all', { worktreePath }),
    commit: (worktreePath: string, message: string) =>
      gitPost('commit', { worktreePath, message }),
    push: (worktreePath: string, remote?: string, branch?: string) =>
      gitPost('push', { worktreePath, remote, branch }),
    pull: (worktreePath: string, remote?: string, branch?: string, rebase?: boolean) =>
      gitPost('pull', { worktreePath, remote, branch, rebase }),
    getDiffStat: (worktreePath: string) => gitReadPost('diff-stat', { worktreePath }),
    hasUncommittedChanges: async (worktreePath: string) => {
      const result = await gitReadPost('has-changes', { worktreePath })
      return result.hasChanges === true
    },
    getRemoteUrl: (worktreePath: string, remote?: string) =>
      gitReadPost('remote-url', { worktreePath, remote }),
    addToGitignore: (worktreePath: string, pattern: string) =>
      gitPost('add-gitignore', { worktreePath, pattern }),
    syncPullRequestBranch: (worktreePath: string, options: unknown) =>
      gitPost('sync-pull-request-branch', { worktreePath, options }),
    getDiff: (
      worktreePath: string,
      filePath: string,
      staged: boolean,
      isUntracked: boolean,
      contextLines?: number
    ) => gitPost('diff', { worktreePath, filePath, staged, isUntracked, contextLines }),
    listBranchesWithStatus: (projectPath: string) =>
      gitReadPost('list-branches-with-status', { projectPath }),
    checkoutBranch: (worktreePath: string, branch: string) =>
      gitPost('checkout', { worktreePath, branch }),
    merge: (worktreePath: string, sourceBranch: string) =>
      gitPost('merge', { worktreePath, branch: sourceBranch }),
    mergeAbort: (worktreePath: string) => gitPost('merge-abort', { worktreePath }),
    branchDiffShortStat: (worktreePath: string, baseBranch: string) =>
      gitReadPost('branch-diff-stat', { worktreePath, baseBranch }),
    getFileContent: (worktreePath: string, filePath: string) =>
      gitPost('file-content', { worktreePath, filePath }),
    getFileContentBase64: (worktreePath: string, filePath: string) =>
      gitPost('file-content-base64', { worktreePath, filePath }),
    getRefContent: (worktreePath: string, ref: string, filePath: string) =>
      gitPost('ref-content', { worktreePath, ref, filePath }),
    getRefContentBase64: (worktreePath: string, ref: string, filePath: string) =>
      gitPost('ref-content-base64', { worktreePath, ref, filePath }),
    stageHunk: (worktreePath: string, patch: string) =>
      gitPost('stage-hunk', { worktreePath, patch }),
    unstageHunk: (worktreePath: string, patch: string) =>
      gitPost('unstage-hunk', { worktreePath, patch }),
    revertHunk: (worktreePath: string, patch: string) =>
      gitPost('revert-hunk', { worktreePath, patch }),
    prMerge: (worktreePath: string, prNumber: number) =>
      gitPost('pr-merge', { worktreePath, prNumber }),
    isBranchMerged: (worktreePath: string, branch: string) =>
      gitPost('is-branch-merged', { worktreePath, branch }),
    deleteBranch: (worktreePath: string, branchName: string) =>
      gitPost('delete-branch', { worktreePath, branchName }),
    listPRs: (projectPath: string) => gitPost('list-prs', { projectPath }),
    getPRState: (projectPath: string, prNumber: number) =>
      gitPost('pr-state', { projectPath, prNumber }),
    getPRReviewComments: (projectPath: string, prNumber: number) =>
      gitPost('pr-review-comments', { projectPath, prNumber }),
    getRangeDiff: (worktreePath: string, baseBranch: string) =>
      gitReadPost('range-diff', { worktreePath, baseBranch }),
    needsPush: async (worktreePath: string) => {
      const result = await gitReadPost('needs-push', { worktreePath })
      return result === true
    },
    getBranchDiffFiles: (worktreePath: string, branch: string) =>
      gitPost('branch-diff-files', { worktreePath, branch }),
    getBranchBaseContent: (worktreePath: string, branch: string, filePath: string) =>
      gitPost('branch-base-content', { worktreePath, branch, filePath }),
    getBranchBaseContentBase64: (
      worktreePath: string,
      branch: string,
      filePath: string
    ) => gitPost('branch-base-content-base64', { worktreePath, branch, filePath }),
    getBranchFileDiff: (worktreePath: string, branch: string, filePath: string) =>
      gitPost('branch-file-diff', { worktreePath, branch, filePath }),
    createPR: (worktreePath: string, baseBranch: string, title: string, body: string) =>
      gitPost('create-pr', { worktreePath, baseBranch, title, body }),
    generatePRContent: (worktreePath: string, baseBranch: string, provider: string) =>
      gitPost('generate-pr-content', { worktreePath, baseBranch, provider }),
    openInEditor: (path: string) =>
      octobRuntime.api('/v1/system/open-editor', 'POST', { path }),
    showInFinder: (path: string) =>
      octobRuntime.api('/v1/system/show-in-folder', 'POST', { path }),
    watchWorktree: (path: string) => watcherPost('git/watch', path),
    unwatchWorktree: (path: string) => watcherPost('git/unwatch', path),
    watchBranch: (path: string) => watcherPost('branch/watch', path),
    unwatchBranch: (path: string) => watcherPost('branch/unwatch', path),
    cancelPending: (worktreePath: string) => octobRuntime.cancelScope(gitScope(worktreePath)),
    onStatusChanged: (callback: AnyFn) => addWatcherListener(gitStatusListeners, callback),
    onBranchChanged: (callback: AnyFn) => addWatcherListener(gitBranchListeners, callback)
  }
}
function worktreePost(path: string, body: Record<string, unknown>): Promise<any> {
  return octobRuntime.api(`/v1/worktrees/${path}`, 'POST', body)
}

function installWorktreeBridge(target: any): void {
  target.worktreeOps = {
    create: (p: any) => worktreePost('create', { projectId: p.projectId }),
    delete: (p: any) => worktreePost('delete', {
      worktreeId: p.worktreeId,
      archive: p.archive
    }),
    sync: (p: any) => worktreePost('sync', { projectId: p.projectId }),
    duplicate: (p: any) => worktreePost('duplicate', {
      worktreeId: p.worktreeId,
      nameHint: p.nameHint
    }),
    renameBranch: (worktreeId: string, _path: string, _old: string, newBranch: string) =>
      worktreePost('rename', { worktreeId, newBranch }),
    createFromBranch: (
      projectId: string,
      _projectPath: string,
      _projectName: string,
      branchName: string,
      prNumber?: number,
      nameHint?: string
    ) => worktreePost('from-branch', { projectId, branchName, prNumber, nameHint }),
    getBranches: async (projectPath: string) => gitPost('branches', { worktreePath: projectPath }),
    branchExists: async (projectPath: string, branchName: string) => {
      const result = await gitPost('branches', { worktreePath: projectPath })
      return Array.isArray(result.branches) && result.branches.includes(branchName)
    },
    exists: async (path: string) => {
      const result = await octobRuntime.api<{ exists: boolean }>(
        `/v1/files/exists?path=${encodeURIComponent(path)}`
      ).catch(() => ({ exists: false }))
      return result.exists
    },
    hasCommits: async (path: string) => {
      const result = await gitPost('has-commits', { worktreePath: path })
      return result.hasCommits === true
    },
    openInTerminal: (path: string) =>
      octobRuntime.api('/v1/system/open-terminal', 'POST', { path }),
    openInEditor: (path: string) =>
      octobRuntime.api('/v1/system/open-editor', 'POST', { path }),
    onBranchRenamed: noopSubscription,
    getContext: async (id: string) => {
      const worktree = await dbCall<any>('getWorktree', id)
      return { success: !!worktree, context: worktree?.context ?? null }
    },
    updateContext: async (id: string, context: string | null) => {
      await dbCall('updateWorktreeContext', id, context)
      return { success: true }
    }
  }
}

const terminalData = new Map<string, Set<AnyFn>>()
const terminalExit = new Map<string, Set<AnyFn>>()
const terminalStreams = new Map<string, () => void>()
function ensureTerminalStream(terminalId: string): void {
  if (terminalStreams.has(terminalId)) return
  const dispose = octobRuntime.streamTerminal(terminalId, {
    onData: (data) => {
      for (const listener of terminalData.get(terminalId) ?? []) listener(data)
    },
    onExit: (code) => {
      for (const listener of terminalExit.get(terminalId) ?? []) listener(code)
      terminalStreams.get(terminalId)?.()
      terminalStreams.delete(terminalId)
    }
  })
  terminalStreams.set(terminalId, dispose)
}

function addTerminalListener(
  map: Map<string, Set<AnyFn>>,
  terminalId: string,
  callback: AnyFn
): () => void {
  const listeners = map.get(terminalId) ?? new Set<AnyFn>()
  listeners.add(callback)
  map.set(terminalId, listeners)
  ensureTerminalStream(terminalId)
  return () => {
    listeners.delete(callback)
    const hasDataListeners = (terminalData.get(terminalId)?.size ?? 0) > 0
    const hasExitListeners = (terminalExit.get(terminalId)?.size ?? 0) > 0
    if (!hasDataListeners && !hasExitListeners) {
      terminalData.delete(terminalId)
      terminalExit.delete(terminalId)
      terminalStreams.get(terminalId)?.()
      terminalStreams.delete(terminalId)
    }
  }
}

function installTerminalBridge(target: any): void {
  target.terminalOps = {
    create: (id: string, cwd: string, shell?: string) =>
      octobRuntime.createTerminal(id, cwd, shell),
    write: (id: string, data: string) => {
      void octobRuntime.writeTerminal(id, data)
    },
    resize: async (id: string, cols: number, rows: number) => {
      await octobRuntime.resizeTerminal(id, cols, rows)
    },
    setFocus: async (id: string, focused: boolean) => {
      await octobRuntime.focusTerminal(id, focused)
    },
    setKeepAlive: async (id: string, keepAlive: boolean) => {
      await octobRuntime.keepAliveTerminal(id, keepAlive)
    },
    destroy: async (id: string) => {
      terminalStreams.get(id)?.()
      terminalStreams.delete(id)
      await octobRuntime.destroyTerminal(id)
    },
    onData: (id: string, cb: AnyFn) => addTerminalListener(terminalData, id, cb),
    onExit: (id: string, cb: AnyFn) => addTerminalListener(terminalExit, id, cb),
    getConfig: async () => ({}),
    ghosttyInit: () => unsupported('ghostty'),
    ghosttyIsAvailable: async () => ({ available: false, initialized: false, platform: 'web' }),
    ghosttyCreateSurface: () => unsupported('ghostty'),
    ghosttySetFrame: async () => {},
    ghosttySetSize: async () => {},
    ghosttyKeyEvent: async () => false,
    ghosttyMouseButton: async () => {},
    ghosttyMousePos: async () => {},
    ghosttyMouseScroll: async () => {},
    ghosttySetFocus: async () => {},
    ghosttyPasteText: async () => {},
    ghosttyFocusDiagnostics: async () => [],
    ghosttyDestroySurface: async () => {},
    ghosttyShutdown: async () => {}
  }
}

async function projectValue(path: string, body: unknown): Promise<any> {
  const response = await octobRuntime.api<any>(path, 'POST', body)
  return response.value
}

function chooseProjectIcon(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.svg,.png,.jpg,.jpeg,.webp,image/svg+xml,image/png,image/jpeg,image/webp'
    input.style.display = 'none'
    document.body.appendChild(input)

    let settled = false
    const finish = (file: File | null): void => {
      if (settled) return
      settled = true
      input.remove()
      resolve(file)
    }

    input.addEventListener('change', () => finish(input.files?.[0] ?? null), { once: true })
    window.addEventListener('focus', () => {
      setTimeout(() => {
        if (!settled && (!input.files || input.files.length === 0)) finish(null)
      }, 250)
    }, { once: true })
    input.click()
  })
}

function installProjectBridge(target: any): void {
  target.projectOps = {
    openDirectoryDialog: async () => {
      const result = await octobRuntime.api<any>('/v1/project/pick-directory', 'POST', {})
      return result.path ?? null
    },
    isGitRepository: (path: string) =>
      projectValue('/v1/project/is-git', { path }),
    validateProject: (path: string) =>
      octobRuntime.api('/v1/project/validate', 'POST', { path }),
    detectLanguage: (path: string) =>
      projectValue('/v1/project/language', { path }),
    detectFavicon: (path: string) =>
      projectValue('/v1/project/favicon', { path }),
    findXcworkspace: (path: string) =>
      projectValue('/v1/project/xcworkspace', { path }),
    isAndroidProject: (path: string) =>
      projectValue('/v1/project/android', { path }),
    getAbsoluteIconDataUrl: (path: string) =>
      projectValue('/v1/project/icon-data', { path }),
    loadLanguageIcons: async () => ({}),
    copyToClipboard: async (text: string) => navigator.clipboard.writeText(text),
    readFromClipboard: async () => navigator.clipboard.readText(),
    initRepository: (path: string) =>
      octobRuntime.api('/v1/project/init', 'POST', { path }),
    showInFolder: (path: string) =>
      octobRuntime.api('/v1/system/show-in-folder', 'POST', { path }).then(() => undefined),
    openPath: async (path: string) => {
      const result = await octobRuntime.api<any>('/v1/system/open-path', 'POST', { path })
      return result.error ?? ''
    },
    pickProjectIcon: async (projectId: string) => {
      const file = await chooseProjectIcon()
      if (!file) return { success: false, error: 'cancelled' }
      const data = arrayBufferToBase64(await file.arrayBuffer())
      return octobRuntime.api('/v1/project/custom-icon-save', 'POST', {
        projectId,
        originalName: file.name,
        data
      })
    },
    removeProjectIcon: (projectId: string) =>
      octobRuntime.api('/v1/project/custom-icon-remove', 'POST', { projectId }),
    getProjectIconPath: (filename: string) =>
      projectValue('/v1/project/custom-icon-data', { filename })
  }
}
function installSystemBridge(target: any): void {
  target.systemOps = {
    getLogDir: async () => (await octobRuntime.api<any>('/v1/system/log-dir')).path,
    getAppVersion: async () => (await octobRuntime.api<{ version: string }>('/v1/system/version')).version,
    getAppPaths: () => octobRuntime.api('/v1/system/app-paths'),
    isLogMode: async () => (await octobRuntime.api<any>('/v1/system/log-mode')).enabled === true,
    detectAgentSdks: () => octobRuntime.detectAgents(),
    configureCodexBinaryPath: (binaryPath: string) =>
      octobRuntime.api('/v1/system/configure-codex', 'POST', { binaryPath }),
    quitApp: async () => {},
    openInApp: (appName: string, path: string) => {
      if (appName === 'ghostty') {
        return octobRuntime.api('/v1/system/open-terminal', 'POST', {
          path,
          terminalId: 'ghostty'
        })
      }
      if (appName === 'cursor') {
        return octobRuntime.api('/v1/system/open-editor', 'POST', {
          path,
          editorId: 'cursor'
        })
      }
      if (appName === 'android-studio') {
        return octobRuntime.api('/v1/system/open-android-studio', 'POST', { path })
      }
      if (appName === 'copy-path') {
        return navigator.clipboard.writeText(path).then(() => ({ success: true }))
      }
      return unsupported(`system.openInApp:${appName}`)
    },
    openInChrome: async (url: string) => {
      window.open(url, '_blank', 'noopener,noreferrer')
      return { success: true }
    },
    getPlatform: async () => (await octobRuntime.health()).platform,
    isPackaged: async () => false,
    setKeepAwake: setBrowserKeepAwake,
    setSessionQueuedState: async () => {},
    updateMenuState: async () => {},
    onNewSessionShortcut: noopSubscription,
    onCloseSessionShortcut: noopSubscription,
    onFileSearchShortcut: noopSubscription,
    onEditPaste: noopSubscription,
    onNotificationNavigate: noopSubscription,
    onMenuAction: noopSubscription,
    onWindowFocused: (callback: AnyFn) => {
      window.addEventListener('focus', callback)
      return () => window.removeEventListener('focus', callback)
    }
  }

  target.loggingOps = {
    createResponseLog: async (sessionId: string) =>
      (await octobRuntime.api<any>('/v1/logging/create', 'POST', { sessionId })).path,
    appendResponseLog: async (filePath: string, data: unknown) => {
      await octobRuntime.api('/v1/logging/append', 'POST', { filePath, data })
    }
  }
  target.analyticsOps = {
    track: (event: string, properties?: Record<string, unknown>) =>
      octobRuntime.api('/v1/system/analytics/track', 'POST', { event, properties }),
    setEnabled: async (enabled: boolean) => {
      await octobRuntime.api('/v1/system/analytics', 'POST', { enabled })
    },
    isEnabled: async () => (await octobRuntime.api<{ enabled: boolean }>('/v1/system/analytics')).enabled
  }
  target.perfDiagnosticsOps = {
    enable: async (enabled: boolean) => {
      await octobRuntime.api('/v1/system/perf-enable', 'POST', { enabled })
    },
    getSnapshot: async () => (await octobRuntime.api<{ snapshot: unknown }>('/v1/system/perf-snapshot')).snapshot
  }
  target.codexDebugLoggerOps = {
    configure: (enabled: boolean, resetPerSession: boolean) =>
      octobRuntime.api('/v1/system/codex-debug', 'POST', { enabled, resetPerSession })
  }
}
function connectionPost(path: string, body: Record<string, unknown>): Promise<any> {
  return octobRuntime.api(`/v1/connections/${path}`, 'POST', body)
}

function installConnectionBridge(target: any): void {
  target.connectionOps = {
    getAll: () => dbCall('getAllConnections'),
    get: (id: string) => dbCall('getConnection', id),
    rename: (id: string, customName: string | null) =>
      connectionPost('rename', { connectionId: id, customName }),
    setPinned: (id: string, pinned: boolean) =>
      dbCall('updateConnection', id, { pinned: pinned ? 1 : 0 }),
    getPinned: () => dbCall('getPinnedConnections'),
    create: (worktreeIds: string[]) =>
      connectionPost('create', { worktreeIds }),
    delete: (connectionId: string) =>
      connectionPost('delete', { connectionId }),
    addMember: (connectionId: string, worktreeId: string) =>
      connectionPost('add-member', { connectionId, worktreeId }),
    removeMember: (connectionId: string, worktreeId: string) =>
      connectionPost('remove-member', { connectionId, worktreeId }),
    removeWorktreeFromAll: (worktreeId: string) =>
      connectionPost('remove-worktree', { worktreeId }),
    openInTerminal: (connectionPath: string) =>
      octobRuntime.api('/v1/system/open-terminal', 'POST', { path: connectionPath }),
    openInEditor: (connectionPath: string) =>
      octobRuntime.api('/v1/system/open-editor', 'POST', { path: connectionPath })
  }
}

const assistantTaskCreatedListeners = new Set<AnyFn>()
const assistantTasksChangedListeners = new Set<AnyFn>()
const assistantProjectSelectionListeners = new Set<AnyFn>()
let disposeAssistantStream: (() => void) | null = null

function ensureAssistantStream(): void {
  if (disposeAssistantStream) return
  disposeAssistantStream = octobRuntime.streamAssistant((rawEvent) => {
    const event = rawEvent as { channel?: string; args?: unknown[] }
    const value = event.args?.[0]
    if (event.channel === 'assistant:task-created') {
      for (const listener of assistantTaskCreatedListeners) listener(value)
    } else if (event.channel === 'assistant:tasks-changed') {
      for (const listener of assistantTasksChangedListeners) listener(value)
    } else if (event.channel === 'assistant:project-selection-requested') {
      for (const listener of assistantProjectSelectionListeners) listener(value)
    }
  })
}

function addAssistantListener(
  listeners: Set<AnyFn>,
  callback: AnyFn
): () => void {
  listeners.add(callback)
  ensureAssistantStream()
  return () => {
    listeners.delete(callback)
    if (
      assistantTaskCreatedListeners.size === 0 &&
      assistantTasksChangedListeners.size === 0 &&
      assistantProjectSelectionListeners.size === 0
    ) {
      disposeAssistantStream?.()
      disposeAssistantStream = null
    }
  }
}

function installAuxiliaryBridge(target: any): void {
  target.assistantOps = {
    show: async () => window.dispatchEvent(new Event('octob:assistant-show')),
    hide: async () => window.dispatchEvent(new Event('octob:assistant-hide')),
    createSession: async (data: any) => {
      const params = new URLSearchParams({
        projectId: String(data.project_id ?? ''),
        name: String(data.name ?? 'Assistente Global'),
        agentSdk: String(data.agent_sdk ?? 'opencode'),
        id: String(data.id ?? '')
      })
      if (data.model_provider_id) params.set('modelProviderId', String(data.model_provider_id))
      if (data.model_id) params.set('modelId', String(data.model_id))
      if (data.model_variant) params.set('modelVariant', String(data.model_variant))
      return octobRuntime.api(`/v1/assistant/session?${params.toString()}`)
    },
    getWorkspacePath: async () => {
      const result = await octobRuntime.api<any>('/v1/assistant/status')
      return result.workspacePath
    },
    listTasks: () => octobRuntime.api('/v1/assistant/tasks'),
    removeTask: (sessionId: string) =>
      octobRuntime.api('/v1/assistant/remove-task', 'POST', { sessionId }),
    listProjectSelectionRequests: () =>
      octobRuntime.api('/v1/assistant/project-selection-requests'),
    resolveProjectSelection: async (requestId: string, projectId: string | null) => {
      const result = await octobRuntime.api<any>(
        '/v1/assistant/resolve-project-selection',
        'POST',
        { requestId, projectId }
      )
      return result.resolved === true
    },
    getProjectInstructions: (projectId: string) =>
      octobRuntime.api(
        `/v1/assistant/instructions?projectId=${encodeURIComponent(projectId)}`
      ),
    setProjectInstructions: (projectId: string, instructions: string[]) =>
      octobRuntime.api('/v1/assistant/instructions', 'POST', {
        projectId,
        instructions
      }),
    onTaskCreated: (callback: AnyFn) =>
      addAssistantListener(assistantTaskCreatedListeners, callback),
    onTasksChanged: (callback: AnyFn) =>
      addAssistantListener(assistantTasksChangedListeners, callback),
    onProjectSelectionRequested: (callback: AnyFn) =>
      addAssistantListener(assistantProjectSelectionListeners, callback),
    onOpen: noopSubscription
  }
  target.settingsOps = {
    detectEditors: () => octobRuntime.api('/v1/system/editors'),
    detectTerminals: () => octobRuntime.api('/v1/system/terminals'),
    openWithEditor: (
      path: string,
      editorId: string,
      customCommand?: string
    ) => octobRuntime.api('/v1/system/open-editor', 'POST', {
      path,
      editorId,
      customCommand
    }),
    openWithTerminal: (
      path: string,
      terminalId: string,
      customCommand?: string
    ) => octobRuntime.api('/v1/system/open-terminal', 'POST', {
      path,
      terminalId,
      customCommand
    }),
    testMcpServer: (server: unknown) =>
      octobRuntime.api('/v1/system/mcp-test', 'POST', { server }),
    onSettingsUpdated: noopSubscription
  }

  target.usageOps = {
    fetch: () => octobRuntime.api('/v1/usage/claude'),
    fetchOpenai: () => octobRuntime.api('/v1/usage/openai'),
    fetchAntigravity: () => octobRuntime.api('/v1/usage/antigravity')
  }
  target.accountOps = {
    getClaudeEmail: () => octobRuntime.api('/v1/account/claude-email'),
    getOpenAIEmail: () => octobRuntime.api('/v1/account/openai-email')
  }

  target.updates = {
    getState: () => octobRuntime.api('/v1/system/updates/state'),
    check: () => octobRuntime.api('/v1/system/updates/check', 'POST', {}),
    download: () => octobRuntime.api('/v1/system/updates/download', 'POST', {}),
    install: async () => {
      await octobRuntime.api('/v1/system/updates/install', 'POST', {})
      window.location.reload()
    },
    onState: noopSubscription,
    onAvailable: noopSubscription,
    onDownloaded: noopSubscription,
    onProgress: noopSubscription,
    onError: noopSubscription
  }

  target.attachmentOps = {
    saveImage: (buffer: ArrayBuffer, originalName: string) =>
      octobRuntime.api('/v1/attachments/save', 'POST', {
        data: arrayBufferToBase64(buffer),
        originalName
      }),
    deleteImage: (filePath: string) =>
      octobRuntime.api('/v1/attachments/delete', 'POST', { filePath })
  }
  target.voiceTranscriptionOps = {
    status: () => octobRuntime.api('/v1/voice/status'),
    downloadModel: () => octobRuntime.api('/v1/voice/download', 'POST', {}),
    transcribe: (audio: ArrayBuffer) =>
      octobRuntime.api('/v1/voice/transcribe', 'POST', {
        data: arrayBufferToBase64(audio)
      })
  }
}
function installFileTreeBridge(target: any): void {
  target.fileTreeOps = {
    scan: (path: string) =>
      octobRuntime.api('/v1/file-tree/scan', 'POST', { path, rootPath: path }),
    scanFlat: (path: string) =>
      octobRuntime.api('/v1/file-tree/flat', 'POST', { path, rootPath: path }),
    loadChildren: (path: string, rootPath: string) =>
      octobRuntime.api('/v1/file-tree/children', 'POST', { path, rootPath }),
    watch: (path: string) => watcherPost('file/watch', path),
    unwatch: (path: string) => watcherPost('file/unwatch', path),
    onChange: (callback: AnyFn) => addWatcherListener(fileTreeChangeListeners, callback)
  }
}
const agentStreamListeners = new Set<AnyFn>()
let disposeAgentStream: (() => void) | null = null

function ensureAgentStream(): void {
  if (disposeAgentStream) return
  disposeAgentStream = octobRuntime.streamAgents((event) => {
    for (const listener of agentStreamListeners) listener(event)
  })
}

function agentCall<T = any>(operation: string, body: unknown = {}): Promise<T> {
  return octobRuntime.agentOperation<T>(operation, body)
}

function createAgentBridge(): any {
  return {
    connect: (worktreePath: string, octobSessionId: string, agentSdk?: string) =>
      agentCall('connect', { worktreePath, octobSessionId, agentSdk }),
    reconnect: (worktreePath: string, sessionId: string, octobSessionId: string) =>
      agentCall('reconnect', { worktreePath, sessionId, octobSessionId }),
    prompt: (
      worktreePath: string,
      sessionId: string,
      messageOrParts: unknown,
      model?: unknown,
      options?: unknown
    ) => agentCall('prompt', {
      worktreePath,
      sessionId,
      ...(Array.isArray(messageOrParts)
        ? { parts: messageOrParts }
        : { message: messageOrParts }),
      model,
      options
    }),
    abort: (worktreePath: string, sessionId: string) =>
      agentCall('abort', { worktreePath, sessionId }),
    steer: (worktreePath: string, sessionId: string, message: string) =>
      agentCall('steer', { worktreePath, sessionId, message }),
    disconnect: (worktreePath: string, sessionId: string) =>
      agentCall('disconnect', { worktreePath, sessionId }),
    getMessages: (worktreePath: string, sessionId: string) =>
      agentCall('messages', { worktreePath, sessionId }),
    listModels: (opts?: { agentSdk?: string }) =>
      agentCall('models', { agentSdk: opts?.agentSdk }),
    setModel: (model: unknown) =>
      agentCall('set-model', { model }),
    modelInfo: (worktreePath: string, modelId: string, agentSdk?: string) =>
      agentCall('model-info', { worktreePath, modelId, agentSdk }),
    questionReply: (requestId: string, answers: string[][], worktreePath?: string) =>
      agentCall('question-reply', { requestId, answers, worktreePath }),
    questionReject: (requestId: string, worktreePath?: string) =>
      agentCall('question-reject', { requestId, worktreePath }),
    planApprove: (
      worktreePath: string,
      octobSessionId: string,
      requestId?: string
    ) => agentCall('plan-approve', { worktreePath, octobSessionId, requestId }),
    planReject: (
      worktreePath: string,
      octobSessionId: string,
      feedback: string,
      requestId?: string
    ) => agentCall('plan-reject', {
      worktreePath,
      octobSessionId,
      feedback,
      requestId
    }),
    permissionReply: (
      requestId: string,
      reply: 'once' | 'always' | 'reject',
      worktreePath?: string,
      message?: string
    ) => agentCall('permission-reply', { requestId, reply, worktreePath, message }),
    permissionList: (worktreePath?: string) =>
      agentCall('permission-list', { worktreePath }),
    commandApprovalReply: (
      requestId: string,
      approved: boolean,
      remember?: string,
      pattern?: string,
      worktreePath?: string,
      patterns?: string[]
    ) => agentCall('command-approval-reply', {
      requestId, approved, remember, pattern, worktreePath, patterns
    }),
    sessionInfo: (worktreePath: string, sessionId: string) =>
      agentCall('session-info', { worktreePath, sessionId }),
    undo: (worktreePath: string, sessionId: string) =>
      agentCall('undo', { worktreePath, sessionId }),
    redo: (worktreePath: string, sessionId: string) =>
      agentCall('redo', { worktreePath, sessionId }),
    command: (
      worktreePath: string,
      sessionId: string,
      command: string,
      args: string
    ) => agentCall('command', { worktreePath, sessionId, command, args }),
    commands: (worktreePath: string, sessionId?: string) =>
      agentCall('commands', { worktreePath, sessionId }),
    renameSession: (sessionId: string, title: string, worktreePath?: string) =>
      agentCall('rename', { sessionId, title, worktreePath }),
    capabilities: (sessionId?: string) =>
      agentCall('capabilities', { sessionId }),
    fork: (worktreePath: string, sessionId: string, messageId?: string) =>
      agentCall('fork', { worktreePath, sessionId, messageId }),
    onStream: (callback: AnyFn) => {
      agentStreamListeners.add(callback)
      ensureAgentStream()
      return () => {
        agentStreamListeners.delete(callback)
        if (agentStreamListeners.size === 0) {
          disposeAgentStream?.()
          disposeAgentStream = null
        }
      }
    }
  }
}

function installExecutionFallbacks(target: any): void {
  const scriptListeners = new Map<string, Set<AnyFn>>()
  let disposeScriptStream: (() => void) | null = null
  const ensureScriptStream = (): void => {
    if (disposeScriptStream) return
    disposeScriptStream = octobRuntime.streamScripts((payload: any) => {
      const listeners = scriptListeners.get(payload.eventKey)
      if (!listeners) return
      for (const listener of listeners) listener(payload.event)
    })
  }
  const disposeUnusedScriptStream = (): void => {
    if (scriptListeners.size !== 0) return
    disposeScriptStream?.()
    disposeScriptStream = null
  }

  target.scriptOps = {
    runSetup: (commands: string[], cwd: string, worktreeId: string) =>
      octobRuntime.api('/v1/scripts/run-setup', 'POST', { commands, cwd, worktreeId }),
    runProject: (commands: string[], cwd: string, worktreeId: string) =>
      octobRuntime.api('/v1/scripts/run-project', 'POST', { commands, cwd, worktreeId }),
    kill: (worktreeId: string) =>
      octobRuntime.api('/v1/scripts/kill', 'POST', { worktreeId }),
    getRunState: (worktreeId: string) =>
      octobRuntime.api('/v1/scripts/state', 'POST', { worktreeId }),
    runArchive: (commands: string[], cwd: string) =>
      octobRuntime.api('/v1/scripts/archive', 'POST', { commands, cwd }),
    onOutput: (channel: string, callback: AnyFn) => {
      const listeners = scriptListeners.get(channel) ?? new Set<AnyFn>()
      listeners.add(callback)
      scriptListeners.set(channel, listeners)
      ensureScriptStream()
      return () => {
        listeners.delete(callback)
        if (listeners.size === 0) scriptListeners.delete(channel)
        disposeUnusedScriptStream()
      }
    },
    offOutput: (channel: string) => {
      const deleted = scriptListeners.delete(channel)
      disposeUnusedScriptStream()
      return deleted
    },
    getPort: (cwd: string) =>
      octobRuntime.api('/v1/scripts/port', 'POST', { cwd })
  }

  const bashListeners = new Set<AnyFn>()
  let disposeBashStream: (() => void) | null = null
  const ensureBashStream = (): void => {
    if (disposeBashStream) return
    disposeBashStream = octobRuntime.streamBash((event) => {
      for (const listener of bashListeners) listener(event)
    })
  }
  const disposeUnusedBashStream = (): void => {
    if (bashListeners.size !== 0) return
    disposeBashStream?.()
    disposeBashStream = null
  }

  target.bash = {
    run: (sessionId: string, command: string, cwd: string) =>
      octobRuntime.api('/v1/bash/run', 'POST', { sessionId, command, cwd }),
    abort: async (sessionId: string) => {
      const result = await octobRuntime.api<any>('/v1/bash/abort', 'POST', { sessionId })
      return result.success === true
    },
    getRun: (sessionId: string) =>
      octobRuntime.api('/v1/bash/get', 'POST', { sessionId }),
    onStream: (callback: AnyFn) => {
      bashListeners.add(callback)
      ensureBashStream()
      return () => {
        bashListeners.delete(callback)
        disposeUnusedBashStream()
      }
    }
  }

  window.addEventListener('beforeunload', () => {
    disposeScriptStream?.()
    disposeBashStream?.()
  }, { once: true })

  target.opencodeOps = createAgentBridge()
}
export async function installWebRuntimeBridge(): Promise<void> {
  const target = window as any
  if (target.db) return

  target.__OCTOB_WEB_RUNTIME__ = true

  await octobRuntime.ensureConnected()
  installDatabaseBridge(target)
  installFileBridge(target)
  installGitBridge(target)
  installWorktreeBridge(target)
  installTerminalBridge(target)
  installProjectBridge(target)
  installSystemBridge(target)
  installConnectionBridge(target)
  installAuxiliaryBridge(target)
  installFileTreeBridge(target)
  installExecutionFallbacks(target)
}
