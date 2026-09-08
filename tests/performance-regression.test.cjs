// Run with: node --test tests/performance-regression.test.cjs
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve, dirname } = require('node:path')
const { createRequire } = require('node:module')
const vm = require('node:vm')
const ts = require('typescript')

function load(file, mocks = {}, globals = {}) {
  const filename = resolve(__dirname, '..', file)
  const localRequire = createRequire(filename)
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText
  const module = { exports: {} }
  vm.runInNewContext(code, {
    module, exports: module.exports, console, process, setTimeout, clearTimeout,
    __dirname: dirname(filename),
    require: (id) => Object.hasOwn(mocks, id) ? mocks[id] : localRequire(id),
    ...globals
  }, { filename })
  return module.exports
}

const tick = () => new Promise((resolve) => setImmediate(resolve))
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function gitStore(ops) {
  return load('src/renderer/src/stores/useGitStore.ts', {
    './useWorktreeStore': { useWorktreeStore: {} }
  }, { window: { gitOps: ops } }).useGitStore
}

test('concurrent panels share IPC; clearing a worktree rejects stale responses', async () => {
  let calls = 0
  const pending = deferred()
  const store = gitStore({ getFileStatuses: () => { calls++; return pending.promise } })
  const requests = Array.from({ length: 30 }, () => store.getState().loadFileStatuses('/repo'))
  await tick()
  assert.equal(calls, 1)
  store.getState().setHasConflicts('/repo', true)
  store.getState().setSelectedMergeBranch('/repo', 'main')
  store.getState().clearStatuses('/repo')
  pending.resolve({ success: true, files: [{ path: '/repo/a', relativePath: 'a', status: 'M', staged: false }] })
  await Promise.all(requests)
  assert.equal(store.getState().fileStatusesByWorktree.size, 0)
  assert.equal(store.getState().selectedMergeBranch.size, 0)
  assert.equal(store.getState().conflictsByWorktree['/repo'], undefined)
  assert.equal(store.getState().isLoading, false)
})

test('clearing a scheduled refresh settles callers without starting IPC', async () => {
  let calls = 0
  const store = gitStore({ getFileStatuses: async () => { calls++; return { success: true, files: [] } } })
  const pending = store.getState().refreshStatuses('/repo')
  store.getState().clearStatuses('/repo')
  await pending
  await delay(180)
  assert.equal(calls, 0)
})

test('changes during a slow read get a fresh snapshot and their own completion', async () => {
  const reads = [deferred(), deferred(), deferred()]
  let calls = 0
  const store = gitStore({
    getFileStatuses: () => reads[calls++].promise,
    getBranchInfo: async () => ({ success: true, branch: { name: 'main', tracking: null, ahead: 0, behind: 0 } })
  })
  const initial = store.getState().loadFileStatuses('/repo')
  await tick()
  const first = store.getState().refreshStatuses('/repo')
  await delay(180)
  reads[0].resolve({ success: true, files: [] })
  await initial
  await tick()
  assert.equal(calls, 2)
  let secondDone = false
  const second = store.getState().refreshStatuses('/repo').then(() => { secondDone = true })
  await delay(180)
  reads[1].resolve({ success: true, files: [] })
  await first
  await tick()
  assert.equal(calls, 3)
  assert.equal(secondDone, false)
  reads[2].resolve({ success: true, files: [] })
  await second
})

test('clearing while refresh waits for a read does not resurrect the worktree', async () => {
  const read = deferred()
  let calls = 0
  const store = gitStore({ getFileStatuses: () => { calls++; return read.promise } })
  const initial = store.getState().loadFileStatuses('/repo')
  await tick()
  const refresh = store.getState().refreshStatuses('/repo')
  await delay(180)
  store.getState().clearStatuses('/repo')
  read.resolve({ success: true, files: [] })
  await Promise.all([initial, refresh])
  assert.equal(calls, 1)
  assert.equal(store.getState().fileStatusesByWorktree.size, 0)
})

const logger = { createLogger: () => ({ info() {}, warn() {}, error() {} }) }

for (const hook of ['useWorktreeWatcher', 'useConnectionWatcher', 'useSidebarBranchWatcher']) {
  test(`${hook} reacquires watchers after React effect replay`, () => {
    const effects = []
    let references = 0
    const ops = {
      watchWorktree: async () => { references++ },
      unwatchWorktree: async () => { references-- },
      watchBranch: async () => { references++ },
      unwatchBranch: async () => { references-- },
      onStatusChanged: () => () => {},
      onBranchChanged: () => () => {}
    }
    const worktreeState = {
      selectedWorktreeId: hook === 'useConnectionWatcher' ? null : 'worktree',
      worktreesByProject: new Map([['project', [{ id: 'worktree', path: '/repo' }]]])
    }
    const hooks = load(`src/renderer/src/hooks/${hook}.ts`, {
      react: { useEffect: (fn) => effects.push(fn), useRef: (current) => ({ current }) },
      '@/stores/useWorktreeStore': { useWorktreeStore: (select) => select(worktreeState) },
      '@/stores/useConnectionStore': { useConnectionStore: (select) => select({
        selectedConnectionId: 'connection',
        connections: [{ id: 'connection', members: [{ worktree_path: '/repo' }, { worktree_path: '/repo' }] }]
      }) },
      '@/stores/useGitStore': { useGitStore: { getState: () => ({
        loadFileStatuses() {}, loadBranchInfo() {}, loadStatusesForPaths() {}
      }) } }
    }, { window: { gitOps: ops } })
    hooks[hook](['/repo'])
    let cleanups = effects.map((setup) => setup())
    assert.equal(references, 1)
    cleanups.forEach((cleanup) => cleanup?.())
    assert.equal(references, 0)
    cleanups = effects.map((setup) => setup())
    assert.equal(references, 1)
    cleanups.forEach((cleanup) => cleanup?.())
    assert.equal(references, 0)
  })
}

test('delayed PTY exit preserves its replacement and releases old listeners', () => {
  const processes = []
  const { ptyService } = load('src/main/services/pty-service.ts', {
    './logger': logger,
    'node-pty': { spawn: () => {
      const pty = { cols: 80, rows: 24, kill() {}, onData(fn) { this.data = fn }, onExit(fn) { this.exit = fn } }
      processes.push(pty)
      return pty
    } }
  })
  ptyService.create('terminal', { cwd: '/repo' })
  let output = 0
  ptyService.onData('terminal', () => { output++ })
  ptyService.destroy('terminal')
  ptyService.create('terminal', { cwd: '/repo' })
  processes[0].exit({ exitCode: 0 })
  processes[0].data('late output')
  assert.equal(output, 0)
  assert.equal(ptyService.has('terminal'), true)
  processes[1].exit({ exitCode: 0 })
  assert.equal(ptyService.getCount(), 0)
})

test('Git file and branch reads share a process and release failed requests', async () => {
  let calls = 0
  let env
  let next = deferred()
  const client = { env(value) { env = value; return this }, status() { calls++; return next.promise } }
  const { GitService } = load('src/main/services/git-service.ts', {
    'simple-git': () => client,
    electron: {}, './logger': logger, './breed-names': {}, './path-utils': {},
    '@shared/types/file-utils': {}, '@shared/types/branch-utils': {}
  })
  const git = new GitService('/repo')
  const files = git.getFileStatuses()
  const branch = git.getBranchInfo()
  assert.equal(calls, 1)
  assert.equal(env.GIT_OPTIONAL_LOCKS, '0')
  next.resolve({ files: [], conflicted: [], current: 'main' })
  assert.equal((await files).success, true)
  assert.equal((await branch).branch.name, 'main')
  next = deferred()
  const failure = git.getFileStatuses()
  next.reject(new Error('git unavailable'))
  assert.equal((await failure).success, false)
  next = deferred()
  const retry = git.getFileStatuses()
  assert.equal(calls, 3)
  next.resolve({ files: [], conflicted: [] })
  assert.equal((await retry).success, true)
})
