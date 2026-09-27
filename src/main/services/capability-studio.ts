import Database from 'better-sqlite3'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { isDeepStrictEqual } from 'node:util'
import { Script } from 'node:vm'
import { getDatabase } from '../db/database'
import type {
  CapabilityArtifactInput,
  CapabilityDetail,
  CapabilityDraft,
  CapabilitySpec,
  CapabilityValidation,
  CapabilityVersion
} from '../../shared/types/capability-studio'

type DraftRow = Omit<CapabilityDraft, 'spec' | 'latestVersion' | 'installedVersion' | 'createdAt' | 'updatedAt'> & {
  spec_json: string
  latest_version: number
  installed_version: number | null
  created_at: string
  updated_at: string
}
type VersionRow = {
  draft_id: string
  version: number
  status: CapabilityVersion['status']
  spec_json: string
  artifact_hash: string
  validation_json: string | null
  created_at: string
}

let activeWorkers = 0
const MAX_ACTIVE_WORKERS = 4
export const MAX_CAPABILITY_TIMEOUT_MS = 5 * 60_000
export const MAX_CAPABILITY_STDERR_CHARS = 16 * 1024
export const MAX_CAPABILITY_EXECUTIONS_PER_DRAFT = 1_000

export function pruneCapabilityExecutions(
  db: Database.Database,
  draftId: string,
  keepCount = MAX_CAPABILITY_EXECUTIONS_PER_DRAFT
): void {
  if (!Number.isSafeInteger(keepCount) || keepCount < 1) throw new Error('keepCount must be a positive integer')
  db.prepare(`DELETE FROM capability_executions
    WHERE draft_id = ? AND id NOT IN (
      SELECT id FROM capability_executions
      WHERE draft_id = ? ORDER BY started_at DESC, id DESC LIMIT ?
    )`).run(draftId, draftId, keepCount)
}

function killProcessTree(child: ChildProcess): void {
  if (!child.pid) return
  if (process.platform === 'win32') {
    try {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        stdio: 'ignore',
        windowsHide: true
      })
      killer.on('error', () => child.kill('SIGKILL'))
      killer.on('close', (code) => { if (code !== 0) child.kill('SIGKILL') })
      killer.unref()
    } catch {
      child.kill()
    }
    return
  }

  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    child.kill('SIGKILL')
  }
}

function parseDraft(row: DraftRow): CapabilityDraft {
  return {
    id: row.id, name: row.name, request: row.request,
    spec: JSON.parse(row.spec_json) as CapabilitySpec,
    status: row.status, latestVersion: row.latest_version,
    installedVersion: row.installed_version,
    createdAt: row.created_at, updatedAt: row.updated_at
  }
}

function parseVersion(row: VersionRow): CapabilityVersion {
  return {
    draftId: row.draft_id, version: row.version, status: row.status,
    spec: JSON.parse(row.spec_json) as CapabilitySpec,
    artifactHash: row.artifact_hash,
    validation: row.validation_json ? JSON.parse(row.validation_json) as CapabilityValidation : null,
    createdAt: row.created_at
  }
}

function validateSpec(spec: CapabilitySpec): void {
  if (!spec || typeof spec.name !== 'string' || !/^[a-z][a-z0-9.-]{2,80}$/.test(spec.name)) {
    throw new Error('Capability name must be a lowercase dotted identifier')
  }
  if (typeof spec.description !== 'string' || !spec.description.trim()) throw new Error('Description required')
  for (const key of ['screens', 'actions', 'requiredSecrets', 'externalWrites'] as const) {
    if (!Array.isArray(spec[key]) || !spec[key].every((item) => typeof item === 'string')) {
      throw new Error(`${key} must be a string array`)
    }
  }
  if (spec.timeoutMs !== undefined && (
    !Number.isSafeInteger(spec.timeoutMs) ||
    spec.timeoutMs < 1 ||
    spec.timeoutMs > MAX_CAPABILITY_TIMEOUT_MS
  )) {
    throw new Error(`timeoutMs must be between 1 and ${MAX_CAPABILITY_TIMEOUT_MS} milliseconds`)
  }
}

function validateArtifact(artifact: CapabilityArtifactInput): void {
  if (!artifact || typeof artifact !== 'object') throw new Error('Artifact required')
  for (const key of ['html', 'css', 'javascript', 'handler'] as const) {
    if (typeof artifact[key] !== 'string' || artifact[key].length > 5_000_000) {
      throw new Error(`${key} must be a string under 5 MB`)
    }
  }
  if (!Array.isArray(artifact.tests) || artifact.tests.length > 30) throw new Error('Invalid tests')
  if (artifact.files !== undefined) {
    if (!artifact.files || typeof artifact.files !== 'object' || Array.isArray(artifact.files)) throw new Error('Invalid files')
    for (const [path, contents] of Object.entries(artifact.files)) {
      if (typeof contents !== 'string' || !path || path === 'artifact.json' || path === 'artifact.json.tmp' || path.includes('\\')) {
        throw new Error(`Invalid artifact file: ${path}`)
      }
      const target = resolve('/capability-artifact', path)
      if (!target.startsWith(resolve('/capability-artifact') + sep)) throw new Error(`Invalid artifact file: ${path}`)
      if (target === resolve('/capability-artifact', 'artifact.json') || target === resolve('/capability-artifact', 'artifact.json.tmp')) {
        throw new Error(`Invalid artifact file: ${path}`)
      }
    }
  }
  if (/<\s*(script|iframe|object|embed|base|meta|link)\b/i.test(artifact.html)) {
    throw new Error('HTML must be a fragment without executable or embedded tags')
  }
  new Script(artifact.javascript, { filename: 'capability-ui.js' })
  try {
    new Script(`(${artifact.handler})`, { filename: 'capability-handler.js' })
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    new Script(artifact.handler, { filename: 'capability-handler.js' })
  }
}

function runnerLaunch(): { command: string; args: string[]; env: NodeJS.ProcessEnv } {
  const candidates = [
    join(process.cwd(), 'resources', 'capability-runner.cjs'),
    join(process.resourcesPath ?? '', 'capability-runner.cjs'),
    join(dirname(process.execPath), 'capability-runner.cjs')
  ]
  const runner = candidates.find((path) => existsSync(path))
  if (!runner) throw new Error('Capability runner was not packaged')
  const sea = existsSync(join(dirname(process.execPath), 'runtime-manifest.json'))
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {})
  }
  return { command: process.execPath, args: sea ? ['--capability-runner'] : [runner], env }
}

export function runCapabilityHandler(
  handler: string,
  input: unknown,
  timeoutMs = 15_000,
  httpMocks?: NonNullable<CapabilityArtifactInput['tests'][number]['httpMocks']>,
  artifactDirectory?: string,
  signal?: AbortSignal
): Promise<unknown> {
  if (signal?.aborted) return Promise.reject(new Error('Capability execution cancelled'))
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_CAPABILITY_TIMEOUT_MS) {
    return Promise.reject(new Error(`timeoutMs must be between 1 and ${MAX_CAPABILITY_TIMEOUT_MS} milliseconds`))
  }
  let payload: string
  try {
    payload = JSON.stringify({ handler, input, artifactDirectory, ...(httpMocks === undefined ? {} : { httpMocks }) })
    if (payload.length > 10 * 1024 * 1024) throw new Error('Capability request too large')
  } catch (error) {
    return Promise.reject(error)
  }
  if (activeWorkers >= MAX_ACTIVE_WORKERS) return Promise.reject(new Error('Capability worker limit reached'))
  activeWorkers += 1
  return new Promise((resolveResult, reject) => {
    let launch: ReturnType<typeof runnerLaunch>
    try { launch = runnerLaunch() }
    catch (error) { activeWorkers -= 1; reject(error); return }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(launch.command, launch.args, {
        env: launch.env,
        cwd: artifactDirectory,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        detached: process.platform !== 'win32'
      })
    } catch (error) { activeWorkers -= 1; reject(error); return }
    let output = ''
    let error = ''
    let settled = false
    let timer: ReturnType<typeof setTimeout>
    let abortExecution: () => void = () => undefined
    const finish = (value: unknown, failure?: Error): void => {
      if (settled) return
      settled = true
      activeWorkers -= 1
      clearTimeout(timer)
      signal?.removeEventListener('abort', abortExecution)
      killProcessTree(child)
      if (failure) reject(failure)
      else resolveResult(value)
    }
    abortExecution = (): void => finish(null, new Error('Capability execution cancelled'))
    timer = setTimeout(() => finish(null, new Error('Capability timed out')), timeoutMs)
    signal?.addEventListener('abort', abortExecution, { once: true })
    if (signal?.aborted) abortExecution()
    child.stdout.on('data', (chunk: Buffer) => {
      if (settled) return
      output += chunk.toString()
      if (output.length > 10 * 1024 * 1024) finish(null, new Error('Capability output too large'))
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (settled) return
      if (error.length < MAX_CAPABILITY_STDERR_CHARS) {
        error += chunk.toString('utf8').slice(0, MAX_CAPABILITY_STDERR_CHARS - error.length)
      }
    })
    child.stdin.on('error', (cause) => finish(null, cause))
    child.on('error', (cause) => finish(null, cause))
    child.on('close', (code) => {
      try {
        const message = JSON.parse(output.trim()) as { ok: boolean; result?: unknown; error?: string }
        if (!message.ok) finish(null, new Error(message.error || 'Capability failed'))
        else finish(message.result)
      } catch {
        finish(null, new Error(error || `Capability worker exited with ${code}`))
      }
    })
    child.stdin.end(payload)
  })
}

export class CapabilityStudio {
  private readonly db: Database.Database
  private readonly artifactRoot: string

  constructor(dbPath = join(dirname(getDatabase().getDbPath()), 'capability-studio.db')) {
    mkdirSync(dirname(dbPath), { recursive: true })
    this.artifactRoot = resolve(dirname(dbPath), 'capabilities')
    mkdirSync(this.artifactRoot, { recursive: true })
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS capability_drafts (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, request TEXT NOT NULL,
        spec_json TEXT NOT NULL, status TEXT NOT NULL,
        latest_version INTEGER NOT NULL DEFAULT 0,
        installed_version INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS capability_versions (
        draft_id TEXT NOT NULL REFERENCES capability_drafts(id) ON DELETE CASCADE,
        version INTEGER NOT NULL, status TEXT NOT NULL,
        spec_json TEXT NOT NULL,
        artifact_hash TEXT NOT NULL, validation_json TEXT,
        created_at TEXT NOT NULL, PRIMARY KEY(draft_id, version)
      );
      CREATE TABLE IF NOT EXISTS capability_executions (
        id TEXT PRIMARY KEY, draft_id TEXT NOT NULL, version INTEGER NOT NULL,
        started_at TEXT NOT NULL, finished_at TEXT NOT NULL,
        status TEXT NOT NULL, input_hash TEXT NOT NULL, error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_capability_drafts_status ON capability_drafts(status);
      CREATE INDEX IF NOT EXISTS idx_capability_executions_draft ON capability_executions(draft_id, started_at);
    `)
  }

  list(): CapabilityDraft[] {
    return (this.db.prepare('SELECT * FROM capability_drafts WHERE status != ? ORDER BY updated_at DESC')
      .all('discarded') as DraftRow[]).map(parseDraft)
  }

  get(id: string, version?: number): CapabilityDetail {
    const row = this.db.prepare('SELECT * FROM capability_drafts WHERE id = ?').get(id) as DraftRow | undefined
    if (!row || row.status === 'discarded') throw new Error('Capability not found')
    const draft = parseDraft(row)
    const versions = (this.db.prepare('SELECT * FROM capability_versions WHERE draft_id = ? ORDER BY version DESC')
      .all(id) as VersionRow[]).map(parseVersion)
    const selected = version ?? draft.latestVersion
    const artifact = selected > 0 ? this.readArtifact(id, selected) : null
    return { draft, versions, artifact }
  }

  create(request: string, spec: CapabilitySpec): CapabilityDraft {
    validateSpec(spec)
    if (typeof request !== 'string' || !request.trim()) throw new Error('Request required')
    const existing = this.db.prepare('SELECT id FROM capability_drafts WHERE name = ? AND status != ?')
      .get(spec.name, 'discarded') as { id: string } | undefined
    if (existing) throw new Error('Capability name already exists; revise its draft')
    const id = randomUUID()
    const now = new Date().toISOString()
    this.db.prepare(`INSERT INTO capability_drafts
      (id, name, request, spec_json, status, latest_version, installed_version, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'draft', 0, NULL, ?, ?)`).run(
      id, spec.name, request.trim(), JSON.stringify(spec), now, now
    )
    return this.get(id).draft
  }

  addVersion(id: string, artifact: CapabilityArtifactInput, spec?: CapabilitySpec): CapabilityVersion {
    validateArtifact(artifact)
    const draft = this.get(id).draft
    const nextSpec = spec ?? draft.spec
    validateSpec(nextSpec)
    if (nextSpec.name !== draft.name) throw new Error('Capability name cannot change between versions')
    const version = draft.latestVersion + 1
    const directory = this.versionPath(id, version)
    mkdirSync(directory, { recursive: true })
    const bytes = JSON.stringify(artifact)
    const hash = createHash('sha256').update(bytes).digest('hex')
    const temporary = join(directory, 'artifact.json.tmp')
    writeFileSync(temporary, bytes, { flag: 'wx' })
    renameSync(temporary, join(directory, 'artifact.json'))
    for (const [path, contents] of Object.entries(artifact.files ?? {})) {
      const target = resolve(directory, path)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, contents, { flag: 'wx' })
    }
    const now = new Date().toISOString()
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO capability_versions
        (draft_id, version, status, spec_json, artifact_hash, validation_json, created_at)
        VALUES (?, ?, 'draft', ?, ?, NULL, ?)`).run(id, version, JSON.stringify(nextSpec), hash, now)
      this.db.prepare(`UPDATE capability_drafts SET spec_json = ?, latest_version = ?,
        status = CASE WHEN installed_version IS NULL THEN 'draft' ELSE 'installed' END,
        updated_at = ? WHERE id = ?`)
        .run(JSON.stringify(nextSpec), version, now, id)
    })()
    return this.get(id).versions[0]
  }

  async validate(id: string, version?: number): Promise<CapabilityValidation> {
    const detail = this.get(id, version)
    const selected = version ?? detail.draft.latestVersion
    const artifact = detail.artifact
    if (!artifact || !detail.versions.some((item) => item.version === selected)) throw new Error('Version not found')
    const checks: CapabilityValidation['checks'] = []
    try {
      validateSpec(detail.versions.find((item) => item.version === selected)!.spec)
      validateArtifact(artifact)
      checks.push({ name: 'manifest_and_build', ok: true })
    } catch (error) {
      checks.push({ name: 'manifest_and_build', ok: false, detail: String(error) })
    }
    if (checks[0].ok) {
      for (const test of artifact.tests) {
        try {
          if (!test || typeof test.name !== 'string') throw new Error('Invalid test')
          const actual = await runCapabilityHandler(artifact.handler, test.input, detail.versions.find((item) => item.version === selected)!.spec.timeoutMs ?? 60_000, test.httpMocks ?? [], this.versionPath(id, selected))
          if (!isDeepStrictEqual(actual, test.expected)) throw new Error(`Expected ${JSON.stringify(test.expected)}, got ${JSON.stringify(actual)}`)
          checks.push({ name: `test: ${test.name}`, ok: true })
        } catch (error) {
          checks.push({ name: `test: ${test?.name ?? 'unnamed'}`, ok: false, detail: String(error) })
        }
      }
      if (artifact.tests.length === 0) checks.push({ name: 'tests_required', ok: false, detail: 'At least one contract test is required' })
    }
    const result = { ok: checks.every((item) => item.ok), checks }
    this.db.transaction(() => {
      this.db.prepare('UPDATE capability_versions SET status = ?, validation_json = ? WHERE draft_id = ? AND version = ?')
        .run(result.ok ? 'ready' : 'failed', JSON.stringify(result), id, selected)
      if (selected === detail.draft.latestVersion) {
        this.db.prepare(`UPDATE capability_drafts SET
          status = CASE WHEN installed_version IS NULL THEN ? ELSE 'installed' END,
          updated_at = ? WHERE id = ?`)
          .run(result.ok ? 'ready' : 'failed', new Date().toISOString(), id)
      }
    })()
    return result
  }

  async execute(id: string, input: unknown, version?: number, signal?: AbortSignal): Promise<unknown> {
    const detail = this.get(id, version)
    const selected = version ?? detail.draft.installedVersion ?? detail.draft.latestVersion
    const record = detail.versions.find((item) => item.version === selected)
    if (!record || record.status !== 'ready') throw new Error('Capability version is not validated')
    const artifact = this.readArtifact(id, selected)
    const executionId = randomUUID()
    const started = new Date().toISOString()
    const inputHash = createHash('sha256').update(JSON.stringify(input ?? null)).digest('hex')
    try {
      const result = await runCapabilityHandler(
        artifact.handler,
        input,
        record.spec.timeoutMs ?? 60_000,
        undefined,
        this.versionPath(id, selected),
        signal
      )
      this.recordExecution(executionId, id, selected, started, 'success', inputHash, null)
      return result
    } catch (error) {
      this.recordExecution(
        executionId,
        id,
        selected,
        started,
        'failed',
        inputHash,
        String(error).slice(0, MAX_CAPABILITY_STDERR_CHARS)
      )
      throw error
    }
  }

  private recordExecution(
    id: string,
    draftId: string,
    version: number,
    startedAt: string,
    status: 'success' | 'failed',
    inputHash: string,
    error: string | null
  ): void {
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO capability_executions
        (id, draft_id, version, started_at, finished_at, status, input_hash, error)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id,
        draftId,
        version,
        startedAt,
        new Date().toISOString(),
        status,
        inputHash,
        error
      )
      pruneCapabilityExecutions(this.db, draftId)
    })()
  }

  install(id: string, version: number): CapabilityDraft {
    const detail = this.get(id, version)
    const selected = detail.versions.find((item) => item.version === version)
    if (!selected || selected.status !== 'ready') throw new Error('Only validated versions can be installed')
    this.db.prepare(`UPDATE capability_drafts SET installed_version = ?, status = 'installed', updated_at = ? WHERE id = ?`)
      .run(version, new Date().toISOString(), id)
    return this.get(id).draft
  }

  deactivate(id: string): CapabilityDraft {
    const detail = this.get(id)
    const status = detail.versions[0]?.status ?? 'draft'
    this.db.prepare(`UPDATE capability_drafts SET installed_version = NULL, status = ?, updated_at = ? WHERE id = ?`)
      .run(status, new Date().toISOString(), id)
    return this.get(id).draft
  }

  discard(id: string): void {
    const draft = this.get(id).draft
    if (draft.status === 'installed') throw new Error('Deactivate before discarding')
    this.db.prepare(`UPDATE capability_drafts SET status = 'discarded', updated_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), id)
    const target = resolve(this.artifactRoot, id)
    if (!target.startsWith(this.artifactRoot + sep)) throw new Error('Invalid artifact path')
    rmSync(target, { recursive: true, force: true })
  }

  close(): void { this.db.close() }

  private versionPath(id: string, version: number): string {
    if (!/^[0-9a-f-]{36}$/.test(id) || !Number.isSafeInteger(version) || version < 1) {
      throw new Error('Invalid artifact identifier')
    }
    return join(this.artifactRoot, id, String(version))
  }

  private readArtifact(id: string, version: number): CapabilityArtifactInput {
    const path = join(this.versionPath(id, version), 'artifact.json')
    const bytes = readFileSync(path, 'utf8')
    const row = this.db.prepare('SELECT artifact_hash FROM capability_versions WHERE draft_id = ? AND version = ?')
      .get(id, version) as { artifact_hash: string } | undefined
    if (!row || createHash('sha256').update(bytes).digest('hex') !== row.artifact_hash) {
      throw new Error('Capability artifact checksum mismatch')
    }
    const artifact = JSON.parse(bytes) as CapabilityArtifactInput
    for (const [file, contents] of Object.entries(artifact.files ?? {})) {
      if (readFileSync(resolve(this.versionPath(id, version), file), 'utf8') !== contents) {
        throw new Error('Capability artifact file checksum mismatch')
      }
    }
    return artifact
  }
}

let instance: CapabilityStudio | null = null
export function getCapabilityStudio(): CapabilityStudio {
  return instance ??= new CapabilityStudio()
}
