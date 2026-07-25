import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'fs'
import { dirname, isAbsolute, relative, resolve } from 'path'
import { getImageMimeType } from '@shared/types/file-utils'

const MAX_FILE_SIZE = 1024 * 1024 // 1MB
const MAX_IMAGE_FILE_SIZE = 20 * 1024 * 1024 // 20MB

export function readFile(filePath: string): {
  success: boolean
  content?: string
  error?: string
} {
  try {
    if (!filePath || typeof filePath !== 'string') {
      return { success: false, error: 'Invalid file path' }
    }
    if (!existsSync(filePath)) {
      return { success: false, error: 'File does not exist' }
    }
    const stat = statSync(filePath)
    if (stat.isDirectory()) {
      return { success: false, error: 'Path is a directory' }
    }
    if (stat.size > MAX_FILE_SIZE) {
      return { success: false, error: 'File too large (max 1MB)' }
    }
    const content = readFileSync(filePath, 'utf-8')
    return { success: true, content }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export function readFileAsBase64(filePath: string): {
  success: boolean
  data?: string
  mimeType?: string
  error?: string
} {
  try {
    if (!filePath || typeof filePath !== 'string') {
      return { success: false, error: 'Invalid file path' }
    }
    if (!existsSync(filePath)) {
      return { success: false, error: 'File does not exist' }
    }
    const stat = statSync(filePath)
    if (stat.isDirectory()) {
      return { success: false, error: 'Path is a directory' }
    }
    if (stat.size > MAX_IMAGE_FILE_SIZE) {
      return { success: false, error: 'File too large (max 20MB)' }
    }
    const buffer = readFileSync(filePath)
    const data = buffer.toString('base64')
    const mimeType = getImageMimeType(filePath) ?? undefined
    return { success: true, data, mimeType }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export function writeFile(filePath: string, content: string): { success: boolean; error?: string } {
  try {
    if (!filePath || typeof filePath !== 'string') {
      return { success: false, error: 'Invalid file path' }
    }
    if (typeof content !== 'string') {
      return { success: false, error: 'Invalid content' }
    }
    if (!existsSync(filePath)) {
      return { success: false, error: 'File does not exist' }
    }
    const stat = statSync(filePath)
    if (stat.isDirectory()) {
      return { success: false, error: 'Path is a directory' }
    }
    writeFileSync(filePath, content, 'utf-8')
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export function createFile(
  worktreePath: string,
  relativePath: string,
  content: string = ''
): { success: boolean; filePath?: string; error?: string } {
  try {
    if (!worktreePath || typeof worktreePath !== 'string') {
      return { success: false, error: 'Invalid worktree path' }
    }
    if (!relativePath || typeof relativePath !== 'string') {
      return { success: false, error: 'Invalid file path' }
    }
    if (typeof content !== 'string') {
      return { success: false, error: 'Invalid content' }
    }

    const normalizedRelativePath = relativePath.trim().replace(/\\/g, '/')
    if (
      !normalizedRelativePath ||
      normalizedRelativePath.endsWith('/') ||
      isAbsolute(normalizedRelativePath) ||
      normalizedRelativePath
        .split('/')
        .some((segment) => segment === '..' || segment === '.' || segment === '')
    ) {
      return { success: false, error: 'Enter a relative file path inside the worktree' }
    }

    const root = resolve(worktreePath)
    const filePath = resolve(root, normalizedRelativePath)
    const relToRoot = relative(root, filePath)
    if (relToRoot.startsWith('..') || isAbsolute(relToRoot)) {
      return { success: false, error: 'File path must stay inside the worktree' }
    }

    if (existsSync(filePath)) {
      return { success: false, error: 'File already exists' }
    }

    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, content, 'utf-8')
    return { success: true, filePath }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}
