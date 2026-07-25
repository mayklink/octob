import { ClipboardList } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { useSettingsStore } from '@/stores/useSettingsStore'

interface PromptTemplateMenuProps {
  onSelect: (body: string) => void
  disabled?: boolean
  testId?: string
}

export function PromptTemplateMenu({
  onSelect,
  disabled,
  testId = 'prompt-template-menu'
}: PromptTemplateMenuProps): React.JSX.Element {
  const templates = useSettingsStore((s) => s.taskSessionPromptTemplates)
  const hasTemplates = templates.length > 0

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          disabled={disabled}
          aria-label="Insert prompt template"
          title="Insert prompt template"
          data-testid={testId}
        >
          <ClipboardList className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Templates</DropdownMenuLabel>
        {!hasTemplates && <DropdownMenuItem disabled>No templates saved</DropdownMenuItem>}
        {templates.map((template) => (
          <DropdownMenuItem
            key={template.id}
            onSelect={() => onSelect(template.body)}
            data-testid={`${testId}-item-${template.id}`}
          >
            <span className="truncate">{template.name.trim() || 'Untitled'}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
