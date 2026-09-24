const { spawnSync } = require('node:child_process')
const {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} = require('node:fs')
const path = require('node:path')
const { buildSync } = require('esbuild')

const root = path.resolve(__dirname, '..')
const bundleDir = path.join(root, 'out', 'runtime-bundle')
const packageDir = path.join(root, 'out', 'runtime-package')
const bundlePath = path.join(bundleDir, 'index.cjs')
const packagedBundle = path.join(packageDir, 'index.cjs')
const runtimeHost = path.join(root, 'runtime-host')
const seaBootstrap = path.join(root, 'scripts', 'runtime-sea-bootstrap.cjs')
const executableName = process.platform === 'win32' ? 'octob-runtime.exe' : 'octob-runtime'
const executablePath = path.join(packageDir, executableName)

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    ...options
  })
  if (result.error || result.status !== 0) {
    throw result.error ?? new Error(`${command} exited with ${result.status}`)
  }
}

console.log('[octob] Preparing runtime native modules...')
run(process.execPath, [path.join(root, 'scripts', 'ensure-runtime-native-modules.cjs')])

console.log('[octob] Building browser UI...')
run(process.execPath, [
  path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'),
  'build',
  '--config',
  path.join(root, 'vite.web.config.ts')
])

rmSync(bundleDir, { recursive: true, force: true })
mkdirSync(bundleDir, { recursive: true })

console.log('[octob] Bundling runtime...')
buildSync({
  entryPoints: [path.join(root, 'src', 'runtime', 'index.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  tsconfig: path.join(root, 'tsconfig.runtime.json'),
  outfile: bundlePath,
  external: ['better-sqlite3', 'node-pty', 'electron'],
  logLevel: 'info'
})

rmSync(packageDir, { recursive: true, force: true })
mkdirSync(packageDir, { recursive: true })
copyFileSync(bundlePath, packagedBundle)

const builtWeb = path.join(root, 'out', 'web')
if (!existsSync(builtWeb)) {
  throw new Error('Browser UI build output was not generated')
}
console.log('[octob] Copying browser UI...')
cpSync(builtWeb, path.join(packageDir, 'web'), { recursive: true })

console.log('[octob] Copying isolated native host...')
const packagedRuntimeHost = path.join(packageDir, 'runtime-host')
mkdirSync(packagedRuntimeHost, { recursive: true })
copyFileSync(
  path.join(runtimeHost, 'package.json'),
  path.join(packagedRuntimeHost, 'package.json')
)
copyFileSync(
  path.join(runtimeHost, 'package-lock.json'),
  path.join(packagedRuntimeHost, 'package-lock.json')
)
cpSync(
  path.join(runtimeHost, 'node_modules'),
  path.join(packagedRuntimeHost, 'node_modules'),
  { recursive: true }
)

const whisperSource = path.join(root, 'resources', 'whisper.cpp')
if (existsSync(whisperSource)) {
  console.log('[octob] Copying Whisper sidecar...')
  cpSync(
    whisperSource,
    path.join(packageDir, 'resources', 'whisper.cpp'),
    { recursive: true }
  )
}

const seaBlob = path.join(packageDir, 'sea-prep.blob')
const seaConfig = path.join(packageDir, 'sea-config.json')
writeFileSync(
  seaConfig,
  JSON.stringify(
    {
      main: seaBootstrap,
      output: seaBlob,
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false
    },
    null,
    2
  )
)

console.log('[octob] Creating SEA blob...')
run(process.execPath, ['--experimental-sea-config', seaConfig])

copyFileSync(process.execPath, executablePath)
if (process.platform !== 'win32') chmodSync(executablePath, 0o755)

if (process.platform === 'darwin') {
  spawnSync('codesign', ['--remove-signature', executablePath], {
    stdio: 'inherit'
  })
}

const postjectCli = path.join(
  runtimeHost,
  'node_modules',
  'postject',
  'dist',
  'cli.js'
)
if (!existsSync(postjectCli)) {
  throw new Error('postject is not installed in runtime-host')
}

console.log('[octob] Injecting SEA payload...')
run(process.execPath, [
  postjectCli,
  executablePath,
  'NODE_SEA_BLOB',
  seaBlob,
  '--sentinel-fuse',
  'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'
])

rmSync(seaBlob, { force: true })
rmSync(seaConfig, { force: true })

const rootPackage = JSON.parse(
  readFileSync(path.join(root, 'package.json'), 'utf8')
)
writeFileSync(
  path.join(packageDir, 'runtime-manifest.json'),
  JSON.stringify(
    {
      name: 'octob-runtime',
      version: rootPackage.version,
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      protocol: 1
    },
    null,
    2
  )
)

console.log(`[octob] Runtime package ready: ${executablePath}`)
