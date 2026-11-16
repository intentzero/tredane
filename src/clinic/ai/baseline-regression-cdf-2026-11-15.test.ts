/**
 * Regressão staging 15/11/2026 — itens (c), (d), (f).
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import {
  replaceServiceZonesOp,
  setWeeklyWindowsOp,
  upsertResourceOp,
  upsertServiceOp,
} from '../config'
import { setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { readReviewFlag } from '../inbox/review-flag'
import { insertMessage } from '../inbox/messages'
import { confirmAppointmentOp, zonedCivilToUtc } from '../scheduling'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { realizeAskInfo } from './ask-info-realize'
import {
  AFTER_HOURS_HUMAN_REGISTERED_PREFIX,
  HEALTH_SAFETY_LINE,
  notifyHumanHandoff,
  replyAfterHoursHumanRequest,
} from './human-handoff'
import { promiseTeamFollowUp, textPromisesTeamFollowUp } from './promise-team-follow-up'
import { phraseCancelOfferReschedule } from './reschedule'

const TZ = 'America/Sao_Paulo'

describe('invariante (d): copy de pedido à equipe → review_flagged_at', () => {
  const NOW = Date.UTC(2026, 10, 9, 14, 0)

  it('replyAfterHoursHumanRequest regista review_flag na mesma operação', () => {
    const clock = createControllableClock(NOW)
    const { db, close } = bootClinicDb({ clock })
    try {
      const tenantId = 'clinic-demo-inv-d'
      setClinicAiAssistEnabled(db, tenantId, true, clock)
      syncWhatsappChannel(
        db,
        tenantId,
        {
          status: 'connected',
          bindingId: 'b_inv_d',
          phoneNumberId: 'p_inv_d',
          wabaId: 'w_inv_d',
          displayPhone: '+5511900001999',
          displayName: 'C',
          action: 'channel_connected',
        },
        clock,
      )
      const contact = upsertContact(db, { tenantId, waId: '5511900001999', displayName: 'Rosana' }, clock)
      const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
      const reply = replyAfterHoursHumanRequest(
        db,
        tenantId,
        { conversationId: cnv.id, clientRequestId: 'inv-d-after-hours' },
        clock,
      )
      expect(reply.outbox.some((o) => o.type === 'conversation.review_flagged')).toBe(true)
      const flagged = readReviewFlag(db, tenantId, cnv.id)
      expect(flagged?.flaggedAt).not.toBeNull()
      expect(flagged?.source).toBe('auto')
      expect(flagged?.reason).toBe('client_request')
    } finally {
      close()
    }
  })

  it('textPromisesTeamFollowUp casa «Deixei seu pedido» e prefixo após horas', () => {
    expect(textPromisesTeamFollowUp(`${AFTER_HOURS_HUMAN_REGISTERED_PREFIX}. A equipe responde…`)).toBe(
      true,
    )
  })

  it('promiseTeamFollowUp (parcelamento) sinaliza Para revisão', () => {
    const clock = createControllableClock(NOW)
    const { db, close } = bootClinicDb({ clock })
    try {
      const tenantId = 'clinic-demo-inv-d-pay'
      setClinicAiAssistEnabled(db, tenantId, true, clock)
      syncWhatsappChannel(
        db,
        tenantId,
        {
          status: 'connected',
          bindingId: 'b_inv_d_pay',
          phoneNumberId: 'p_inv_d_pay',
          wabaId: 'w_inv_d_pay',
          displayPhone: '+5511900001081',
          displayName: 'C',
          action: 'channel_connected',
        },
        clock,
      )
      const contact = upsertContact(db, { tenantId, waId: '5511900001081', displayName: 'Tati' }, clock)
      const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
      const r = promiseTeamFollowUp(
        db,
        tenantId,
        {
          conversationId: cnv.id,
          detailText: 'Pergunta sobre parcelamento.',
        },
        clock,
      )
      expect(r.outbox.some((o) => o.type === 'conversation.review_flagged')).toBe(true)
      expect(readReviewFlag(db, tenantId, cnv.id)?.flaggedAt).not.toBeNull()
    } finally {
      close()
    }
  })
})

describe('item (c): preço mid-funnel sem variante no quadro', () => {
  it('realizeAskInfo cota zona única com lista de horários pendente', () => {
    const zone = {
      id: 'z_sessao',
      name: 'Sessão',
      audience: 'ambos' as const,
      durationMinutes: 45,
      priceCents: 16_000,
      active: true,
    }
    const service = {
      id: 'svc_dren',
      name: 'Drenagem linfática',
      durationMinutes: 45,
      priceCents: 16_000,
      variantKind: 'tipo',
      variantKindPlural: 'tipos',
      variantSelection: 'uma' as const,
      zones: [zone],
    } as const
    const r = realizeAskInfo({
      conversationId: 'cnv_test',
      topic: 'price',
      service: service as never,
      zones: [zone as never],
      frame: {
        serviceId: 'svc_dren',
        variantIds: null,
        date: '2026-11-17',
        pending: { slot: 'horario', options: [], messageId: 'm1' },
        lastOffer: { slots: [], messageId: 'm1' },
      } as never,
      sameFunnel: true,
    })
    expect(r?.replyText).toMatch(/R\$\s*160,00|160,00/)
    expect(r?.replyText).toMatch(/horário|Drenagem/i)
  })
})

describe('item (f): saúde e cancelamento', () => {
  it('handoff por saúde inclui linha de segurança', () => {
    const NOW = Date.UTC(2026, 10, 9, 14, 0)
    const clock = createControllableClock(NOW)
    const { db, close } = bootClinicDb({ clock })
    try {
      const tenantId = 'clinic-demo-inv-f-health'
      setClinicAiAssistEnabled(db, tenantId, true, clock)
      syncWhatsappChannel(
        db,
        tenantId,
        {
          status: 'connected',
          bindingId: 'b_f_h',
          phoneNumberId: 'p_f_h',
          wabaId: 'w_f_h',
          displayPhone: '+5511900001089',
          displayName: 'C',
          action: 'channel_connected',
        },
        clock,
      )
      const contact = upsertContact(db, { tenantId, waId: '5511900001089', displayName: 'Marcia' }, clock)
      const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
      insertMessage(
        db,
        {
          tenantId,
          conversationId: cnv.id,
          direction: 'inbound',
          body: 'oi',
          deliveryState: 'received',
          createdAt: clock.nowMs() - 60_000,
        },
        clock,
      )
      const inbound =
        'boa tarde to com uma dor nas costas faz 3 dias, o q eu faço?'
      const handoff = notifyHumanHandoff(
        db,
        tenantId,
        {
          conversationId: cnv.id,
          reason: 'off_purpose',
          clientRequestId: 'health-handoff',
          inboundText: inbound,
        },
        clock,
      )
      expect(handoff.sent).toBe(true)
      const last = db.get<{ body: string }>(
        `SELECT body FROM messages WHERE tenant_id = ? AND conversation_id = ? AND direction = 'outbound'
         ORDER BY created_at DESC LIMIT 1`,
        tenantId,
        cnv.id,
      )
      expect(last?.body).toContain(HEALTH_SAFETY_LINE)
    } finally {
      close()
    }
  })

  it('cancelamento oferece remarcar', () => {
    const body = phraseCancelOfferReschedule('Limpeza de pele profunda')
    expect(body).toMatch(/remarcar/i)
    expect(body).toMatch(/equipe confirmar/i)
  })

  it('cancelamento com compromisso futuro no fluxo autodraft (integração mínima)', async () => {
    const NOW = Date.UTC(2026, 10, 12, 17, 0)
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    const { db } = boot
    const tenantId = 'clinic-demo-inv-f-cancel'
    const caller = workerCaller(tenantId, 'user_synth_owner_a')
    syncWhatsappChannel(
      db,
      tenantId,
      {
        status: 'connected',
        bindingId: 'b_f_c',
        phoneNumberId: 'p_f_c',
        wabaId: 'w_f_c',
        displayPhone: '+551190000101',
        displayName: 'C',
        action: 'channel_connected',
      },
      clock,
    )
    const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala', category: 'Sala' }, clock)
    const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Samua', homeRoomId: room.id }, clock)
    const limpeza = upsertServiceOp(
      db,
      caller,
      {
        name: 'Limpeza de pele profunda',
        durationMinutes: 60,
        bufferMinutes: 0,
        priceCents: 18_000,
        variantKind: 'tipo',
        variantKindPlural: 'tipos',
        variantSelection: 'uma',
        professionalIds: [pro.id],
        roomRequirement: { mode: 'none' },
      },
      clock,
    )
    const zones = replaceServiceZonesOp(
      db,
      caller,
      limpeza.id,
      [{ name: 'Sessão', audience: 'ambos', durationMinutes: 60, priceCents: 18_000 }],
      clock,
    )
    const week = [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, startMinute: 540, endMinute: 1080 }))
    setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: week }, clock)
    setWeeklyWindowsOp(db, caller, { resourceId: room.id, windows: week }, clock)
    setClinicAiAssistEnabled(db, tenantId, true, clock)
    const contact = upsertContact(db, { tenantId, waId: '551190000101', displayName: 'Fernanda' }, clock)
    const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
    confirmAppointmentOp(
      db,
      caller,
      {
        clientRequestId: 'seed-s11',
        serviceId: limpeza.id,
        professionalId: pro.id,
        startsAt: zonedCivilToUtc(TZ, 2026, 11, 19, 12, 30),
        contactId: contact.id,
        conversationId: cnv.id,
        actorClerkUserId: caller.actorId!,
        zoneIds: zones.map((z) => z.id),
      },
      clock,
    )
    const inbound = insertMessage(
      db,
      {
        tenantId,
        conversationId: cnv.id,
        direction: 'inbound',
        body: 'oi, vou ter q cancelar a limpeza de quinta, surgiu um imprevisto',
        deliveryState: 'received',
        createdAt: clock.nowMs(),
      },
      clock,
    )
    const inboundWindow = insertMessage(
      db,
      {
        tenantId,
        conversationId: cnv.id,
        direction: 'inbound',
        body: 'oi',
        deliveryState: 'received',
        createdAt: clock.nowMs() - 120_000,
      },
      clock,
    )
    void inboundWindow
    const { enqueueAutoDraft, runDueAutoDrafts } = await import('./autodraft')
    const { SimulatedAiAdapter } = await import('../../ai')
    enqueueAutoDraft(db, tenantId, { conversationId: cnv.id, messageId: inbound.id }, clock)
    clock.advance(4_000)
    await runDueAutoDrafts(db, caller, clock, {
      mode: 'synthetic',
      adapter: new SimulatedAiAdapter(),
    })
    const last = db.get<{ body: string }>(
      `SELECT body FROM messages WHERE tenant_id = ? AND conversation_id = ? AND direction = 'outbound'
         ORDER BY created_at DESC LIMIT 1`,
      tenantId,
      cnv.id,
    )
    expect(last?.body).toMatch(/remarcar/i)
    expect(readReviewFlag(db, tenantId, cnv.id)?.flaggedAt).not.toBeNull()
    boot.close()
  })
})