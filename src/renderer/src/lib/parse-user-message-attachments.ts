// ── Types ────────────────────────────────────────────────────────────
export interface ParsedFile {
  path: string
  name: string
}

export interface ParsedDataAttachment {
  mime: string
  name: string
  dataUrl: string
}

export interface ParsedDiffComment {
  file: string
  lines: string
  outdated: boolean
  snippet: string
  body: string
}

export interface ParsedUserAttachments {
  files: ParsedFile[]
  dataAttachments: ParsedDataAttachment[]
  diffComments: ParsedDiffComment[]
  cleanText: string
}

// ── XML attribute un-escaping ────────────────────────────────────────
const unescapeXmlAttr = (s: string): string =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')

// ── Regex patterns ──────────────────────────────────────────────────
const ATTACHED_FILES_RE = /<attached_files>\n?([\s\S]*?)\n?<\/attached_files>/g
const FILE_RE = /<file\s+path="([^"]*)">([\s\S]*?)<\/file>/g
const DATA_ATTACHMENT_RE = /<data-attachment\s+mime="([^"]*)"\s+name="([^"]*)">([\s\S]*?)<\/data-attachment>/g
const DIFF_COMMENTS_RE = /<diff-comments>\n?([\s\S]*?)\n?<\/diff-comments>/g
const DIFF_COMMENT_RE = /<diff-comment\s+file="([^"]*)"\s+lines="([^"]*)"\s+outdated="([^"]*)">\n?([\s\S]*?)\n?<\/diff-comment>/g
const SNIPPET_CONTENT_RE = /<snippet>([\s\S]*?)<\/snippet>/
const BODY_CONTENT_RE = /<body>([\s\S]*?)<\/body>/
const CDATA_SECTION_RE = /<!\[CDATA\[([\s\S]*?)\]\]>/g

/** Extract and concatenate content from one or more adjacent CDATA sections */
function extractCdataContent(raw: string): string {
  const parts: string[] = []
  for (const m of raw.matchAll(CDATA_SECTION_RE)) {
    parts.push(m[1])
  }
  return parts.join('')
}

// ── Parser ──────────────────────────────────────────────────────────
export function parseUserMessageAttachments(content: string): ParsedUserAttachments {
  const files: ParsedFile[] = []
  const dataAttachments: ParsedDataAttachment[] = []

  let cleaned = content

  // Extract attached files
  for (const m of content.matchAll(ATTACHED_FILES_RE)) {
    const block = m[1]
    for (const fm of block.matchAll(FILE_RE)) {
      files.push({
        path: unescapeXmlAttr(fm[1]),
        name: fm[2].trim()
      })
    }
  }
  cleaned = cleaned.replace(ATTACHED_FILES_RE, '')

  // Extract data attachments
  for (const m of content.matchAll(DATA_ATTACHMENT_RE)) {
    dataAttachments.push({
      mime: unescapeXmlAttr(m[1]),
      name: unescapeXmlAttr(m[2]),
      dataUrl: m[3].trim()
    })
  }
  cleaned = cleaned.replace(DATA_ATTACHMENT_RE, '')

  // Extract diff comments
  const diffComments: ParsedDiffComment[] = []
  for (const m of content.matchAll(DIFF_COMMENTS_RE)) {
    const block = m[1]
    for (const dm of block.matchAll(DIFF_COMMENT_RE)) {
      const innerContent = dm[4]
      const snippetMatch = innerContent.match(SNIPPET_CONTENT_RE)
      const bodyMatch = innerContent.match(BODY_CONTENT_RE)
      diffComments.push({
        file: unescapeXmlAttr(dm[1]),
        lines: dm[2],
        outdated: dm[3] === 'true',
        snippet: snippetMatch ? extractCdataContent(snippetMatch[1]) : '',
        body: bodyMatch ? extractCdataContent(bodyMatch[1]) : ''
      })
    }
  }
  cleaned = cleaned.replace(DIFF_COMMENTS_RE, '')

  // Collapse excessive blank lines left by removals
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim()

  return { files, dataAttachments, diffComments, cleanText: cleaned }
}
