import { useMemo } from 'react'
import { MarkdownRenderer } from '../MarkdownRenderer'
import { wireValueToPrettyString } from '@/lib/tool-wire-display'
import type { ToolViewProps } from './types'

export function SkillToolView({ output }: ToolViewProps): React.JSX.Element {
  const outputStr = output !== undefined && output !== null ? wireValueToPrettyString(output) : ''

  const markdownContent = useMemo(() => {
    if (!outputStr.length) return ''
    const match = outputStr.match(/<skill_content[^>]*>([\s\S]*?)<\/skill_content>/)
    if (match) return match[1].trim()
    return outputStr
  }, [outputStr])

  return (
    <div className="text-xs" data-testid="skill-tool-view">
      {markdownContent ? (
        <div className="p-3 max-h-[400px] overflow-y-auto">
          <MarkdownRenderer content={markdownContent} />
        </div>
      ) : (
        <div className="p-3 text-muted-foreground">Loading skill...</div>
      )}
    </div>
  )
}
