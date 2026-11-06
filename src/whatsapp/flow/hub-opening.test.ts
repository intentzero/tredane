import { describe, expect, it } from 'vitest'
import { enqueueAutoDraft, runDueAutoDrafts } from '../../clinic/ai'
import { bootDialogScenario } from '../../clinic/ai/evals/dialogs/scenario'
import type { PrepareBookingFlowOffer } from './offer-live'
import {
  activeServicesForHub,
  clinicTodayOpenState,
  hubInformacoesBody,
  hubMeusBody,
  hubOpeningBody,
  shouldOfferHubOpening,
  todayClosingHourLabel,
} from './hub-opening'
import { FLOW_COPY } from './copy'
import { DIALOG_NOW_MS } from '../../clinic/ai/evals/dialogs/scenario'

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
      }),
    ).toBe(true)
    expect(
      shouldOfferHubOpening({
        turnText: 'quero marcar',
        services,
      }),
    ).toBe(true)
    // Histórico com outbound da clínica NÃO bloqueia — mesmo gate que a oferta Flow.
    expect(
      shouldOfferHubOpening({
        turnText: 'Oi',
        services,
      }),
    ).toBe(true)
    expect(
      shouldOfferHubOpening({
        turnText: 'quero depilar',
        services,
      }),
    ).toBe(false)
    expect(
      shouldOfferHubOpening({
        turnText: 'Posso remarcar para quarta?',
        services,
      }),
    ).toBe(false)
    expect(
      shouldOfferHubOpening({
        turnText: 'Quero cancelar o horário',
        services,
      }),
    ).toBe(false)
  })

  it('CF-36: variante citada não abre o hub (sonda L4 05/11)', () => {
    const zone = (id: string, name: string, audience: 'feminino' | 'ambos' = 'ambos') => ({
      id,
      tenantId: 't',
      serviceId: 's',
      name,
      durationMinutes: 60,
      priceCents: 20000,
      audience,
      active: true,
      sortOrder: 0,
      synonyms: [] as string[],
    })
    // Como na clínica de teste do staging: sem sinónimos na ficha.
    const services = [
      {
        id: 'svc_dep',
        name: 'Depilação',
        active: true,
        synonyms: [] as string[],
        zones: [zone('z_ax', 'Axila', 'feminino'), zone('z_pe', 'Pernas', 'feminino')],
      },
      {
        id: 'svc_mas',
        name: 'Massagem',
        active: true,
        synonyms: [] as string[],
        zones: [
          zone('z_ve', 'Ventosaterapia'),
          zone('z_dr', 'Drenagem linfática'),
          zone('z_re', 'Massagem relaxante'),
        ],
      },
    ]
    for (const turnText of [
      'Oi, quero fazer uma drenagem linfática',
      'queria uma ventosaterapia',
      'Quero uma drenagem linfática amanhã às 3',
    ]) {
      expect(shouldOfferHubOpening({ turnText, services }), turnText).toBe(false)
    }
    // Continuam a abrir o hub. «Quero depilar» sem sinónimo na ficha também (DEC-110 / #509:
    // não inventa o match); com o sinónimo, o teste acima já cobre o caminho directo.
    for (const turnText of ['Oi', 'quero marcar', 'Quero agendar um horário', 'Quero depilar']) {
      expect(shouldOfferHubOpening({ turnText, services }), turnText).toBe(true)
    }
  })

  const HOURS_BODY =
    'Olá! Aqui é a Clínica Aurora. Hoje funcionamos das 09:00 às 18:00. O que você precisa?'
  const CLOSED_FRAMING = /Já estamos fechados|Ainda não abrimos|Posso ajudar a agendar mesmo assim/

  it('hubOpeningBody: os dois limites, um só, ou nenhum (mesma frase dentro ou fora)', () => {
    expect(hubOpeningBody('Clínica Aurora', { opensAt: '09:00', closesAt: '18:00' })).toBe(
      'Olá! Aqui é a Clínica Aurora. Hoje funcionamos das 09:00 às 18:00. O que você precisa?',
    )
    expect(hubOpeningBody('Clínica Aurora', { opensAt: '09:00', closesAt: null })).toBe(
      'Olá! Aqui é a Clínica Aurora. Hoje funcionamos a partir das 09:00. O que você precisa?',
    )
    expect(hubOpeningBody('Clínica Aurora', { opensAt: null, closesAt: '18:00' })).toBe(
      'Olá! Aqui é a Clínica Aurora. Hoje funcionamos até às 18:00. O que você precisa?',
    )
    expect(hubOpeningBody('Clínica Aurora', { opensAt: '  ', closesAt: '' })).toBe(
      'Olá! Aqui é a Clínica Aurora. O que você precisa?',
    )
    expect(hubOpeningBody('Clínica Aurora', null)).toBe(
      'Olá! Aqui é a Clínica Aurora. O que você precisa?',
    )
    expect(hubOpeningBody('Clínica Aurora', { opensAt: '09:00', closesAt: '18:00' })).not.toMatch(
      CLOSED_FRAMING,
    )
    expect(FLOW_COPY.flowCta).toBe('Abrir opções')
  })

  it('todayClosingHourLabel / openNow usam o expediente de hoje (sem IANA)', () => {
    const s = bootDialogScenario()
    try {
      // Cenário: qui 05/11/2026 10:00 SP — janelas 09–12 e 13–18.
      // A frase usa a primeira abertura e o último fecho, não o fim da janela actual.
      const open = clinicTodayOpenState(s.db, s.tenantId, s.clock)
      expect(open.opensAt).toBe('09:00')
      expect(open.closesAt).toBe('18:00')
      expect(open.openNow).toBe(true)
      expect(todayClosingHourLabel(s.db, s.tenantId, s.clock)).toBe('18:00')
      expect(hubOpeningBody('Clínica Aurora', open)).toBe(HOURS_BODY)
      expect(`${open.opensAt} ${open.closesAt}`).not.toMatch(/America\/|São Paulo|Sao_Paulo/)
    } finally {
      s.close()
    }
  })

  it('clinicTodayOpenState: 21:09 e 07:21 dizem o mesmo horário, sem frase de fechado', () => {
    // qui 05/11/2026 21:09 America/Sao_Paulo (= 00:09 UTC 06/11).
    const afterClose = Date.UTC(2026, 10, 6, 0, 9)
    // qui 05/11/2026 07:21 America/Sao_Paulo (= 10:21 UTC 05/11) — antes de abrir.
    const beforeOpen = Date.UTC(2026, 10, 5, 10, 21)
    for (const nowMs of [afterClose, beforeOpen]) {
      const s = bootDialogScenario({ nowMs })
      try {
        const state = clinicTodayOpenState(s.db, s.tenantId, s.clock)
        expect(state.openNow).toBe(false)
        expect(state.opensAt).toBe('09:00')
        expect(state.closesAt).toBe('18:00')
        const body = hubOpeningBody('Clínica Aurora', state)
        expect(body).toBe(HOURS_BODY)
        expect(body).not.toMatch(CLOSED_FRAMING)
        expect(body).not.toMatch(/America\/|São Paulo|Sao_Paulo/)
      } finally {
        s.close()
      }
    }
    expect(afterClose).not.toBe(DIALOG_NOW_MS)
    expect(beforeOpen).not.toBe(DIALOG_NOW_MS)
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

  async function draftHubOpening(nowMs?: number) {
    const s = bootDialogScenario(nowMs == null ? {} : { nowMs })
    try {
      s.sayOutbound('Já falámos antes nesta conversa.')
      const msgId = s.sayInbound('Oi')
      enqueueAutoDraft(
        s.db,
        s.tenantId,
        { conversationId: s.conversationId, messageId: msgId },
        s.clock,
      )
      // Opção C: cumprimento do hub usa debounce curto (300 ms), não 7 s.
      s.clock.advance(300)

      const prepare: PrepareBookingFlowOffer = async (input) => ({
        body: input.body ?? FLOW_COPY.openBody,
        flowToken: 'fl1_hub_open_test',
        interactive: {
          flow: {
            flowId: '1858344942174587',
            flowCta: FLOW_COPY.flowCta,
            flowToken: 'fl1_hub_open_test',
            flowAction: 'data_exchange',
            flowMessageVersion: '3',
            mode: 'published',
          },
        },
      })

      const out = await runDueAutoDrafts(s.db, s.caller, s.clock, {
        mode: 'synthetic',
        adapter: s.adapter,
        clinicName: 'Clínica Teste Paulo',
        prepareBookingFlowOffer: prepare,
      })
      const last = s.db.get<{ body: string; interactive_json: string | null }>(
        `SELECT m.body AS body, o.interactive_json AS interactive_json
         FROM messages m
         LEFT JOIN outbound_messages o ON o.message_id = m.id
         WHERE m.conversation_id = ? AND m.direction = 'outbound'
         ORDER BY m.created_at DESC LIMIT 1`,
        s.conversationId,
      )
      return { out, last }
    } finally {
      s.close()
    }
  }

  function expectHoursGreeting(
    last: { body: string; interactive_json: string | null } | null | undefined,
  ) {
    expect(last?.body).toBe(
      'Olá! Aqui é a Clínica Teste Paulo. Hoje funcionamos das 09:00 às 18:00. O que você precisa?',
    )
    expect(last?.body).not.toMatch(CLOSED_FRAMING)
    expect(last?.body).not.toMatch(/America\/|São Paulo|Sao_Paulo/)
    expect(last?.body).not.toMatch(/maps|google|Falar com a equipe/i)
    expect(last?.interactive_json ?? '').toContain('Abrir opções')
    expect(last?.interactive_json ?? '').toContain('1858344942174587')
  }

  it('autodraft: «Oi» com outbound anterior → hub_opening + Abrir opções (não LLM)', async () => {
    const { out, last } = await draftHubOpening()
    expect(out).toHaveLength(1)
    expect(out[0]!.reason).toBe('hub_opening')
    expect(out[0]!.suggestion).toBeNull()
    expectHoursGreeting(last)
  })

  it('autodraft: 21:09 usa o mesmo horário, sem a frase de fechado da #559', async () => {
    const afterClose = Date.UTC(2026, 10, 6, 0, 9)
    const { out, last } = await draftHubOpening(afterClose)
    expect(out).toHaveLength(1)
    expect(out[0]!.reason).toBe('hub_opening')
    expectHoursGreeting(last)
  })
})

describe('gate do hub usa o resolvedor do funil (CF-36, pela zona)', () => {
  it('pedido com zona do catálogo não recebe o cumprimento; cumprimento e vago continuam', () => {
    const s = bootDialogScenario()
    try {
      const services = activeServicesForHub(s.db, s.tenantId)
      expect(shouldOfferHubOpening({ turnText: 'quero depilar a axila', services })).toBe(false)
      expect(shouldOfferHubOpening({ turnText: 'Oi', services })).toBe(true)
      expect(shouldOfferHubOpening({ turnText: 'quero marcar', services })).toBe(true)
      expect(shouldOfferHubOpening({ turnText: 'quero fazer as unhas', services })).toBe(true)
    } finally {
      s.close()
    }
  })
})
