import { describe, expect, it } from 'vitest'
import { bootDialogScenario } from '../../clinic/ai/evals/dialogs/scenario'
import {
  hubInformacoesBody,
  hubMeusBody,
  hubOpeningBody,
  shouldOfferHubOpening,
  todayClosingHourLabel,
} from './hub-opening'
import { FLOW_COPY } from './copy'

describe('hub opening / Meus / Informações (TR-306 Confirmado)', () => {
  it('shouldOfferHubOpening: cumprimento e pedido vago sim; serviço/remarcar/cancelar não', () => {
    const services = [
      {
        id: 'svc_dep',
        name: 'Depilação',
        active: true,
        synonyms: ['depilar'],
      },
    ]

    expect(
      shouldOfferHubOpening({
        turnText: 'Oi',
        services,
        hasClinicOutbound: false,
      }),
    ).toBe(true)
    expect(
      shouldOfferHubOpening({
        turnText: 'quero marcar',
        services,
        hasClinicOutbound: false,
      }),
    ).toBe(true)
    expect(
      shouldOfferHubOpening({
        turnText: 'Oi',
        services,
        hasClinicOutbound: true,
      }),
    ).toBe(false)
    expect(
      shouldOfferHubOpening({
        turnText: 'quero depilar',
        services,
        hasClinicOutbound: false,
      }),
    ).toBe(false)
    expect(
      shouldOfferHubOpening({
        turnText: 'Posso remarcar para quarta?',
        services,
        hasClinicOutbound: false,
      }),
    ).toBe(false)
    expect(
      shouldOfferHubOpening({
        turnText: 'Quero cancelar o horário',
        services,
        hasClinicOutbound: false,
      }),
    ).toBe(false)
  })

  it('hubOpeningBody omite a frase de horas quando não há fecho', () => {
    expect(hubOpeningBody('Clínica Aurora', '18:00')).toBe(
      'Olá! Aqui é a Clínica Aurora. Hoje atendemos até às 18:00. O que você precisa?',
    )
    expect(hubOpeningBody('Clínica Aurora', null)).toBe(
      'Olá! Aqui é a Clínica Aurora. O que você precisa?',
    )
    expect(FLOW_COPY.flowCta).toBe('Abrir opções')
  })

  it('todayClosingHourLabel usa o expediente de hoje (sem IANA)', () => {
    const s = bootDialogScenario()
    try {
      // Cenário: qui 05/11/2026 10:00 SP — janela 09–12 e 13–18.
      const label = todayClosingHourLabel(s.db, s.tenantId, s.clock)
      expect(label).toBe('12:00')
      expect(label).not.toMatch(/America\//)
    } finally {
      s.close()
    }
  })

  it('hubMeusBody: sem compromisso / com lista (relógio clínica)', () => {
    const s = bootDialogScenario()
    try {
      expect(hubMeusBody(s.db, s.tenantId, s.contactId, s.clock)).toBe(
        FLOW_COPY.hubMeusNone,
      )
    } finally {
      s.close()
    }
  })

  it('hubInformacoesBody inclui expediente e link configurado (não hardcode)', () => {
    const s = bootDialogScenario()
    try {
      s.db.run(
        `UPDATE clinic_settings SET google_business_url = ?, clinic_address = ? WHERE tenant_id = ?`,
        'https://maps.app.goo.gl/ficticio-hub',
        'Rua Fictícia, 10',
        s.tenantId,
      )
      const body = hubInformacoesBody(s.db, s.tenantId, s.clock)
      expect(body).toMatch(/segunda:/)
      expect(body).toContain('https://maps.app.goo.gl/ficticio-hub')
      expect(body).not.toMatch(/share\.google/)
      expect(body).not.toMatch(/America\//)
    } finally {
      s.close()
    }
  })

  it('hubInformacoesBody sem link usa endereço', () => {
    const s = bootDialogScenario()
    try {
      s.db.run(
        `UPDATE clinic_settings SET google_business_url = '', clinic_address = ? WHERE tenant_id = ?`,
        'Rua Sem Mapa, 1',
        s.tenantId,
      )
      const withAddr = hubInformacoesBody(s.db, s.tenantId, s.clock)
      expect(withAddr).toContain('Rua Sem Mapa, 1')
      expect(withAddr).toMatch(/segunda:/)
    } finally {
      s.close()
    }
  })
})
