import { ipcMain } from 'electron'
import { createLogger } from '../services/logger'
import { createFile, readFile, readFileAsBase64, writeFile } from '../services/file-ops'

const log = createLogger({ component: 'FileHandlers' })

export function registerFileHandlers(): void {
  log.info('Registering file handlers')

  ipcMain.handle(
    'file:read',
    async (
      _event,
      filePath: string
    ): Promise<{
      success: boolean
      content?: string
      error?: string
    }> => {
      const result = readFile(filePath)
      if (!result.success) {
        log.error('Failed to read file', new Error(result.error ?? 'Unknown error'), { filePath })
      }
      return result
    }
  )

  ipcMain.handle(
    'file:readImageAsBase64',
    async (
      _event,
      filePath: string
    ): Promise<{
      success: boolean
      data?: string
      mimeType?: string
      error?: string
    }> => {
      const result = readFileAsBase64(filePath)
      if (!result.success) {
        log.error('Failed to read image as base64', new Error(result.error ?? 'Unknown error'), {
          filePath
        })
      }
      return result
    }
  )

  ipcMain.handle(
    'file:write',
    async (
      _event,
      filePath: string,
      content: string
    ): Promise<{
      success: boolean
      error?: string
    }> => {
      const result = writeFile(filePath, content)
      if (!result.success) {
        log.error('Failed to write file', new Error(result.error ?? 'Unknown error'), { filePath })
      }
      return result
    }
  )

  ipcMain.handle(
    'file:create',
    async (
      _event,
      worktreePath: string,
      relativePath: string,
      content: string = ''
    ): Promise<{
      success: boolean
      filePath?: string
      error?: string
    }> => {
      const result = createFile(worktreePath, relativePath, content)
      if (!result.success) {
        log.error('Failed to create file', new Error(result.error ?? 'Unknown error'), {
          worktreePath,
          relativePath
        })
      }
      return result
    }
  )

}
