import { navigatePanel, type ClinicaSection } from '../../routes'

type Props = { tenantId: string; section: ClinicaSection; entityId?: string }

const TABS: Array<{
  id: string
  label: string
  sections: ClinicaSection[]
  go: ClinicaSection
  entity?: string
}> = [
  { id: 'hub', label: 'Início', sections: ['hub'], go: 'hub' },
  { id: 'horarios', label: 'Horário', sections: ['horarios'], go: 'horarios' },
  {
    id: 'pro',
    label: 'Profissionais',
    sections: ['recursos', 'profissional'],
    go: 'recursos',
    entity: 'profissionais',
  },
  { id: 'salas', label: 'Salas', sections: ['sala'], go: 'recursos', entity: 'salas' },
  { id: 'servicos', label: 'Serviços', sections: ['servicos', 'servico'], go: 'servicos' },
]

/** Abas da Clínica no desktop (a partir de 1280 px): troca de área sem voltar ao início. */
export function ClinicTabs({ tenantId, section, entityId }: Props) {
  const current = TABS.find((t) => {
    if (section === 'recursos') return t.id === (entityId === 'salas' ? 'salas' : 'pro')
    return t.sections.includes(section)
  })
  if (!current) return null
  return (
    <div className="clinic-tabs" role="tablist" aria-label="Áreas da clínica">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === current.id}
          className="clinic-tab"
          onClick={() =>
            navigatePanel({
              kind: 'area',
              area: 'clinica',
              tenantId,
              section: t.go,
              entityId: t.entity,
            })
          }
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
