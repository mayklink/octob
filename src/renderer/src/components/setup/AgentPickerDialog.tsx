import { Bot } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'

interface AgentPickerDialogProps {
  onSelect: (sdk: 'opencode' | 'claude-code' | 'codex' | 'mistral-vibe' | 'cursor-cli' | 'antigravity') => void
  availableSdks: {
    opencode: boolean
    claude: boolean
    codex: boolean
    mistralVibe: boolean
    cursorCli: boolean
    antigravity: boolean
    antigravityVersion: string | null
  }
}

export function AgentPickerDialog({
  onSelect,
  availableSdks
}: AgentPickerDialogProps): React.JSX.Element {
  return (
    <AlertDialog open={true}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Bot className="size-5" />
            Choose Your AI Agent
          </AlertDialogTitle>
          <AlertDialogDescription>
            Multiple AI agents are installed. Choose which one to use as the default for new
            sessions. You can change this later in Settings.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex gap-3 pt-2">
          {availableSdks.opencode && (
            <button
              onClick={() => onSelect('opencode')}
              className={cn(
                'flex-1 px-4 py-3 rounded-lg border-2 border-border',
                'hover:border-primary hover:bg-accent/50 transition-colors',
                'text-center cursor-pointer'
              )}
            >
              <div className="text-sm font-medium">OpenCode</div>
              <div className="text-xs text-muted-foreground mt-1">Open-source AI coding agent</div>
            </button>
          )}
          {availableSdks.claude && (
            <button
              onClick={() => onSelect('claude-code')}
              className={cn(
                'flex-1 px-4 py-3 rounded-lg border-2 border-border',
                'hover:border-primary hover:bg-accent/50 transition-colors',
                'text-center cursor-pointer'
              )}
            >
              <div className="text-sm font-medium">Claude Code</div>
              <div className="text-xs text-muted-foreground mt-1">
                Anthropic&apos;s coding assistant
              </div>
            </button>
          )}
          {availableSdks.codex && (
            <button
              onClick={() => onSelect('codex')}
              className={cn(
                'flex-1 px-4 py-3 rounded-lg border-2 border-border',
                'hover:border-primary hover:bg-accent/50 transition-colors',
                'text-center cursor-pointer'
              )}
            >
              <div className="text-sm font-medium">Codex</div>
              <div className="text-xs text-muted-foreground mt-1">OpenAI&apos;s coding agent</div>
            </button>
          )}
          {availableSdks.mistralVibe && (
            <button
              onClick={() => onSelect('mistral-vibe')}
              className={cn(
                'flex-1 px-4 py-3 rounded-lg border-2 border-border',
                'hover:border-primary hover:bg-accent/50 transition-colors',
                'text-center cursor-pointer'
              )}
            >
              <div className="text-sm font-medium">Mistral Vibe</div>
              <div className="text-xs text-muted-foreground mt-1">Mistral&apos;s vibe-acp coding agent</div>
            </button>
          )}
          {availableSdks.cursorCli && (
            <button
              onClick={() => onSelect('cursor-cli')}
              className={cn(
                'flex-1 px-4 py-3 rounded-lg border-2 border-border',
                'hover:border-primary hover:bg-accent/50 transition-colors',
                'text-center cursor-pointer'
              )}
            >
              <div className="text-sm font-medium">Cursor CLI</div>
              <div className="text-xs text-muted-foreground mt-1">
                Cursor agent (install CLI, agent acp on PATH)
              </div>
            </button>
          )}
          {availableSdks.antigravity && (
            <button
              onClick={() => onSelect('antigravity')}
              className={cn(
                'flex-1 px-4 py-3 rounded-lg border-2 border-border',
                'hover:border-primary hover:bg-accent/50 transition-colors',
                'text-center cursor-pointer'
              )}
            >
              <div className="text-sm font-medium">Google Antigravity</div>
              <div className="text-xs text-muted-foreground mt-1">
                Antigravity CLI{availableSdks.antigravityVersion ? ` v${availableSdks.antigravityVersion}` : ''}
              </div>
            </button>
          )}
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
