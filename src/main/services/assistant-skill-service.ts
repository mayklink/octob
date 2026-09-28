import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { DatabaseService } from '../db/database'
import type { AssistantSkillSummary, AssistantSkillList, CreateAssistantSkillInput } from '../../shared/types/assistant-skill'

const yaml = require('js-yaml') as {
  load: (source: string) => unknown
  dump: (value: unknown, options?: { lineWidth?: number }) => string
}
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_SKILL_BYTES = 128 * 1024
const MAX_REFERENCE_BYTES = 256 * 1024

function readRegularFile(path: string, maxBytes: number): string {
  const info = lstatSync(path)
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Expected a regular file')
  if (info.size > maxBytes) throw new Error('File is too large')
  return readFileSync(path, 'utf8')
}

function readSkillManifest(path: string): { name: string; description: string; content: string } {
  const content = readRegularFile(path, MAX_SKILL_BYTES)
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)
  if (!match) throw new Error('SKILL.md needs YAML front matter')
  const metadata = yaml.load(match[1])
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error('Invalid skill metadata')
  }
  const fields = metadata as Record<string, unknown>
  const name = fields.name
  const description = fields.description
  if (typeof name !== 'string' || !SKILL_NAME.test(name) || name.length > 64) {
    throw new Error('Invalid skill name')
  }
  if (typeof description !== 'string' || !description.trim() || description.length > 1024) {
    throw new Error('Invalid skill description')
  }
  if (basename(resolve(path, '..')) !== name) throw new Error('Skill name must match its directory')
  return { name, description: description.trim(), content }
}

function skillRoot(scope: 'global' | 'project', projectPath?: string, globalRoot?: string): string {
  if (scope === 'global') return globalRoot ?? join(homedir(), '.octob', 'skills')
  if (!projectPath) throw new Error('Project is required')
  if (!statSync(projectPath).isDirectory()) throw new Error('Project directory is unavailable')
  const configDirectory = join(realpathSync(projectPath), '.octob')
  try {
    if (lstatSync(configDirectory).isSymbolicLink()) throw new Error('Project skill directory cannot be a symbolic link')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return join(configDirectory, 'skills')
}

function safeSkillDirectory(root: string, name: string): string {
  if (!SKILL_NAME.test(name) || name.length > 64) throw new Error('Invalid skill ID')
  const directory = join(root, name)
  const info = lstatSync(directory)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Expected a skill directory')
  return directory
}

function readReference(directory: string, reference: string): string {
  if (isAbsolute(reference) || reference.includes('\\') || !/^references\/[a-zA-Z0-9_./-]+\.md$/.test(reference)) {
    throw new Error('Invalid reference path')
  }
  const target = resolve(directory, reference)
  if (!target.startsWith(resolve(directory, 'references') + sep)) throw new Error('Reference leaves references directory')
  const parts = relative(directory, target).split(sep)
  let current = directory
  for (const part of parts) {
    current = join(current, part)
    if (lstatSync(current).isSymbolicLink()) throw new Error('Symbolic links are not allowed')
  }
  if (!realpathSync(target).startsWith(realpathSync(directory) + sep)) {
    throw new Error('Reference leaves skill directory')
  }
  return readRegularFile(target, MAX_REFERENCE_BYTES)
}

function resolveBundledSkillRoot(): string {
  const candidates = [
    join(__dirname, 'resources', 'assistant-skills'),
    join(__dirname, '../../resources/assistant-skills'),
    join(__dirname, '../../../resources/assistant-skills'),
    join(process.cwd(), 'resources/assistant-skills')
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]
}

export class AssistantSkillService {
  constructor(
    private readonly db: Pick<DatabaseService, 'getProject'>,
    private readonly globalRoot = join(homedir(), '.octob', 'skills'),
    private readonly bundledRoot = resolveBundledSkillRoot()
  ) {}

  private rootForProject(projectId?: string): { scope: 'global' | 'project'; root: string } {
    if (projectId === undefined) return { scope: 'global', root: this.globalRoot }
    if (!projectId.trim()) throw new Error('Project is required')
    const project = this.db.getProject(projectId)
    if (!project) throw new Error('Project not found')
    return { scope: 'project', root: skillRoot('project', project.path) }
  }

  create(input: CreateAssistantSkillInput): AssistantSkillSummary {
    const name = input.name?.trim()
    const description = input.description?.trim()
    const instructions = input.instructions?.trim()
    if (!name || !SKILL_NAME.test(name) || name.length > 64) throw new Error('Invalid skill name')
    if (!description || description.length > 1024) throw new Error('Invalid skill description')
    if (!instructions) throw new Error('Skill instructions are required')
    const { scope, root } = this.rootForProject(input.projectId)
    const content = `---\n${yaml.dump({ name, description }, { lineWidth: -1 })}---\n\n${instructions}\n`
    if (Buffer.byteLength(content, 'utf8') > MAX_SKILL_BYTES) throw new Error('Skill is too large')
    mkdirSync(root, { recursive: true })
    if (lstatSync(root).isSymbolicLink()) throw new Error('Skill root cannot be a symbolic link')
    const directory = join(root, name)
    mkdirSync(directory)
    try {
      writeFileSync(join(directory, 'SKILL.md'), content, { flag: 'wx' })
      return this.read(`${scope}:${name}`, input.projectId).skill
    } catch (error) {
      try { unlinkSync(join(directory, 'SKILL.md')) } catch { /* The write may have failed. */ }
      try { rmdirSync(directory) } catch { /* Preserve anything added concurrently. */ }
      throw error
    }
  }

  delete(skillId: string, projectId?: string): void {
    const match = /^(global|project):([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(skillId)
    if (!match) throw new Error('Invalid skill ID')
    const scope = match[1] as 'global' | 'project'
    if (scope === 'project' && !projectId) throw new Error('Project is required')
    const selected = this.rootForProject(scope === 'project' ? projectId : undefined)
    if (lstatSync(selected.root).isSymbolicLink()) throw new Error('Skill root cannot be a symbolic link')
    const directory = safeSkillDirectory(selected.root, match[2])
    readSkillManifest(join(directory, 'SKILL.md'))
    const rootPath = realpathSync(selected.root)
    const directoryPath = realpathSync(directory)
    if (!directoryPath.startsWith(rootPath + sep)) throw new Error('Skill is outside its root')
    // The resolved path was checked against the selected root before recursive removal.
    rmSync(directoryPath, { recursive: true })
  }

  list(projectId?: string): AssistantSkillList {
    const roots: Array<{ scope: 'global' | 'project' | 'builtin'; path: string; projectId?: string }> = [
      { scope: 'global', path: skillRoot('global', undefined, this.globalRoot) },
      { scope: 'builtin', path: this.bundledRoot }
    ]
    if (projectId) {
      const project = this.db.getProject(projectId)
      if (!project) throw new Error('Project not found')
      roots.push({ scope: 'project', path: skillRoot('project', project.path), projectId })
    }
    const result: AssistantSkillList = { skills: [], errors: [] }
    for (const root of roots) {
      try {
        if (lstatSync(root.path).isSymbolicLink()) throw new Error('Skill root cannot be a symbolic link')
        for (const entry of readdirSync(root.path, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue
          const directory = join(root.path, entry.name)
          try {
            const skill = readSkillManifest(join(directory, 'SKILL.md'))
            if (root.scope === 'builtin' && result.skills.some((item) => item.scope === 'global' && item.name === skill.name)) {
              continue
            }
            result.skills.push({
              id: `${root.scope}:${skill.name}`,
              name: skill.name,
              description: skill.description,
              scope: root.scope,
              ...(root.projectId ? { projectId: root.projectId } : {})
            })
          } catch (error) {
            result.errors.push({ path: directory, error: String(error) })
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          result.errors.push({ path: root.path, error: String(error) })
        }
      }
    }
    return result
  }

  read(skillId: string, projectId?: string, reference?: string): {
    skill: AssistantSkillSummary
    content: string
    reference?: string
  } {
    const match = /^(global|project|builtin):([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(skillId)
    if (!match) throw new Error('Invalid skill ID')
    const scope = match[1] as 'global' | 'project' | 'builtin'
    const name = match[2]
    const project = scope === 'project' ? this.db.getProject(projectId ?? '') : null
    if (scope === 'project' && !project) throw new Error('Project not found')
    const root = scope === 'builtin'
      ? this.bundledRoot
      : skillRoot(scope, project?.path, this.globalRoot)
    if (lstatSync(root).isSymbolicLink()) throw new Error('Skill root cannot be a symbolic link')
    const directory = safeSkillDirectory(root, name)
    const manifest = readSkillManifest(join(directory, 'SKILL.md'))
    const skill: AssistantSkillSummary = {
      id: skillId,
      name: manifest.name,
      description: manifest.description,
      scope,
      ...(projectId && scope === 'project' ? { projectId } : {})
    }
    return {
      skill,
      content: reference ? readReference(directory, reference) : manifest.content,
      ...(reference ? { reference } : {})
    }
  }
}
