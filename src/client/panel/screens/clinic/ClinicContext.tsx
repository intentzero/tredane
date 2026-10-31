import { useMemo } from 'react'
import { Button } from 'react-aria-components'
import type { ClinicConfigSnapshot } from '../../api'
import { navigatePanel, type ClinicaSection } from '../../routes'
import { pendingCounts } from './resourceRows'

type Props = {
  tenantId: string
  section: ClinicaSection
  entityId?: string
  snap: ClinicConfigSnapshot
}

type Item = {
  id: string
  label: string
  go: ClinicaSection
  entity?: string
  /** Seções da rota que mantêm este item ativo. */
  sections: ClinicaSection[]
  pending?: number
}

function pendingLabel(n: number): string {
  return n === 1 ? '1 pendência' : `${n} pendências`
}

/**
 * Coluna de contexto da Clínica no desktop (≥ 1280 px, #211): as áreas agrupadas e o selo
 * «N pendência» onde há exceção (Proposto, #226). Troca de área sem voltar ao início.
 */
export function ClinicContext({ tenantId, section, entityId, snap }: Props) {
  const pending = useMemo(() => pendingCounts(snap, Date.now()), [snap])
  const groups: Array<{ title: string; items: Item[] }> = [
    {
      title: 'Visão geral',
      items: [
        { id: 'hub', label: 'Início', go: 'hub', sections: ['hub'] },
        { id: 'conferir', label: 'Conferir', go: 'conferir', sections: ['conferir'] },
      ],
    },
    {
      title: 'Agenda',
      items: [
        { id: 'horarios', label: 'Horário', go: 'horarios', sections: ['horarios'] },
        {
          id: 'pro',
          label: 'Profissionais',
          go: 'recursos',
          entity: 'profissionais',
          sections: ['recursos', 'profissional'],
          pending: pending.professionals,
        },
        { id: 'salas', label: 'Salas', go: 'recursos', entity: 'salas', sections: ['sala'] },
        {
          id: 'servicos',
          label: 'Serviços',
          go: 'servicos',
          sections: ['servicos', 'servico'],
          pending: pending.services,
        },
      ],
    },
    {
      title: 'Acesso e canais',
      items: [
        { id: 'whatsapp', label: 'WhatsApp', go: 'whatsapp', sections: ['whatsapp'] },
        { id: 'recebimento', label: 'Recebimento', go: 'recebimento', sections: ['recebimento'] },
        { id: 'assistente', label: 'Assistente e automações', go: 'assistente', sections: ['assistente'] },
      ],
    },
  ]
  const isCurrent = (item: Item): boolean => {
    if (section === 'recursos') return item.id === (entityId === 'salas' ? 'salas' : 'pro')
    return item.sections.includes(section)
  }
  return (
    <nav className="clinic-context" aria-label="Áreas da clínica">
      {groups.map((group) => (
        <div key={group.title} className="clinic-context-group">
          <h2 className="clinic-context-title">{group.title}</h2>
          <ul className="clinic-context-list">
            {group.items.map((item) => (
              <li key={item.id}>
                <Button
                  className="clinic-context-item"
                  aria-current={isCurrent(item) ? 'page' : undefined}
                  onPress={() =>
                    navigatePanel({
                      kind: 'area',
                      area: 'clinica',
                      tenantId,
                      section: item.go,
                      entityId: item.entity,
                    })
                  }
                >
                  {item.label}
                  {item.pending ? (
                    <span className="clinic-context-pending">{pendingLabel(item.pending)}</span>
                  ) : null}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}
