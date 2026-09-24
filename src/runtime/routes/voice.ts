import type { IncomingMessage, ServerResponse } from 'node:http'
import { spawn } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { get } from 'node:https'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { readJsonBody, writeJson, type JsonRecord } from '../http'

const MODEL = 'base-q5_1'
const MODEL_FILE = `ggml-${MODEL}.bin`
const MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_FILE}`
const VAD_FILE = 'ggml-silero-v6.2.0.bin'
const VAD_URL = `https://huggingface.co/ggml-org/whisper-vad/resolve/main/${VAD_FILE}`
const MAX_AUDIO_BYTES = 30 * 1024 * 1024

interface VoiceRouteContext {
  allowedOrigins: Set<string>
}

const modelDirectory = (): string =>
  join(homedir(), '.octob', 'models', 'whisper.cpp')
const modelPath = (): string => join(modelDirectory(), MODEL_FILE)
const vadPath = (): string => join(modelDirectory(), VAD_FILE)
function binaryName(): string {
  return process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
}

function resourceDirectory(): string {
  const configured = process.env.OCTOB_RESOURCE_DIR?.trim()
  return configured ? resolve(configured) : resolve(process.cwd(), 'resources')
}

function binaryPath(): string {
  const platformDirectory = join(
    resourceDirectory(),
    'whisper.cpp',
    `${process.platform}-${process.arch}`
  )
  const binary = join(platformDirectory, binaryName())
  if (existsSync(binary)) return binary
  const releaseBinary = join(platformDirectory, 'Release', binaryName())
  return process.platform === 'win32' && existsSync(releaseBinary)
    ? releaseBinary
    : binary
}

function status() {
  return {
    installed: existsSync(modelPath()) && existsSync(vadPath()),
    binaryAvailable: existsSync(binaryPath()),
    modelName: MODEL
  }
}
async function downloadAtomically(url: string, destination: string): Promise<void> {
  const temporary = `${destination}.${randomUUID()}.download`
  try {
    await download(url, temporary, 0)
    await rename(temporary, destination)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

function download(url: string, target: string, redirects: number): Promise<void> {
  if (redirects > 5) return Promise.reject(new Error('Too many redirects'))
  return new Promise((resolveDownload, rejectDownload) => {
    const request = get(url, (response) => {
      if (
        response.statusCode &&
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        response.resume()
        void download(
          new URL(response.headers.location, url).toString(),
          target,
          redirects + 1
        ).then(resolveDownload, rejectDownload)
        return
      }
      if (response.statusCode !== 200) {
        response.resume()
        rejectDownload(
          new Error(`Model download failed with HTTP ${response.statusCode ?? 'unknown'}`)
        )
        return
      }
      const output = createWriteStream(target, { flags: 'wx' })
      response.on('error', rejectDownload)
      output.on('error', rejectDownload)
      output.on('finish', () =>
        output.close((error) => error ? rejectDownload(error) : resolveDownload())
      )
      response.pipe(output)
    })
    request.setTimeout(60_000, () =>
      request.destroy(new Error('Model download timed out'))
    )
    request.on('error', rejectDownload)
  })
}

async function downloadModel(): Promise<{ success: boolean; error?: string }> {
  if (existsSync(modelPath()) && existsSync(vadPath())) return { success: true }
  await mkdir(modelDirectory(), { recursive: true })
  try {
    if (!existsSync(modelPath())) await downloadAtomically(MODEL_URL, modelPath())
    if (!existsSync(vadPath())) await downloadAtomically(VAD_URL, vadPath())
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Model download failed'
    }
  }
}
async function transcribe(audio: Buffer): Promise<
  | { success: true; text: string }
  | { success: false; code: 'model-missing' | 'binary-missing' | 'failed'; error: string }
> {
  if (!audio.length || audio.length > MAX_AUDIO_BYTES) {
    return { success: false, code: 'failed', error: 'Invalid recording size' }
  }
  if (!existsSync(binaryPath())) {
    return { success: false, code: 'binary-missing', error: 'Voice engine is not installed' }
  }
  if (!existsSync(modelPath()) || !existsSync(vadPath())) {
    return { success: false, code: 'model-missing', error: 'Voice model is not installed' }
  }

  const directory = join(tmpdir(), 'octob-voice')
  const id = randomUUID()
  const wav = join(directory, `${id}.wav`)
  const output = join(directory, id)
  const text = `${output}.txt`
  await mkdir(directory, { recursive: true })
  await writeFile(wav, audio)

  try {
    await new Promise<void>((resolveRun, rejectRun) => {
      const binary = binaryPath()
      const libraryDirectory = dirname(binary)
      const child = spawn(
        binary,
        [
          '-m', modelPath(),
          '-f', wav,
          '-l', 'pt',
          '-nt',
          '-otxt',
          '-of', output,
          '--vad',
          '-vm', vadPath(),
          '-vt', '0.65',
          '-vsd', '500',
          '-nth', '0.8'
        ],
        {
          windowsHide: true,
          stdio: ['ignore', 'ignore', 'pipe'],
          env: {
            ...process.env,
            LD_LIBRARY_PATH: [libraryDirectory, process.env.LD_LIBRARY_PATH]
              .filter(Boolean)
              .join(':'),
            DYLD_LIBRARY_PATH: [libraryDirectory, process.env.DYLD_LIBRARY_PATH]
              .filter(Boolean)
              .join(':')
          }
        }
      )

      let stderr = ''
      const timeout = setTimeout(() => child.kill(), 120_000)
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })
      child.once('error', rejectRun)
      child.once('close', (code) => {
        clearTimeout(timeout)
        code === 0
          ? resolveRun()
          : rejectRun(new Error(stderr || `whisper-cli exited with ${code}`))
      })
    })

    const result = (await readFile(text, 'utf8'))
      .replace(/\[?\s*(m[úu]sica de fundo|music|applause|aplausos)\s*\]?/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
    return result
      ? { success: true, text: result }
      : { success: false, code: 'failed', error: 'No speech was recognized' }
  } catch (error) {
    return {
      success: false,
      code: 'failed',
      error: error instanceof Error ? error.message : 'Transcription failed'
    }
  } finally {
    await Promise.all(
      [
        wav,
        text,
        `${output}.csv`,
        `${output}.json`,
        `${output}.srt`,
        `${output}.vtt`
      ].map((file) => rm(file, { force: true }))
    )
  }
}

export async function handleVoiceRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  context: VoiceRouteContext
): Promise<boolean> {
  if (!url.pathname.startsWith('/v1/voice/')) return false

  if (request.method === 'GET' && url.pathname === '/v1/voice/status') {
    writeJson(request, response, context.allowedOrigins, 200, status())
    return true
  }

  if (request.method === 'POST' && url.pathname === '/v1/voice/download') {
    writeJson(request, response, context.allowedOrigins, 200, await downloadModel())
    return true
  }
  if (request.method === 'POST' && url.pathname === '/v1/voice/transcribe') {
    const body = await readJsonBody<JsonRecord>(request, 42 * 1024 * 1024)
    if (typeof body.data !== 'string') {
      writeJson(request, response, context.allowedOrigins, 400, {
        success: false,
        code: 'failed',
        error: 'audio_required'
      })
      return true
    }
    const audio = Buffer.from(body.data, 'base64')
    writeJson(request, response, context.allowedOrigins, 200, await transcribe(audio))
    return true
  }

  return false
}
