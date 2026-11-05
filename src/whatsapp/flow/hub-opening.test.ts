import { describe, expect, it } from 'vitest'
import { enqueueAutoDraft, runDueAutoDrafts } from '../../clinic/ai'
import { bootDialogScenario } from '../../clinic/ai/evals/dialogs/scenario'
import type { PrepareBookingFlowOffer } from './offer-live'
import {
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

  it('hubOpeningBody: aberto / fechado / sem fecho (Paulo A)', () => {
    expect(hubOpeningBody('Clínica Aurora', '18:00', true)).toBe(
      'Olá! Aqui é a Clínica Aurora. Hoje atendemos até às 18:00. O que você precisa?',
    )
    expect(hubOpeningBody('Clínica Aurora', '18:00', false)).toBe(
      'Olá! Aqui é a Clínica Aurora. Já estamos fechados (hoje até às 18:00). Posso ajudar a agendar mesmo assim?',
    )
    expect(hubOpeningBody('Clínica Aurora', null, false)).toBe(
      'Olá! Aqui é a Clínica Aurora. O que você precisa?',
    )
    expect(hubOpeningBody('Clínica Aurora', null)).toBe(
      'Olá! Aqui é a Clínica Aurora. O que você precisa?',
    )
    expect(FLOW_COPY.flowCta).toBe('Abrir opções')
  })

  it('todayClosingHourLabel / openNow usam o expediente de hoje (sem IANA)', () => {
    const s = bootDialogScenario()
    try {
      // Cenário: qui 05/11/2026 10:00 SP — janela 09–12 e 13–18.
      const open = clinicTodayOpenState(s.db, s.tenantId, s.clock)
      expect(open.closesAt).toBe('12:00')
      expect(open.openNow).toBe(true)
      expect(todayClosingHourLabel(s.db, s.tenantId, s.clock)).toBe('12:00')
      expect(open.closesAt).not.toMatch(/America\//)
    } finally {
      s.close()
    }
  })

  it('clinicTodayOpenState: após o fecho → closed + última hora do dia', () => {
    // qui 05/11/2026 21:09 America/Sao_Paulo (= 00:09 UTC 06/11).
    const afterHours = Date.UTC(2026, 10, 6, 0, 9)
    const s = bootDialogScenario({ nowMs: afterHours })
    try {
      const state = clinicTodayOpenState(s.db, s.tenantId, s.clock)
      expect(state.openNow).toBe(false)
      expect(state.closesAt).toBe('18:00')
      expect(hubOpeningBody('Clínica Aurora', state.closesAt, state.openNow)).toBe(
        'Olá! Aqui é a Clínica Aurora. Já estamos fechados (hoje até às 18:00). Posso ajudar a agendar mesmo assim?',
      )
      // Sanity: o default do cenário permanece aberto.
      expect(afterHours).not.toBe(DIALOG_NOW_MS)
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

  it('autodraft: «Oi» com outbound anterior → hub_opening + Abrir opções (não LLM)', async () => {
    const s = bootDialogScenario()
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
      expect(out).toHaveLength(1)
      expect(out[0]!.reason).toBe('hub_opening')
      expect(out[0]!.suggestion).toBeNull()

      const last = s.db.get<{ body: string; interactive_json: string | null }>(
        `SELECT m.body AS body, o.interactive_json AS interactive_json
         FROM messages m
         LEFT JOIN outbound_messages o ON o.message_id = m.id
         WHERE m.conversation_id = ? AND m.direction = 'outbound'
         ORDER BY m.created_at DESC LIMIT 1`,
        s.conversationId,
      )
      expect(last?.body).toMatch(/^Olá! Aqui é a Clínica Teste Paulo\./)
      expect(last?.body).toMatch(/Hoje atendemos até às/)
      expect(last?.body).toMatch(/O que você precisa\?/)
      expect(last?.body).not.toMatch(/Já estamos fechados/)
      expect(last?.body).not.toMatch(/maps|google|Falar com a equipe/i)
      expect(last?.interactive_json ?? '').toContain('Abrir opções')
      expect(last?.interactive_json ?? '').toContain('1858344942174587')
    } finally {
      s.close()
    }
  })
})
