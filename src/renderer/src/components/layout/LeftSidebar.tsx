import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLayoutStore } from '@/stores/useLayoutStore'
import { useProjectStore, useConnectionStore, useFilterStore, useSpaceStore } from '@/stores'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { ResizeHandle } from './ResizeHandle'
import { ChevronRight, FolderGit2, Link, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  ProjectList,
  AddProjectButton,
  SortProjectsButton,
  RecentToggleButton,
  ExpandProjectsButton,
  FilterChips
} from '@/components/projects'
import { ConnectionList } from '@/components/connections'
import { SpacesTabBar } from '@/components/spaces'
import { ProjectFilter } from '@/components/projects/ProjectFilter'
import { UsageIndicator } from './UsageIndicator'
import { PinnedList } from './PinnedList'
import { RecentList } from './RecentList'

export function LeftSidebar(): React.JSX.Element {
  const { t } = useTranslation()
  const { leftSidebarWidth, leftSidebarCollapsed, setLeftSidebarWidth } = useLayoutStore()
  const projectCount = useProjectStore((s) => s.projects.length)
  const usageIndicatorMode = useSettingsStore((s) => s.usageIndicatorMode)
  const usageIndicatorProviders = useSettingsStore((s) => s.usageIndicatorProviders)
  const shouldShowUsageIndicator =
    usageIndicatorMode === 'current-agent' ||
    (usageIndicatorMode === 'specific-providers' && usageIndicatorProviders.length > 0)
  const [filterQuery, setFilterQuery] = useState('')
  const [connectionsExpanded, setConnectionsExpanded] = useState(false)

  // Filter store for language filters
  const activeLanguages = useFilterStore((s) => s.activeLanguages)
  const removeLanguage = useFilterStore((s) => s.removeLanguage)
  const clearAllFilters = useFilterStore((s) => s.clearAll)

  // Space switching
  const activeSpaceId = useSpaceStore((s) => s.activeSpaceId)

  // Connection mode state
  const connectionModeActive = useConnectionStore((s) => s.connectionModeActive)
  const connectionModeSelectedIds = useConnectionStore((s) => s.connectionModeSelectedIds)
  const connectionModeSubmitting = useConnectionStore((s) => s.connectionModeSubmitting)
  const exitConnectionMode = useConnectionStore((s) => s.exitConnectionMode)
  const finalizeConnection = useConnectionStore((s) => s.finalizeConnection)

  const canFinalize = connectionModeSelectedIds.size >= 2

  // Clear filter when entering connection mode
  useEffect(() => {
    if (connectionModeActive) {
      setFilterQuery('')
      clearAllFilters()
    }
  }, [connectionModeActive, clearAllFilters])

  // Clear language filters on space switch
  useEffect(() => {
    clearAllFilters()
    setFilterQuery('')
  }, [activeSpaceId, clearAllFilters])

  // Escape key exits connection mode
  useEffect(() => {
    if (!connectionModeActive) return

    const handleEscape = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        // If the project filter input is focused, let it handle Escape first
        // (clear the query / close the colon-command popover).
        // The user can press Escape again to exit connection mode.
        const filterInput = document.querySelector(
          '[data-testid="project-filter-input"]'
        ) as HTMLInputElement | null
        if (filterInput && document.activeElement === filterInput) {
          return
        }

        e.preventDefault()
        exitConnectionMode()
      }
    }

    document.addEventListener('keydown', handleEscape, true)
    return () => document.removeEventListener('keydown', handleEscape, true)
  }, [connectionModeActive, exitConnectionMode])

  // Exit connection mode if sidebar collapses
  useEffect(() => {
    if (leftSidebarCollapsed && connectionModeActive) {
      exitConnectionMode()
    }
  }, [leftSidebarCollapsed, connectionModeActive, exitConnectionMode])

  const handleResize = (delta: number): void => {
    setLeftSidebarWidth(leftSidebarWidth + delta)
  }

  const handleAddProject = async (): Promise<void> => {
    // Trigger the add project flow
    const addButton = document.querySelector(
      '[data-testid="add-project-button"]'
    ) as HTMLButtonElement
    if (addButton) {
      addButton.click()
    }
  }

  if (leftSidebarCollapsed) {
    return <div data-testid="left-sidebar-collapsed" />
  }

  return (
    <div className="flex flex-shrink-0" data-testid="left-sidebar-container">
      <aside
        className="bg-sidebar text-sidebar-foreground border-r flex flex-col overflow-hidden"
        style={{ width: leftSidebarWidth }}
        data-testid="left-sidebar"
        data-width={leftSidebarWidth}
        role="navigation"
        aria-label={t('layout.sidebarAriaLabel')}
      >
        {connectionModeActive ? (
          <div className="p-3 border-b flex items-center justify-between bg-muted/50">
            <div className="flex items-center gap-2 text-sm font-medium min-w-0">
              <Link className="h-4 w-4 text-primary shrink-0" />
              <span className="truncate">{t('common.selectWorktrees')}</span>
              <span className="text-xs text-muted-foreground shrink-0">
                ({connectionModeSelectedIds.size})
              </span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={exitConnectionMode}
                disabled={connectionModeSubmitting}
              >
                {t('common.cancel')}
              </Button>
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={finalizeConnection}
                disabled={!canFinalize || connectionModeSubmitting}
              >
                {connectionModeSubmitting ? (
                  <>
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    {t('common.connecting')}
                  </>
                ) : (
                  t('common.connect')
                )}
              </Button>
            </div>
          </div>
        ) : (
          <div className="px-3 py-2.5 border-b flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium">
              <FolderGit2 className="h-4 w-4" />
              <span>{t('common.projects')}</span>
            </div>
            <div className="flex items-center gap-0.5">
              <RecentToggleButton />
              <ExpandProjectsButton />
              <SortProjectsButton />
              <AddProjectButton />
            </div>
          </div>
        )}
        {projectCount > 1 && (
          <div className="px-2.5 py-2 border-b">
            <ProjectFilter value={filterQuery} onChange={setFilterQuery} />
          </div>
        )}
        {activeLanguages.length > 0 && (
          <div className="px-3 py-1.5 border-b">
            <FilterChips languages={activeLanguages} onRemove={removeLanguage} />
          </div>
        )}
        <div className="flex-1 overflow-auto px-1.5 py-2" data-testid="sidebar-scroll-container">
          <PinnedList />
          <RecentList />
          <button
            type="button"
            onClick={() => setConnectionsExpanded((expanded) => !expanded)}
            className="mb-1 flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            aria-expanded={connectionsExpanded}
          >
            <ChevronRight className={`h-3 w-3 transition-transform ${connectionsExpanded ? 'rotate-90' : ''}`} />
            {t('common.connections')}
          </button>
          {connectionsExpanded && <ConnectionList />}
          <ProjectList
            onAddProject={handleAddProject}
            filterQuery={filterQuery}
            activeLanguages={activeLanguages}
          />
        </div>
        {!connectionModeActive && (shouldShowUsageIndicator ? <UsageIndicator /> : <SpacesTabBar />)}
      </aside>
      <ResizeHandle onResize={handleResize} direction="left" />
    </div>
  )
}
