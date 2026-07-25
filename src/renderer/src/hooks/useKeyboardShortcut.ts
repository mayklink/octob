import { useEffect, useCallback } from 'react'

type ModifierKey = 'ctrl' | 'meta' | 'alt' | 'shift'

interface ShortcutOptions {
  key: string
  modifiers?: ModifierKey[]
  callback: () => void
  enabled?: boolean
  skipWhenEditing?: boolean // Skip when focus is in input/textarea/contenteditable/button
}

/**
 * Hook to register a keyboard shortcut.
 * Handles both Cmd (Mac) and Ctrl (Windows/Linux) for cross-platform shortcuts.
 */
export function useKeyboardShortcut({
  key,
  modifiers = [],
  callback,
  enabled = true,
  skipWhenEditing = false
}: ShortcutOptions): void {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled) return

      // Skip if user is typing in an input/textarea/contenteditable or has a button focused
      // This prevents the shortcut from hijacking native button behavior (e.g., Enter on "Deny" button)
      if (skipWhenEditing) {
        const target = event.target as HTMLElement
        if (
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'BUTTON' ||
          target.isContentEditable
        ) {
          return
        }
      }

      // Check if the key matches (case-insensitive)
      if (event.key.toLowerCase() !== key.toLowerCase()) return

      // Check modifiers
      const ctrlRequired = modifiers.includes('ctrl')
      const metaRequired = modifiers.includes('meta')
      const altRequired = modifiers.includes('alt')
      const shiftRequired = modifiers.includes('shift')

      // For cross-platform, treat both ctrl and meta as the same "command" key
      const hasCtrlOrMeta = event.ctrlKey || event.metaKey
      const needsCtrlOrMeta = ctrlRequired || metaRequired

      if (needsCtrlOrMeta && !hasCtrlOrMeta) return
      if (!needsCtrlOrMeta && hasCtrlOrMeta) return
      if (altRequired && !event.altKey) return
      if (!altRequired && event.altKey) return
      if (shiftRequired && !event.shiftKey) return
      if (!shiftRequired && event.shiftKey) return

      // All conditions met, trigger callback
      event.preventDefault()
      callback()
    },
    [key, modifiers, callback, enabled, skipWhenEditing]
  )

  useEffect(() => {
    if (!enabled) return

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown, enabled])
}

/**
 * Common keyboard shortcut: Cmd/Ctrl + K for session history / search
 */
export function useCommandK(callback: () => void, enabled = true): void {
  useKeyboardShortcut({
    key: 'k',
    modifiers: ['meta'], // Will also match Ctrl+K
    callback,
    enabled
  })
}

/**
 * Common keyboard shortcut: Cmd/Ctrl + P for command palette
 */
export function useCommandP(callback: () => void, enabled = true): void {
  useKeyboardShortcut({
    key: 'p',
    modifiers: ['meta'], // Will also match Ctrl+P
    callback,
    enabled
  })
}
