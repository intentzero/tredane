import { Calendar, Kanban, MessageCircle, SlidersHorizontal } from 'lucide-react'
import type { PanelArea } from '../routes'
import { areaNavLabel, areaRoute, navigatePanel, panelHref } from '../routes'

const BASE_AREAS: PanelArea[] = ['conversas', 'acompanhamento', 'agenda']

type Props = {
  tenantId: string
  active: PanelArea
  showClinica: boolean
}

export function BottomNav({ tenantId, active, showClinica }: Props) {
  const areas: PanelArea[] = showClinica ? [...BASE_AREAS, 'clinica'] : BASE_AREAS

  return (
    <nav
      className={`panel-nav panel-nav-${areas.length}`}
      aria-label="Áreas"
    >
      {areas.map((area) => {
        const Icon =
          area === 'conversas'
            ? MessageCircle
            : area === 'acompanhamento'
              ? Kanban
              : area === 'agenda'
                ? Calendar
                : SlidersHorizontal
        const current = area === active
        const route = areaRoute(tenantId, area)
        return (
          <a
            key={area}
            href={panelHref(route)}
            aria-current={current ? 'page' : undefined}
            onClick={(e) => {
              e.preventDefault()
              navigatePanel(route)
            }}
          >
            <Icon aria-hidden="true" size={24} strokeWidth={2} />
            {areaNavLabel(area)}
          </a>
        )
      })}
    </nav>
  )
}
