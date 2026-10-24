import { Calendar, Kanban, MessageCircle, SlidersHorizontal } from 'lucide-react'
import type { PanelArea } from '../routes'
import { areaNavLabel, navigatePanel } from '../routes'

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
        return (
          <a
            key={area}
            href={`/c/${encodeURIComponent(tenantId)}/${area === 'acompanhamento' ? 'acompanhamento' : area}`}
            aria-current={current ? 'page' : undefined}
            onClick={(e) => {
              e.preventDefault()
              navigatePanel({ kind: 'area', area, tenantId })
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
