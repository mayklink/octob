import { ipcMain } from 'electron'
import { createPetWindow, destroyPetWindow, focusMainWindowFromPet } from '../services/pet-window'

export function registerPetHandlers(): void {
  ipcMain.handle('assistant:show', () => createPetWindow())
  ipcMain.handle('assistant:hide', () => destroyPetWindow())
  ipcMain.on('assistant:open', () => focusMainWindowFromPet())
}
