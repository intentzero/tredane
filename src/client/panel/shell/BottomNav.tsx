import { Calendar, Kanban, MessageCircle, SlidersHorizontal, Users } from 'lucide-react'
import type { PanelArea } from '../routes'
import { BrandMark } from '../ui/Brand'
import { areaNavLabel, areaRoute, navigatePanel, panelHref } from '../routes'
import { ShellActions } from './ShellActions'

/** Conversas · Acompanhar · Agenda · Clientes (+ Clínica owner). Opção C Confirmada. */
const BASE_AREAS: PanelArea[] = ['conversas', 'acompanhamento', 'agenda', 'clientes']

type Props = {
  tenantId: string
  active: PanelArea
  showClinica: boolean
}

function areaIcon(area: PanelArea) {
  switch (area) {
    case 'conversas':
      return MessageCircle
    case 'acompanhamento':
      return Kanban
    case 'agenda':
      return Calendar
    case 'clientes':
      return Users
    default:
      return SlidersHorizontal
  }
}

export function BottomNav({ tenantId, active, showClinica }: Props) {
  const areas: PanelArea[] = showClinica ? [...BASE_AREAS, 'clinica'] : BASE_AREAS

  return (
    <nav
      className={`panel-nav panel-nav-${areas.length}`}
      aria-label="Áreas"
    >
      <span className="panel-nav-brand" aria-hidden="true">
        <BrandMark size={40} label="" />
      </span>
      {areas.map((area) => {
        const Icon = areaIcon(area)
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
      {/* Desktop ≥ 1280: sino + conta no fundo do rail (mock ConversasDesktopProposta). */}
      <ShellActions
        className="panel-nav-actions"
        tenantId={tenantId}
        accountPlacement="top"
      />
    </nav>
  )
}
