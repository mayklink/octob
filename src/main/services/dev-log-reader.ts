import { closeSync, fstatSync, openSync, readSync, readdirSync, statSync } from 'fs'
import { basename, join } from 'path'

const DEFAULT_PAGE_SIZE = 100
const MAX_PAGE_SIZE = 250
const READ_CHUNK_BYTES = 64 * 1024
const MAX_SCAN_BYTES = 8 * 1024 * 1024
const MAX_RESPONSE_BYTES = 1024 * 1024
const LOG_FILE_PATTERN = /^octob-\d{4}-\d{2}-\d{2}(?:-\d{3,})?\.log$/
const ENTRY_MARKER = /\[(\d{4}-\d{2}-\d{2}T[^\]]+)\]\s+\[(DEBUG|INFO|WARN|ERROR)\]\s+\[([^\]\r\n]+)\]\s*/g

export interface DevLogFile {
  name: string
  size: number
  modifiedAt: string
}

export interface DevLogEntry {
  timestamp: string
  level: string
  component: string
  message: string
  raw: string
  truncated?: boolean
}

export interface DevLogPage {
  entries: DevLogEntry[]
  nextBefore: number | null
  fileSize: number
}

export function listDevLogFiles(logDir: string): DevLogFile[] {
  try {
    return readdirSync(logDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && LOG_FILE_PATTERN.test(entry.name))
      .map((entry) => {
        const path = join(logDir, entry.name)
        const stat = statSync(path)
        return { name: entry.name, size: stat.size, modifiedAt: stat.mtime.toISOString() }
      })
      .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt) || b.name.localeCompare(a.name))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

export function readDevLogPage(
  logDir: string,
  fileName: string,
  before?: number,
  requestedLimit = DEFAULT_PAGE_SIZE
): DevLogPage {
  if (
    typeof fileName !== 'string' ||
    basename(fileName) !== fileName ||
    !LOG_FILE_PATTERN.test(fileName)
  ) {
    throw new Error('Invalid log file name')
  }

  const path = join(logDir, fileName)
  const fd = openSync(path, 'r')
  try {
    const fileSize = fstatSync(fd).size
    if (before !== undefined && !Number.isFinite(before)) throw new Error('Invalid log cursor')
    if (!Number.isFinite(requestedLimit)) throw new Error('Invalid page size')
    const end = before === undefined ? fileSize : Math.max(0, Math.min(fileSize, Math.floor(before)))
    const limit = Math.max(1, Math.min(MAX_PAGE_SIZE, Math.floor(requestedLimit) || DEFAULT_PAGE_SIZE))
    let cursor = end
    let scannedBytes = 0
    let lastCountedBytes = 0
    const chunks: Buffer[] = []
    let matches: RegExpExecArray[] = []

    while (cursor > 0 && scannedBytes < MAX_SCAN_BYTES) {
      const bytesToRead = Math.min(READ_CHUNK_BYTES, cursor, MAX_SCAN_BYTES - scannedBytes)
      cursor -= bytesToRead
      const chunk = Buffer.allocUnsafe(bytesToRead)
      const bytesRead = readSync(fd, chunk, 0, bytesToRead, cursor)
      if (bytesRead === 0) break
      chunks.unshift(chunk.subarray(0, bytesRead))
      scannedBytes += bytesRead

      if (scannedBytes - lastCountedBytes >= READ_CHUNK_BYTES * 4 || cursor === 0 || scannedBytes >= MAX_SCAN_BYTES) {
        const asBytes = Buffer.concat(chunks, scannedBytes).toString('latin1')
        ENTRY_MARKER.lastIndex = 0
        matches = [...asBytes.matchAll(ENTRY_MARKER)]
        lastCountedBytes = scannedBytes
        if (matches.length > limit) break
      }
    }

    const scanned = Buffer.concat(chunks, scannedBytes)
    const asBytes = scanned.toString('latin1')
    const startOffset = cursor
    const firstIncludedMatchIndex = Math.max(0, matches.length - limit)
    const includedMatches = matches.slice(firstIncludedMatchIndex)
    if (includedMatches.length === 0) {
      return { entries: [], nextBefore: null, fileSize }
    }

    const entries: DevLogEntry[] = []
    let responseBytes = 0
    let droppedEntries = 0
    for (let i = 0; i < includedMatches.length; i++) {
      const match = includedMatches[i]
      const blockStart = match.index ?? 0
      const blockEnd = includedMatches[i + 1]?.index ?? asBytes.length
      let raw = scanned.subarray(blockStart, blockEnd).toString('utf8').replace(/\r?\n+$/, '')
      let truncated = false
      const byteLength = Buffer.byteLength(raw, 'utf8')
      if (byteLength > MAX_RESPONSE_BYTES) {
        raw = Buffer.from(raw, 'utf8').subarray(-MAX_RESPONSE_BYTES).toString('utf8')
        truncated = true
      }
      const entryBytes = Buffer.byteLength(raw, 'utf8')
      while (responseBytes + entryBytes > MAX_RESPONSE_BYTES && entries.length > 0) {
        responseBytes -= Buffer.byteLength(entries.shift()!.raw, 'utf8')
        droppedEntries++
      }
      const headerLength = match[0].length
      entries.push({
        timestamp: match[1],
        level: match[2],
        component: match[3],
        message: raw.slice(headerLength),
        raw,
        ...(truncated ? { truncated: true } : {})
      })
      responseBytes += entryBytes
    }

    const firstReturnedMatch = includedMatches[droppedEntries]
    const absoluteStart = startOffset + (firstReturnedMatch?.index ?? 0)
    const nextBefore = absoluteStart > 0 ? absoluteStart : null
    return { entries, nextBefore, fileSize }
  } finally {
    closeSync(fd)
  }
}
