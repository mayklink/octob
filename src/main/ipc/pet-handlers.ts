import { ipcMain } from 'electron'
import { getDatabase } from '../db'
import { ensureGlobalAssistantConnection } from '../services/global-assistant'
import { createPetWindow, destroyPetWindow, focusMainWindowFromPet } from '../services/pet-window'

export function registerPetHandlers(): void {
  ipcMain.handle('assistant:ensure-global-connection', async () =>
    ensureGlobalAssistantConnection(getDatabase())
  )
  ipcMain.handle('assistant:show', () => createPetWindow())
  ipcMain.handle('assistant:hide', () => destroyPetWindow())
  ipcMain.on('assistant:open', () => focusMainWindowFromPet())
}
