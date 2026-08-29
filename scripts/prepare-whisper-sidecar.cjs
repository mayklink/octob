#!/usr/bin/env node

/* Build the pinned whisper.cpp CLI for the host release target. */
const { execFileSync } = require('child_process')
const { cpSync, existsSync, lstatSync, mkdtempSync, mkdirSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } = require('fs')
const { join } = require('path')
const { tmpdir } = require('os')

const WHISPER_REF = 'b4938'
const WHISPER_REPOSITORY = 'https://github.com/ggml-org/whisper.cpp.git'
const architectures = process.platform === 'darwin' ? ['arm64', 'x64'] : [process.arch]
const root = process.cwd()

function run(command, args) {
  execFileSync(command, args, { cwd: root, stdio: 'inherit' })
}

for (const architecture of architectures) {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'octob-whisper-'))
  const source = join(temporaryRoot, 'source')
  const build = join(temporaryRoot, 'build')
  const output = join(root, 'resources', 'whisper.cpp', `${process.platform}-${architecture}`)
  try {
    run('git', ['clone', '--depth', '1', '--branch', WHISPER_REF, WHISPER_REPOSITORY, source])
    const cmakeArgs = [
      '-S', source,
      '-B', build,
      '-DCMAKE_BUILD_TYPE=Release',
      '-DCMAKE_BUILD_RPATH=$ORIGIN',
      '-DCMAKE_INSTALL_RPATH=$ORIGIN',
      '-DCMAKE_BUILD_WITH_INSTALL_RPATH=ON'
    ]
    if (process.platform === 'darwin') cmakeArgs.push(`-DCMAKE_OSX_ARCHITECTURES=${architecture}`)
    run('cmake', cmakeArgs)
    run('cmake', ['--build', build, '--target', 'whisper-cli', '--config', 'Release', '-j', '4'])
    const binariesRoot = join(build, 'bin')
    if (!existsSync(binariesRoot)) throw new Error('whisper.cpp did not produce a bin directory')
    const releaseBinaries = join(binariesRoot, 'Release')
    const binaries = process.platform === 'win32' && existsSync(releaseBinaries)
      ? releaseBinaries
      : binariesRoot
    rmSync(output, { recursive: true, force: true })
    mkdirSync(output, { recursive: true })
    cpSync(binaries, output, { recursive: true, dereference: true })
    if (process.platform === 'linux') {
      for (const file of readdirSync(output)) {
        const filePath = join(output, file)
        if (lstatSync(filePath).isSymbolicLink()) unlinkSync(filePath)
      }
      for (const file of readdirSync(output)) {
        const match = /^(lib.+\.so)\.(\d+)(?:\.\d+)*$/.exec(file)
        if (!match) continue
        const soname = join(output, `${match[1]}.${match[2]}`)
        if (!existsSync(soname)) symlinkSync(file, soname)
      }
    }
    writeFileSync(join(output, 'manifest.json'), JSON.stringify({ ref: WHISPER_REF, architecture }, null, 2))
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
}
