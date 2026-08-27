import { ipcMain } from 'electron'
import { downloadVoiceModel, transcribeVoiceWav, voiceStatus } from '../services/voice-transcription'

export function registerVoiceTranscriptionHandlers(): void {
  ipcMain.handle('voice:status', () => voiceStatus())
  ipcMain.handle('voice:downloadModel', () => downloadVoiceModel())
  ipcMain.handle('voice:transcribe', (_event, audio: Buffer) => transcribeVoiceWav(audio))
}
