const { test } = require('node:test')
const assert = require('node:assert/strict')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } = require('node:fs')
const esbuild = require('esbuild')

const root = resolve(__dirname, '..')
const temp = mkdtempSync(join(tmpdir(), 'octob-skills-test-'))
const bundle = join(temp, 'skills.cjs')
esbuild.buildSync({
  entryPoints: [join(root, 'src/main/services/assistant-skill-service.ts')],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  tsconfig: join(root, 'tsconfig.runtime.json')
})
const { AssistantSkillService } = require(bundle)

function createSkill(base, name, description = 'Use this skill for repeatable work.') {
  const directory = join(base, name)
  mkdirSync(join(directory, 'references'), { recursive: true })
  writeFileSync(join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\n# Workflow\nRead references/checklist.md when needed.\n`)
  writeFileSync(join(directory, 'references', 'checklist.md'), '# Checklist\n')
  return directory
}

test('lists global and selected project skills, then reads instructions and references', () => {
  const globalRoot = join(temp, 'global')
  const projectPath = join(temp, 'project')
  createSkill(globalRoot, 'review-pr')
  createSkill(join(projectPath, '.octob', 'skills'), 'release-notes')
  const service = new AssistantSkillService({ getProject: (id) => id === 'project-1' ? { path: projectPath } : null }, globalRoot, join(temp, 'empty-builtins'))

  assert.deepEqual(service.list().skills.map((skill) => skill.id), ['global:review-pr'])
  assert.deepEqual(service.list('project-1').skills.map((skill) => skill.id), ['global:review-pr', 'project:release-notes'])
  assert.match(service.read('project:release-notes', 'project-1').content, /# Workflow/)
  assert.equal(service.read('project:release-notes', 'project-1', 'references/checklist.md').content, '# Checklist\n')
  assert.throws(() => service.read('project:release-notes'), /Project not found/)
})

test('rejects invalid manifests, traversal and symlinked references', () => {
  const globalRoot = join(temp, 'unsafe-global')
  const directory = createSkill(globalRoot, 'safe-skill')
  createSkill(globalRoot, 'bad-skill')
  writeFileSync(join(globalRoot, 'bad-skill', 'SKILL.md'), '---\nname: other-name\ndescription: Wrong directory\n---\n')
  const service = new AssistantSkillService({ getProject: () => null }, globalRoot, join(temp, 'empty-builtins'))

  assert.deepEqual(service.list().skills.map((skill) => skill.id), ['global:safe-skill'])
  assert.equal(service.list().errors.length, 1)
  assert.throws(() => service.read('global:../safe-skill'), /Invalid skill ID/)
  assert.throws(() => service.read('global:safe-skill', undefined, 'references/../SKILL.md'), /Reference leaves references directory/)
  assert.throws(() => service.read('global:safe-skill', undefined, 'references/../../secret.md'), /Reference leaves references directory/)

  const outside = join(temp, 'outside.md')
  writeFileSync(outside, 'secret')
  try {
    symlinkSync(outside, join(directory, 'references', 'linked.md'))
    assert.throws(() => service.read('global:safe-skill', undefined, 'references/linked.md'), /Symbolic links are not allowed/)
  } catch (error) {
    if (error.code !== 'EPERM') throw error // Windows without Developer Mode cannot create file symlinks.
  }
})

test('creates and removes a skill through the managed service', () => {
  const globalRoot = join(temp, 'managed-global')
  const projectPath = join(temp, 'managed-project')
  mkdirSync(projectPath)
  const service = new AssistantSkillService({ getProject: (id) => id === 'project-1' ? { path: projectPath } : null }, globalRoot, join(temp, 'empty-builtins'))

  const globalSkill = service.create({ name: 'write-summary', description: 'Summarize the work: clearly.', instructions: '# Steps\n1. Read the changes.' })
  assert.equal(globalSkill.id, 'global:write-summary')
  assert.match(service.read(globalSkill.id).content, /Summarize the work: clearly\./)
  assert.throws(() => service.create({ name: 'write-summary', description: 'Duplicate', instructions: '# Steps' }), /EEXIST/)
  assert.throws(() => service.create({ name: '../escape', description: 'Bad', instructions: '# Steps' }), /Invalid skill name/)
  assert.throws(() => service.create({ name: 'empty', description: 'Bad', instructions: ' ' }), /instructions are required/)

  const projectSkill = service.create({ name: 'release-check', description: 'Review a release.', instructions: '# Verify', projectId: 'project-1' })
  assert.equal(projectSkill.id, 'project:release-check')
  assert.throws(() => service.delete(projectSkill.id), /Project is required/)
  service.delete(projectSkill.id, 'project-1')
  assert.deepEqual(service.list('project-1').skills.map((skill) => skill.id), ['global:write-summary'])
  service.delete(globalSkill.id)
  assert.deepEqual(service.list().skills, [])
})

test('lists and reads bundled skills without allowing them to be deleted', () => {
  const globalRoot = join(temp, 'builtin-global')
  const builtinRoot = join(temp, 'builtin-root')
  createSkill(builtinRoot, 'definir-tarefa', 'Qualify software tasks and define verifiable success criteria.')
  const service = new AssistantSkillService({ getProject: () => null }, globalRoot, builtinRoot)

  assert.deepEqual(service.list().skills.map((skill) => skill.id), ['builtin:definir-tarefa'])
  assert.match(service.read('builtin:definir-tarefa').content, /# Workflow/)
  assert.throws(() => service.delete('builtin:definir-tarefa'), /Invalid skill ID/)
})

test('a user global skill takes precedence over a bundled skill with the same name', () => {
  const globalRoot = join(temp, 'duplicate-global')
  const builtinRoot = join(temp, 'duplicate-builtins')
  createSkill(globalRoot, 'definir-tarefa', 'User edition.')
  createSkill(builtinRoot, 'definir-tarefa', 'Bundled edition.')
  const service = new AssistantSkillService({ getProject: () => null }, globalRoot, builtinRoot)

  assert.deepEqual(service.list().skills.map((skill) => skill.id), ['global:definir-tarefa'])
  assert.match(service.read('global:definir-tarefa').content, /User edition/)
})

process.once('exit', () => rmSync(temp, { recursive: true, force: true }))
