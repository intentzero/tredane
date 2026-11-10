import { describe, expect, it } from 'vitest'
import { enqueueAutoDraft, runDueAutoDrafts } from '../../clinic/ai'
import { listServices, replaceServiceZonesOp, upsertServiceOp } from '../../clinic/config'
import { bootDialogScenario, type DialogScenario } from '../../clinic/ai/evals/dialogs/scenario'
import { saveScheduleSession } from '../../clinic/ai/schedule-session'
import type { PrepareBookingFlowOffer } from './offer-live'
import {
  activeServicesForHub,
  bookingFrameHasIntent,
  clinicTodayOpenState,
  hubInformacoesBody,
  hubMeusBody,
  hubOpeningBody,
  isMyAppointmentsQuery,
  shouldAttachHubOpeningCta,
  shouldOfferHubOpening,
  todayClosingHourLabel,
} from './hub-opening'
import { readAiReplyPause } from '../../clinic/ai/human-handoff'
import { SimulatedAiAdapter } from '../../ai'
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
    // Abertura vaga continua. «Quero depilar» sem sinónimo e typo de serviço
    // (DEC-151) NÃO abrem o hub — vão ao «não entendi» / catálogo (A-20, FL-22).
    for (const turnText of ['Oi', 'quero marcar', 'Quero agendar um horário']) {
      expect(shouldOfferHubOpening({ turnText, services }), turnText).toBe(true)
    }
    for (const turnText of ['Quero depilar', 'Quero agendar uma mensagem']) {
      expect(shouldOfferHubOpening({ turnText, services }), turnText).toBe(false)
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

  it('isMyAppointmentsQuery: smoke «Quais os meus agendamentos»; exclui cancel/remarcar/outro', () => {
    expect(isMyAppointmentsQuery('Quais os meus agendamentos')).toBe(true)
    expect(isMyAppointmentsQuery('meus horários')).toBe(true)
    expect(isMyAppointmentsQuery('tenho algum agendamento?')).toBe(true)
    expect(isMyAppointmentsQuery('o que tenho marcado')).toBe(true)
    expect(isMyAppointmentsQuery('quero cancelar o agendamento')).toBe(false)
    expect(isMyAppointmentsQuery('quero remarcar')).toBe(false)
    expect(isMyAppointmentsQuery('quero outro agendamento')).toBe(false)
    expect(isMyAppointmentsQuery('quero depilação')).toBe(false)
  })

  it('texto livre «Quais os meus agendamentos» → hubMeus, sem pausa nem alerta (smoke)', async () => {
    const s = bootDialogScenario()
    try {
      const mid = s.sayInbound('Quais os meus agendamentos')
      enqueueAutoDraft(
        s.db,
        s.tenantId,
        { conversationId: s.conversationId, messageId: mid },
        s.clock,
      )
      s.clock.advance(7_000)
      const out = await runDueAutoDrafts(s.db, s.caller, s.clock, {
        mode: 'synthetic',
        adapter: new SimulatedAiAdapter(),
      })
      expect(out).toHaveLength(1)
      expect(out[0]?.reason).toBe('hub_meus')
      expect(s.outboundBodies().some((b) => /não tem horário marcado/i.test(b))).toBe(true)
      expect(s.outboundBodies().some((b) => /equipe vai verificar|Não consigo confirmar/i.test(b))).toBe(
        false,
      )
      expect(readAiReplyPause(s.db, s.tenantId, s.conversationId)).toBeNull()
      const pending = s.db.all<{ kind: string }>(
        `SELECT kind FROM pending_communications
         WHERE tenant_id = ? AND conversation_id = ? AND status != 'resolved'`,
        s.tenantId,
        s.conversationId,
      )
      expect(pending.some((p) => p.kind === 'alter_awaiting_team')).toBe(false)
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
      // DEC-151: termo fora do catálogo com intenção de marcar ≠ abertura vaga.
      expect(shouldOfferHubOpening({ turnText: 'quero fazer as unhas', services })).toBe(false)
      expect(shouldOfferHubOpening({ turnText: 'Quero agendar uma mensagem', services })).toBe(
        false,
      )
    } finally {
      s.close()
    }
  })
})

describe('CTA Abrir opções só na abertura vaga (Paulo, 07/11/2026)', () => {
  it('«Oi» com quadro vazio cola o CTA; com serviço no quadro, não', () => {
    const services = [{ id: 'svc', name: 'Massagem', active: true }]
    expect(shouldAttachHubOpeningCta({ turnText: 'Oi', services, frame: null })).toBe(true)
    expect(bookingFrameHasIntent(null)).toBe(false)
    expect(
      shouldAttachHubOpeningCta({
        turnText: 'Oi',
        services,
        frame: { serviceId: 'svc', phase: 'coletando' },
      }),
    ).toBe(false)
    // Oferta já fechada: «Oi» volta a abrir o hub (FL-13, Remarcar).
    expect(
      shouldAttachHubOpeningCta({
        turnText: 'Oi',
        services,
        frame: { serviceId: 'svc', phase: 'ofertado' },
      }),
    ).toBe(true)
    expect(bookingFrameHasIntent({ pending: { slot: 'variantes' } })).toBe(true)
    expect(bookingFrameHasIntent({ serviceId: 'svc', phase: 'proposto' })).toBe(false)
  })

  function openMassagemTypes(s: DialogScenario) {
    const massagem = listServices(s.db, s.tenantId).find((row) => row.name === 'Massagem')
    if (!massagem) throw new Error('Massagem ausente')
    upsertServiceOp(
      s.db,
      s.caller,
      {
        id: massagem.id,
        name: massagem.name,
        durationMinutes: massagem.durationMinutes,
        bufferMinutes: massagem.bufferMinutes,
        priceCents: massagem.priceCents,
        professionalIds: massagem.professionalIds,
        roomRequirement: massagem.roomRequirement,
        variantKind: 'tipo',
        variantKindPlural: 'tipos',
        variantSelection: 'uma',
      },
      s.clock,
    )
    replaceServiceZonesOp(
      s.db,
      s.caller,
      massagem.id,
      [
        { name: 'Liberação miofascial', audience: 'ambos', durationMinutes: 50, priceCents: 15_000 },
        { name: 'Ventosaterapia', audience: 'ambos', durationMinutes: 45, priceCents: 14_000 },
        { name: 'Drenagem linfática', audience: 'ambos', durationMinutes: 50, priceCents: 16_000 },
        { name: 'Massagem relaxante', audience: 'ambos', durationMinutes: 50, priceCents: 15_000 },
      ],
      s.clock,
    )
    saveScheduleSession(
      s.db,
      s.tenantId,
      s.conversationId,
      { serviceId: massagem.id, phase: 'coletando' },
      s.clock,
    )
  }

  async function draft(s: DialogScenario, text: string, prepare: PrepareBookingFlowOffer) {
    const msgId = s.sayInbound(text)
    enqueueAutoDraft(s.db, s.tenantId, { conversationId: s.conversationId, messageId: msgId }, s.clock)
    s.clock.advance(8_000)
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
  }

  function countingPrepare() {
    let calls = 0
    const prepare: PrepareBookingFlowOffer = async (input) => {
      calls += 1
      return {
        body: input.body ?? FLOW_COPY.openBody,
        flowToken: 'fl1_gate',
        interactive: {
          flow: {
            flowId: '1858344942174587',
            flowCta: FLOW_COPY.flowCta,
            flowToken: 'fl1_gate',
            flowAction: 'data_exchange',
            flowMessageVersion: '3',
            mode: 'published',
          },
        },
      }
    }
    return { prepare, calls: () => calls }
  }

  it('«queria agendar uma massagem» com Massagem aberta pergunta o tipo, sem Abrir opções', async () => {
    const s = bootDialogScenario()
    const flow = countingPrepare()
    try {
      openMassagemTypes(s)
      const { out, last } = await draft(s, 'queria agendar uma massagem', flow.prepare)
      expect(out[0]!.reason).not.toBe('hub_opening')
      expect(flow.calls()).toBe(0)
      expect(last?.body ?? '').toMatch(/tipos?/i)
      expect(last?.body ?? '').toMatch(/liberação miofascial/)
      expect(last?.body ?? '').not.toMatch(/Liberação miofascial/)
      expect(last?.body ?? '').not.toMatch(/Não encontrei/i)
      expect(last?.interactive_json ?? '').not.toContain('Abrir opções')
    } finally {
      s.close()
    }
  })

  it('zona desconhecida pergunta a zona, sem Abrir opções', async () => {
    const s = bootDialogScenario()
    const flow = countingPrepare()
    try {
      saveScheduleSession(
        s.db,
        s.tenantId,
        s.conversationId,
        { serviceId: s.ids.depilacao, audienceLine: 'feminino', phase: 'coletando' },
        s.clock,
      )
      const { last } = await draft(s, 'Sexta às 10h e cotovelo', flow.prepare)
      expect(flow.calls()).toBe(0)
      expect(last?.body ?? '').toMatch(/Não encontrei cotovelo nas opções/)
      expect(last?.interactive_json ?? '').not.toContain('Abrir opções')
    } finally {
      s.close()
    }
  })

  it('despedida com serviço no quadro não leva Abrir opções (DEC-147)', async () => {
    const s = bootDialogScenario()
    const flow = countingPrepare()
    try {
      openMassagemTypes(s)
      const { out, last } = await draft(s, 'tchau', flow.prepare)
      expect(out[0]!.reason).not.toBe('hub_opening')
      expect(flow.calls()).toBe(0)
      expect(last?.body ?? '').toMatch(/quando quiser|fico por aqui|qualquer coisa/i)
      expect(last?.body ?? '').not.toMatch(/Não encontrei/i)
      expect(last?.body ?? '').not.toMatch(/tipos|Liberação miofascial/i)
      expect(last?.body ?? '').not.toMatch(/O que você precisa\?/)
      expect(last?.interactive_json ?? '').not.toContain('Abrir opções')
    } finally {
      s.close()
    }
  })
})
