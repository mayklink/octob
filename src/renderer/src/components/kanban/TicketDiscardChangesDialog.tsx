import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'

interface TicketDiscardChangesDialogProps {
  open: boolean
  onKeepEditing: () => void
  onDiscard: () => void
}

export function TicketDiscardChangesDialog({
  open,
  onKeepEditing,
  onDiscard
}: TicketDiscardChangesDialogProps): React.JSX.Element {
  return (
    <AlertDialog open={open} onOpenChange={(isOpen) => !isOpen && onKeepEditing()}>
      <AlertDialogContent data-testid="ticket-discard-confirm-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Discard changes?</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to close this window? Your changes will be discarded.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            data-testid="ticket-discard-keep-editing-btn"
            onClick={onKeepEditing}
          >
            Keep editing
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            data-testid="ticket-discard-confirm-btn"
            onClick={onDiscard}
          >
            Discard changes
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
