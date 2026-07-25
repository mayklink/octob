import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useProjectStore } from '@/stores'

export function ExpandProjectsButton(): React.JSX.Element {
  const projects = useProjectStore((s) => s.projects)
  const expandedProjectIds = useProjectStore((s) => s.expandedProjectIds)
  const setAllProjectsExpanded = useProjectStore((s) => s.setAllProjectsExpanded)

  const projectIds = projects.map((project) => project.id)
  const hasProjects = projectIds.length > 0
  const allExpanded = hasProjects && projectIds.every((id) => expandedProjectIds.has(id))
  const title = allExpanded ? 'Collapse all projects' : 'Expand all projects'

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-6 w-6"
      title={title}
      aria-label={title}
      onClick={() => setAllProjectsExpanded(!allExpanded, projectIds)}
      disabled={!hasProjects}
      data-testid="expand-projects-button"
    >
      {allExpanded ? (
        <ChevronsDownUp className="h-4 w-4" />
      ) : (
        <ChevronsUpDown className="h-4 w-4" />
      )}
    </Button>
  )
}
