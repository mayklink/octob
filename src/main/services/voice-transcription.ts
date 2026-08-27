import { app } from 'electron'
import { spawn } from 'child_process'
import { createWriteStream, existsSync } from 'fs'
import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises'
import { get } from 'https'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'

const MODEL = 'base-q5_1'
const MODEL_FILE = `ggml-${MODEL}.bin`
const MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_FILE}`
const VAD_FILE = 'ggml-silero-v6.2.0.bin'
const VAD_URL = `https://huggingface.co/ggml-org/whisper-vad/resolve/main/${VAD_FILE}`
const MAX_AUDIO_BYTES = 30 * 1024 * 1024

const modelDirectory = () => join(app.getPath('userData'), 'models', 'whisper.cpp')
const modelPath = () => join(modelDirectory(), MODEL_FILE)
const vadPath = () => join(modelDirectory(), VAD_FILE)
const binaryName = () => process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
const resourceDirectory = () => app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
const binaryPath = () => join(resourceDirectory(), 'whisper.cpp', `${process.platform}-${process.arch}`, binaryName())

export type VoiceResult =
  | { success: true; text: string }
  | { success: false; code: 'model-missing' | 'binary-missing' | 'failed'; error: string }

export function voiceStatus(): { installed: boolean; binaryAvailable: boolean; modelName: string } {
  return { installed: existsSync(modelPath()) && existsSync(vadPath()), binaryAvailable: existsSync(binaryPath()), modelName: MODEL }
}

export async function downloadVoiceModel(): Promise<{ success: boolean; error?: string }> {
  if (existsSync(modelPath()) && existsSync(vadPath())) return { success: true }
  await mkdir(modelDirectory(), { recursive: true })
  try {
    if (!existsSync(modelPath())) await downloadAtomically(MODEL_URL, modelPath())
    if (!existsSync(vadPath())) await downloadAtomically(VAD_URL, vadPath())
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Model download failed' }
  }
}

async function downloadAtomically(url: string, destination: string): Promise<void> {
  const temporary = `${destination}.${randomUUID()}.download`
  try { await download(url, temporary, 0); await rename(temporary, destination) }
  catch (error) { await rm(temporary, { force: true }); throw error }
}

function download(url: string, target: string, redirects: number): Promise<void> {
  if (redirects > 5) return Promise.reject(new Error('Too many redirects'))
  return new Promise((resolveDownload, rejectDownload) => {
    const request = get(url, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume()
        void download(new URL(response.headers.location, url).toString(), target, redirects + 1).then(resolveDownload, rejectDownload)
        return
      }
      if (response.statusCode !== 200) {
        response.resume()
        rejectDownload(new Error(`Model download failed with HTTP ${response.statusCode ?? 'unknown'}`))
        return
      }
      const output = createWriteStream(target, { flags: 'wx' })
      response.on('error', rejectDownload)
      output.on('error', rejectDownload)
      output.on('finish', () => output.close((error) => error ? rejectDownload(error) : resolveDownload()))
      response.pipe(output)
    })
    request.setTimeout(60_000, () => request.destroy(new Error('Model download timed out')))
    request.on('error', rejectDownload)
  })
}

export async function transcribeVoiceWav(audio: Buffer): Promise<VoiceResult> {
  if (!audio.length || audio.length > MAX_AUDIO_BYTES) return { success: false, code: 'failed', error: 'Invalid recording size' }
  if (!existsSync(binaryPath())) return { success: false, code: 'binary-missing', error: 'Voice engine is not installed' }
  if (!existsSync(modelPath())) return { success: false, code: 'model-missing', error: 'Voice model is not installed' }

  const directory = join(app.getPath('temp'), 'octob-voice')
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
      const child = spawn(binary, ['-m', modelPath(), '-f', wav, '-l', 'pt', '-nt', '-otxt', '-of', output, '--vad', '-vm', vadPath(), '-vt', '0.65', '-vsd', '500', '-nth', '0.8'], {
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe'],
        env: {
          ...process.env,
          LD_LIBRARY_PATH: [libraryDirectory, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':'),
          DYLD_LIBRARY_PATH: [libraryDirectory, process.env.DYLD_LIBRARY_PATH].filter(Boolean).join(':')
        }
      })
      let stderr = ''
      const timeout = setTimeout(() => child.kill(), 120_000)
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
      child.once('error', rejectRun)
      child.once('close', (code) => { clearTimeout(timeout); code === 0 ? resolveRun() : rejectRun(new Error(stderr || `whisper-cli exited with ${code}`)) })
    })
    const result = (await readFile(text, 'utf8'))
      .replace(/\[?\s*(m[úu]sica de fundo|music|applause|aplausos)\s*\]?/gi, '')
      .replace(/\s{2,}/g, ' ').trim()
    return result ? { success: true, text: result } : { success: false, code: 'failed', error: 'No speech was recognized' }
  } catch (error) {
    return { success: false, code: 'failed', error: error instanceof Error ? error.message : 'Transcription failed' }
  } finally {
    await Promise.all([wav, text, `${output}.csv`, `${output}.json`, `${output}.srt`, `${output}.vtt`].map((file) => rm(file, { force: true })))
  }
}
