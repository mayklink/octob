import { useState, useMemo } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { wireValueToPrettyString } from '@/lib/tool-wire-display'
import type { ToolViewProps } from './types'
import { getPrismLanguage } from '@/lib/language-map'

const MAX_PREVIEW_LINES = 20

interface ReadLineRange {
  start: number
  end: number
}

interface ParsedReadLine {
  lineNumber: number | null
  content: string
}

// Output format from OpenCode Read tool:
//   <file>
//   00001| line content
//   00002| line content
//   ...
//   (End of file - total N lines)
//   </file>
const LINE_PREFIX_RE = /^(\s*\d+)\s*[|│\t]\s?/

/** Parse Read tool output, stripping wrapper tags and line number prefixes */
function parseReadOutput(output: string): {
  lines: ParsedReadLine[]
  content: string
  startLine: number
  lineCount: number
} {
  let rawLines = output.split('\n')

  // Strip <file>...</file> wrapper and footer
  if (rawLines[0]?.trim() === '<file>') {
    rawLines = rawLines.slice(1)
  }
  // Remove closing </file> tag and "(End of file ...)" footer from the end
  while (rawLines.length > 0) {
    const last = rawLines[rawLines.length - 1].trim()
    if (last === '</file>' || last === '' || last.startsWith('(End of file')) {
      rawLines.pop()
    } else {
      break
    }
  }

  // Check if remaining lines have number prefixes
  const firstNonEmpty = rawLines.find((l) => l.trim())
  if (!firstNonEmpty || !LINE_PREFIX_RE.test(firstNonEmpty)) {
    const lines = rawLines.map((line) => ({ lineNumber: null, content: line }))
    return { lines, content: rawLines.join('\n'), startLine: 1, lineCount: rawLines.length }
  }

  let startLine = 1
  const contentLines: string[] = []
  const lines: ParsedReadLine[] = []
  for (let i = 0; i < rawLines.length; i++) {
    const match = rawLines[i].match(LINE_PREFIX_RE)
    if (match) {
      if (contentLines.length === 0) startLine = parseInt(match[1], 10)
      const content = rawLines[i].slice(match[0].length)
      const lineNumber = Number.parseInt(match[1], 10)
      contentLines.push(content)
      lines.push({
        lineNumber: Number.isFinite(lineNumber) ? lineNumber : null,
        content
      })
    } else {
      contentLines.push(rawLines[i])
      lines.push({ lineNumber: null, content: rawLines[i] })
    }
  }

  return { lines, content: contentLines.join('\n'), startLine, lineCount: contentLines.length }
}

function extractLineRanges(value: unknown): ReadLineRange[] {
  if (!Array.isArray(value)) return []

  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
      const start = Number((entry as { start?: unknown }).start)
      const end = Number((entry as { end?: unknown }).end)
      if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end < start) {
        return null
      }
      return { start, end }
    })
    .filter((entry): entry is ReadLineRange => entry !== null)
}

function formatLineRanges(lineRanges: ReadLineRange[]): string {
  if (lineRanges.length === 0) return ''
  return lineRanges
    .map((range) => (range.start === range.end ? `${range.start}` : `${range.start}–${range.end}`))
    .join(', ')
}

export function ReadToolView({ input, output, error }: ToolViewProps) {
  const [showAll, setShowAll] = useState(false)

  const errorStr = error !== undefined && error !== null ? wireValueToPrettyString(error) : ''
  const outputStr = output !== undefined && output !== null ? wireValueToPrettyString(output) : ''

  const filePath = (input.file_path || input.filePath || input.path || '') as string
  const offset = input.offset as number | undefined
  const limit = input.limit as number | undefined
  const lineRanges = useMemo(() => extractLineRanges(input.line_ranges), [input.line_ranges])

  const language = useMemo(() => (filePath ? getPrismLanguage(filePath) : 'text'), [filePath])

  if (errorStr.length > 0) {
    return (
      <div className="text-red-400 font-mono text-xs whitespace-pre-wrap break-all">{errorStr}</div>
    )
  }

  if (!outputStr) return null

  const parsed = parseReadOutput(outputStr)
  const exactNumberedMode = lineRanges.length > 0 && parsed.lines.some((line) => line.lineNumber !== null)
  const startLine = offset || parsed.startLine
  const lineRange =
    lineRanges.length > 0
      ? `Lines ${formatLineRanges(lineRanges)}`
      : offset && limit
        ? `Lines ${offset}–${offset + limit}`
        : offset
          ? `From line ${offset}`
          : limit
            ? `First ${limit} lines`
            : ''
  const needsTruncation = parsed.lineCount > MAX_PREVIEW_LINES
  const displayedContent = showAll
    ? parsed.content
    : parsed.lines
        .slice(0, MAX_PREVIEW_LINES)
        .map((line) => line.content)
        .join('\n')
  const displayedLines = showAll ? parsed.lines : parsed.lines.slice(0, MAX_PREVIEW_LINES)

  return (
    <div data-testid="read-tool-view">
      {/* Line range info */}
      {lineRange && <div className="text-muted-foreground/60 text-[10px] mb-1.5">{lineRange}</div>}

      {/* Syntax-highlighted code block for contiguous reads */}
      {!exactNumberedMode && (
        <div className="rounded-md overflow-hidden">
          <SyntaxHighlighter
            language={language}
            style={oneDark}
            showLineNumbers
            startingLineNumber={startLine}
            wrapLines
            customStyle={{
              margin: 0,
              borderRadius: '0.375rem',
              fontSize: '12px',
              lineHeight: '18px',
              padding: '8px 0'
            }}
            lineNumberStyle={{
              minWidth: '2.5em',
              paddingRight: '1em',
              color: '#52525b',
              userSelect: 'none'
            }}
            codeTagProps={{
              style: {
                fontFamily: 'var(--font-mono)'
              }
            }}
          >
            {displayedContent}
          </SyntaxHighlighter>
        </div>
      )}

      {/* Exact numbered excerpt renderer for discontinuous nl|sed reads */}
      {exactNumberedMode && (
        <div className="rounded-md overflow-hidden bg-[#282c34] px-0 py-2">
          <div className="font-mono text-xs leading-[18px]">
            {displayedLines.map((line, index) => (
              <div
                key={`${line.lineNumber ?? 'line'}-${index}`}
                className="grid grid-cols-[auto,1fr] gap-4 px-3"
              >
                <span className="min-w-[2.5em] text-right text-[#52525b] select-none">
                  {line.lineNumber ?? ''}
                </span>
                <code className="whitespace-pre-wrap break-all text-zinc-100">
                  {line.content || ' '}
                </code>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Show all button */}
      {needsTruncation && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="flex items-center gap-1 mt-2 text-blue-400 hover:text-blue-300 text-xs font-medium transition-colors"
          data-testid="show-all-button"
        >
          <ChevronDown
            className={cn('h-3 w-3 transition-transform duration-150', showAll && 'rotate-180')}
          />
          {showAll ? 'Show less' : `Show all ${parsed.lineCount} lines`}
        </button>
      )}
    </div>
  )
}
