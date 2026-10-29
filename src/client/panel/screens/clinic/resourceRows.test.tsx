import { describe, expect, it } from 'vitest'
import type { ClinicConfigSnapshot, ClinicResource, ClinicService } from '../../api'
import { CLINIC_SCOPE_ID } from './clinicHours'
import { dayOfWeekIn, professionalRow, roomRow, serviceRow } from './resourceRows'

function res(over: Partial<ClinicResource>): ClinicResource {
  return {
    id: 'r1',
    kind: 'professional',
    name: 'Gi',
    category: null,
    active: true,
    futureAppointmentCount: 0,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}

function svc(over: Partial<ClinicService>): ClinicService {
  return {
    id: 's1',
    name: 'Bronzeamento Feminino',
    durationMinutes: 60,
    bufferMinutes: 15,
    occupiedMinutes: 75,
    priceCents: null,
    clientExplanation: null,
    active: true,
    requiresSignal: false,
    signalKind: null,
    signalFixedCents: null,
    signalPercent: null,
    professionalIds: [],
    roomRequirement: { mode: 'none' },
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}

function snap(
  resources: ClinicResource[],
  services: ClinicService[],
  weeklyWindows: ClinicConfigSnapshot['weeklyWindows'] = [],
): ClinicConfigSnapshot {
  return {
    settings: { tenantId: 't', timezone: 'America/Sao_Paulo', updatedAt: 0 },
    resources,
    services,
    weeklyWindows,
    blocks: [],
  } as unknown as ClinicConfigSnapshot
}

// 2026-10-30 (sexta) 12:00 em Brasília
const FRIDAY = Date.UTC(2026, 9, 30, 15, 0, 0)

describe('dayOfWeekIn', () => {
  it('segunda = 1 … domingo = 7, no fuso da clínica', () => {
    expect(dayOfWeekIn(FRIDAY, 'America/Sao_Paulo')).toBe(5)
    // 01:00 UTC de sábado ainda é sexta à noite em Brasília
    expect(dayOfWeekIn(Date.UTC(2026, 9, 31, 1, 0, 0), 'America/Sao_Paulo')).toBe(5)
  })
})

describe('professionalRow', () => {
  it('lista os serviços ativos e o expediente de hoje', () => {
    const gi = res({ id: 'gi', hoursMode: 'own' })
    const s = snap(
      [gi],
      [
        svc({ id: 'a', name: 'Bronzeamento Feminino', professionalIds: ['gi'] }),
        svc({ id: 'b', name: 'Bronzeamento Masculino', professionalIds: ['gi'] }),
        svc({ id: 'c', name: 'Antigo', professionalIds: ['gi'], active: false }),
      ],
      [{ id: 'w', resourceId: 'gi', dayOfWeek: 5, startMinute: 540, endMinute: 1080 }],
    )
    expect(professionalRow(s, gi, FRIDAY)).toEqual({
      services: 'Bronzeamento Feminino e Bronzeamento Masculino',
      today: 'Hoje 09:00–18:00',
      missingHours: false,
    })
  })

  it('sem nenhuma faixa de horário: falta horário', () => {
    const p = res({ id: 'sandra', hoursMode: 'own' })
    const row = professionalRow(snap([p], []), p, FRIDAY)
    expect(row.missingHours).toBe(true)
    expect(row.today).toBeNull()
    expect(row.services).toBe('Nenhum serviço ainda')
  })

  it('segue o horário da clínica quando não tem o próprio', () => {
    const p = res({ id: 'p', hoursMode: 'clinic' })
    const s = snap(
      [p],
      [],
      [{ id: 'w', resourceId: CLINIC_SCOPE_ID, dayOfWeek: 1, startMinute: 480, endMinute: 720 }],
    )
    const row = professionalRow(s, p, FRIDAY)
    expect(row.missingHours).toBe(false)
    expect(row.today).toBe('Hoje sem atendimento')
  })
})

describe('roomRow', () => {
  it('capacidade em frase e serviços que usam a sala', () => {
    const room = res({ id: 'e', kind: 'room', name: 'Espaço', capacity: 4, category: 'Sol' })
    const s = snap(
      [room],
      [
        svc({ id: 'a', roomRequirement: { mode: 'resource', resourceId: 'e' } }),
        svc({ id: 'b', roomRequirement: { mode: 'category', category: 'Sol' } }),
        svc({ id: 'c', roomRequirement: { mode: 'any' } }),
      ],
    )
    expect(roomRow(s, room)).toEqual({
      capacity: 'Atende 4 clientes ao mesmo tempo',
      usage: 'Usada em 2 serviços',
    })
    const solo = res({ id: 'd', kind: 'room', name: 'Depilação' })
    expect(roomRow(snap([solo], []), solo)).toEqual({
      capacity: '1 cliente por vez',
      usage: 'Nenhum serviço usa',
    })
  })
})

describe('serviceRow', () => {
  it('ocupa, quem faz, sala e preço', () => {
    const gi = res({ id: 'gi' })
    const room = res({ id: 'e', kind: 'room', name: 'Espaço Bronzeamento' })
    const service = svc({
      professionalIds: ['gi'],
      roomRequirement: { mode: 'resource', resourceId: 'e' },
      priceCents: 18000,
    })
    const row = serviceRow(snap([gi, room], [service]), service)
    expect(row.occupies).toBe('Ocupa 75 min (60 + 15 de intervalo)')
    expect(row.detail).toMatch(/^Gi · Espaço Bronzeamento · R\$\s?180,00$/)
    expect(row.warning).toBeNull()
  })

  it('sem profissional ativa: aviso; sem preço: «Sem preço»; sem intervalo: só o total', () => {
    const off = res({ id: 'gi', active: false })
    const service = svc({ professionalIds: ['gi'], bufferMinutes: 0, occupiedMinutes: 60 })
    const row = serviceRow(snap([off], [service]), service)
    expect(row.warning).toBe('Sem profissional')
    expect(row.occupies).toBe('Ocupa 60 min')
    expect(row.detail).toBe('Sem preço')
  })
})
