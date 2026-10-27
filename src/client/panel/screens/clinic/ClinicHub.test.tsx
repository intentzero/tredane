import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ClinicConfigSnapshot } from '../../api'
import { ClinicHub } from './ClinicHub'
import { templateStatus, templateTitle } from './whatsapp/format'

afterEach(cleanup)

function snap(over: {
  missing: string[]
  services?: number
  professionals?: number
  rooms?: number
}): ClinicConfigSnapshot {
  return {
    readiness: {
      agendaConfigured: over.missing.length === 0,
      schedulingAllowed: over.missing.length === 0,
      missing: over.missing,
      counts: {
        servicesActive: over.services ?? 0,
        professionalsActive: over.professionals ?? 0,
        roomsActive: over.rooms ?? 0,
      },
    },
  } as unknown as ClinicConfigSnapshot
}

describe('ClinicHub — progresso', () => {
  it('conta as 4 etapas e diz qual é a próxima', () => {
    render(
      <ClinicHub
        tenantId="clinic-demo-a"
        snap={snap({ missing: ['weekly_availability', 'whatsapp'], services: 3, professionals: 1, rooms: 1 })}
      />,
    )
    expect(screen.getByText('Faltam 2 passos para atender')).toBeTruthy()
    expect(screen.getByText(/2 de 4 etapas prontas · Próxima: Horários e bloqueios/)).toBeTruthy()
    const bar = screen.getByRole('progressbar', { name: 'Etapas prontas' })
    expect(bar.getAttribute('aria-valuenow')).toBe('2')
    expect(bar.getAttribute('aria-valuemax')).toBe('4')
  })

  it('tudo pronto: sem barra, com aviso verde', () => {
    render(
      <ClinicHub
        tenantId="clinic-demo-a"
        snap={snap({ missing: [], services: 2, professionals: 1, rooms: 1 })}
      />,
    )
    expect(screen.getByText('Pronta para atender')).toBeTruthy()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('marca «Falta» só onde falta e «Pronto» só para leitor de tela onde está pronto', () => {
    render(
      <ClinicHub
        tenantId="clinic-demo-a"
        snap={snap({ missing: ['whatsapp'], services: 3, professionals: 1, rooms: 1 })}
      />,
    )
    expect(screen.getAllByText('Falta')).toHaveLength(1)
    expect(screen.getByRole('button', { name: /^WhatsApp.*Falta/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Serviços.*Pronto/ })).toBeTruthy()
  })

  it('Equipe aparece como «em breve» e não é botão', () => {
    render(<ClinicHub tenantId="clinic-demo-a" snap={snap({ missing: [] })} />)
    expect(screen.getByText('Convidar recepcionistas · em breve')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Equipe/ })).toBeNull()
  })
})

describe('modelos do WhatsApp', () => {
  it('nome legível e status em palavra de recepcionista', () => {
    expect(templateTitle('lembrete_horario')).toBe('Lembrete horario')
    expect(templateStatus('APPROVED')).toEqual({ label: 'Aprovado', tone: 'open' })
    expect(templateStatus('PENDING').label).toBe('Em análise')
    expect(templateStatus('REJECTED').tone).toBe('bad')
    expect(templateStatus('algo_novo').label).toBe('Em análise')
  })
})
