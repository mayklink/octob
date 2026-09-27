import { ipcMain } from 'electron'
import { getCapabilityStudio } from '../services/capability-studio'

export function registerCapabilityStudioHandlers(): void {
  const studio = getCapabilityStudio()
  const executions = new Map<string, AbortController>()
  ipcMain.handle('capability:list', () => studio.list())
  ipcMain.handle('capability:get', (_event, id: string, version?: number) => studio.get(id, version))
  ipcMain.handle('capability:validate', (_event, id: string, version?: number) => studio.validate(id, version))
  ipcMain.handle('capability:execute', async (event, id: string, input: unknown, version?: number, executionId?: string) => {
    if (!executionId || executions.has(executionId)) throw new Error('Invalid or duplicate capability execution ID')
    const controller = new AbortController()
    const abortOnRendererDestroyed = (): void => controller.abort()
    executions.set(executionId, controller)
    event.sender.once('destroyed', abortOnRendererDestroyed)
    try {
      return await studio.execute(id, input, version, controller.signal)
    } finally {
      event.sender.removeListener('destroyed', abortOnRendererDestroyed)
      executions.delete(executionId)
    }
  })
  ipcMain.handle('capability:cancel-execution', (_event, executionId: string) => {
    const controller = executions.get(executionId)
    if (!controller) return false
    controller.abort()
    return true
  })
  ipcMain.handle('capability:install', (_event, id: string, version: number) => studio.install(id, version))
  ipcMain.handle('capability:deactivate', (_event, id: string) => studio.deactivate(id))
  ipcMain.handle('capability:discard', (_event, id: string) => studio.discard(id))
}
