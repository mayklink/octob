export const shortcuts = {
  title: 'Keyboard Shortcuts',
  subtitle: 'Customize keyboard shortcuts',
  resetAll: 'Reset All',
  conflictTitle: 'Shortcut conflict',
  conflictBody: 'This binding is already used by:',
  pressKeys: 'Press keys...',
  resetToDefault: 'Reset to default',
  toastUpdated: 'Shortcut updated to {{binding}}',
  toastResetOne: 'Shortcut reset to default',
  toastResetAll: 'All shortcuts reset to defaults',
  toastModifierRequired:
    'Shortcuts must include at least one modifier key (Cmd/Ctrl/Alt/Shift)',
  categories: {
    session: 'Sessions',
    navigation: 'Navigation',
    git: 'Git',
    sidebar: 'Sidebars',
    focus: 'Focus',
    settings: 'Settings'
  },
  definitions: {
    session_new: { label: 'New Session', description: 'Create a new chat session' },
    session_close: {
      label: 'Close Session',
      description: 'Close the current session tab (noop if none open)'
    },
    'session_mode-toggle': {
      label: 'Toggle Build/Plan Mode',
      description: 'Switch between build and plan mode'
    },
    'session_super-plan-toggle': {
      label: 'Toggle Super Plan',
      description: 'Toggle super-plan mode (Shift+Tab)'
    },
    project_run: {
      label: 'Run Project',
      description: 'Start or stop the project run script'
    },
    'model_cycle-variant': {
      label: 'Cycle Model Variant',
      description: 'Cycle through thinking-level variants (e.g., high/max)'
    },
    'nav_file-search': {
      label: 'Search Files',
      description: 'Open the file search dialog'
    },
    'nav_command-palette': {
      label: 'Open Command Palette',
      description: 'Open the command palette'
    },
    'nav_session-history': {
      label: 'Open Session History',
      description: 'Open the session history panel'
    },
    'nav_new-worktree': {
      label: 'New Worktree',
      description: 'Create a new worktree for the current project'
    },
    'nav_filter-projects': {
      label: 'Filter Projects',
      description: 'Focus the project filter input'
    },
    git_commit: {
      label: 'Focus Commit Form',
      description: 'Focus the git commit form'
    },
    git_push: {
      label: 'Push to Remote',
      description: 'Push commits to the remote repository'
    },
    git_pull: {
      label: 'Pull from Remote',
      description: 'Pull commits from the remote repository'
    },
    'sidebar_toggle-left': {
      label: 'Toggle Left Sidebar',
      description: 'Show or hide the left sidebar'
    },
    'sidebar_toggle-right': {
      label: 'Toggle Right Sidebar',
      description: 'Show or hide the right sidebar'
    },
    'sidebar_toggle-bottom-terminal': {
      label: 'Toggle Bottom Terminal',
      description: 'Show or hide the bottom terminal panel'
    },
    'focus_left-sidebar': {
      label: 'Focus Left Sidebar',
      description: 'Move focus to the left sidebar'
    },
    'focus_main-pane': {
      label: 'Focus Main Pane',
      description: 'Move focus to the main chat pane'
    },
    settings_open: {
      label: 'Open Settings',
      description: 'Open the settings panel'
    }
  }
}
