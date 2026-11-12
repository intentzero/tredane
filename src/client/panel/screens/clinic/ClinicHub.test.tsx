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
  it('conta as 5 etapas, na ordem de dependência, e diz qual é a próxima', () => {
    render(
      <ClinicHub
        tenantId="clinic-demo-a"
        snap={snap({ missing: ['weekly_availability', 'whatsapp'], services: 3, professionals: 1, rooms: 1 })}
      />,
    )
    expect(screen.getByText(/Faltam 2 passos para atender/)).toBeTruthy()
    expect(screen.getByText(/3 de 5 etapas prontas · Próxima: Horário da clínica/)).toBeTruthy()
    expect(screen.getByText('Agora · passo 1')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Definir horário' })).toBeTruthy()
    const bar = screen.getByRole('progressbar', { name: 'Etapas prontas' })
    expect(bar.getAttribute('aria-valuenow')).toBe('3')
    expect(bar.getAttribute('aria-valuemax')).toBe('5')
  })

  it('a lista de passos segue a ordem horário → salas → profissionais → serviços', () => {
    // «O caminho» só aparece com 2 ou mais passos em falta (DEC-163).
    render(
      <ClinicHub
        tenantId="clinic-demo-a"
        snap={snap({ missing: ['whatsapp'], services: 0, professionals: 1, rooms: 1 })}
      />,
    )
    const names = screen
      .getAllByRole('button')
      .map((b) => b.textContent ?? '')
      .filter((t) => /^[1-4] ·/.test(t))
      .map((t) => t.slice(0, 3))
    expect(names).toEqual(['1 ·', '2 ·', '3 ·', '4 ·'])
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
    expect(screen.getByText('Quando atende')).toBeTruthy()
    expect(screen.getByText('Quem, o quê e onde')).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Assistente e automações/ })).toBeTruthy()
  })

  it('marca «Falta» só onde falta e «Pronto» só para leitor de tela onde está pronto', () => {
    render(
      <ClinicHub
        tenantId="clinic-demo-a"
        snap={snap({ missing: ['whatsapp'], services: 3, professionals: 1, rooms: 1 })}
      />,
    )
    // DEC-163: com um só passo em falta, a clínica está em uso — faixa de uma linha e índice.
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.getByText('Falta conectar o WhatsApp')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Conectar' })).toBeTruthy()
    expect(screen.getAllByText('Falta')).toHaveLength(1)
    expect(screen.getByRole('button', { name: /^WhatsApp.*Não conectado.*Falta/ })).toBeTruthy()
    expect(screen.getByText('Quem, o quê e onde')).toBeTruthy()
  })

  it('mostra o valor atual em cada linha (DEC-163)', () => {
    const base = snap({ missing: ['whatsapp'], services: 2, professionals: 2, rooms: 1 })
    render(
      <ClinicHub
        tenantId="clinic-demo-a"
        snap={{
          ...base,
          settings: { aiAssistEnabled: false } as ClinicConfigSnapshot['settings'],
          resources: [
            { kind: 'professional', name: 'Ana Fictícia', active: true },
            { kind: 'professional', name: 'Bia Fictícia', active: true },
            { kind: 'room', name: 'Sala Fictícia', active: true },
          ] as unknown as ClinicConfigSnapshot['resources'],
          services: [
            { name: 'A', active: true, priceCents: 15000 },
            { name: 'B', active: true, priceCents: 48000 },
          ] as unknown as ClinicConfigSnapshot['services'],
        }}
      />,
    )
    expect(screen.getByText('Ana Fictícia e Bia Fictícia')).toBeTruthy()
    expect(screen.getByText('Sala Fictícia')).toBeTruthy()
    expect(screen.getByText(/2 serviços ativos · de R\$\s?150 a R\$\s?480/)).toBeTruthy()
    expect(screen.getByText('Sugestões com IA desligadas')).toBeTruthy()
  })

  it('Equipe é botão e usa copy Atendente (não recepcionista)', () => {
    render(<ClinicHub tenantId="clinic-demo-a" snap={snap({ missing: [] })} />)
    expect(screen.getByText('Convidar atendentes')).toBeTruthy()
    expect(screen.queryByText('Em breve')).toBeNull()
    expect(screen.queryByText(/recepcionista/i)).toBeNull()
    expect(screen.getByRole('button', { name: /Equipe/ })).toBeTruthy()
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
