/**
 * Lab S23–S25 (16/11/2026): remarcação «Remarcado», exclusão do horário actual,
 * cancelamento com botão e desambiguação de dia.
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
import { insertMessage } from '../inbox/messages'
import { sendOutboundMessageOp } from '../inbox/operations'
import { renderProposalResultBody } from '../proposals/render'
import { confirmAppointmentOp, zonedCivilToUtc } from '../scheduling'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import {
  buildCancelAppointmentChoiceInteractive,
  encodeChoiceId,
  handleChoiceOfferClick,
  SLOT_LIST_BUTTON_LABEL,
} from './choice-offer'
import {
  cancelConfirmButtonId,
  handleCancelConfirmButtonClick,
  handleCancelIntentAutodraft,
  resolveCancelTargetAppointment,
  tryCancelAutodraftContinuation,
} from './cancel-flow'
import { getBookingFrame, saveBookingFrame } from './schedule-session'
import { readCatalogVersion } from './turn-context'
import { tryAiReschedule } from './reschedule'

const TZ = 'America/Sao_Paulo'

function seedLab(now: number, waId: string) {
  const clock = createControllableClock(now)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-s23-s25'
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'b_s23',
      phoneNumberId: 'p_s23',
      wabaId: 'w_s23',
      displayPhone: waId,
      displayName: 'Lab',
      action: 'channel_connected',
    },
    clock,
  )
  const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala', category: 'Sala' }, clock)
  const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Ana', homeRoomId: room.id }, clock)
  const micro = upsertServiceOp(
    db,
    caller,
    {
      name: 'Microagulhamento',
      durationMinutes: 60,
      bufferMinutes: 0,
      priceCents: 32_000,
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
    micro.id,
    [{ name: 'Sessão', audience: 'ambos', durationMinutes: 60, priceCents: 32_000 }],
    clock,
  )
  const week = [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, startMinute: 480, endMinute: 1080 }))
  setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: week }, clock)
  setWeeklyWindowsOp(db, caller, { resourceId: room.id, windows: week }, clock)
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(db, { tenantId, waId, displayName: 'Cliente' }, clock)
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
  return { ...boot, db, clock, tenantId, caller, contact, cnv, micro, pro, zones }
}

describe('S23 — remarcação end-to-end', () => {
  it('não oferece o horário já marcado na lista de remarcação', async () => {
    const NOW = Date.UTC(2026, 10, 17, 15, 0)
    const s = seedLab(NOW, '5511900000123')
    try {
      const tue0900 = zonedCivilToUtc(TZ, 2026, 11, 18, 9, 0)
      confirmAppointmentOp(
        s.db,
        s.caller,
        {
          clientRequestId: 'apt-s23',
          serviceId: s.micro.id,
          professionalId: s.pro.id,
          startsAt: tue0900,
          contactId: s.contact.id,
          conversationId: s.cnv.id,
          actorClerkUserId: s.caller.actorId!,
          zoneIds: s.zones.map((z) => z.id),
        },
        s.clock,
      )
      const out = await tryAiReschedule(s.db, s.caller, s.clock, {
        conversationId: s.cnv.id,
        inboundText: 'preciso remarcar na quarta de manhã',
        capability: true,
      })
      expect(out?.replyText).toMatch(/remarcar/i)
      expect(out?.replyText ?? '').not.toMatch(/\b09:00\b/)
    } finally {
      s.close()
    }
  })

  it('confirmação booked usa «Remarcado: de … para …»', () => {
    const startsOld = Date.UTC(2026, 10, 18, 12, 0)
    const startsNew = Date.UTC(2026, 10, 20, 12, 0)
    const body = renderProposalResultBody(
      {
        id: 'p1',
        tenantId: 't',
        lineageId: 'l',
        version: 1,
        contactId: 'c',
        conversationId: 'cnv',
        state: 'confirmada',
        clinicLocationText: '',
        beneficiaryKind: 'titular',
        beneficiaryName: 'X',
        serviceId: 'svc',
        serviceName: 'Microagulhamento',
        professionalId: 'pro',
        professionalName: null,
        startsAt: startsNew,
        endsAt: startsNew + 3_600_000,
        durationMinutes: 60,
        timezone: TZ,
        priceCents: 0,
        requiresSignal: false,
        signalKind: null,
        signalFixedCents: null,
        signalPercent: null,
        signalConditionsText: '',
        expiresAt: null,
        sentAt: null,
        supersededById: null,
        appointmentId: 'apt',
        replacesAppointmentId: 'apt-old',
        sendOutboundId: null,
        sendMessageId: null,
        sendProviderMessageId: null,
        resultOutboundId: null,
        resultKind: null,
        tempoCeu: 'tanto_faz',
        tempoTemperatura: 'tanto_faz',
        tempoCelsius: null,
        confirmSuspended: false,
        createdAt: 0,
        updatedAt: 0,
      },
      'booked',
      { replacedStartsAt: startsOld, omitDoubtFallback: true },
    )
    expect(body).toMatch(/^Remarcado: de .+ para .+/)
    expect(body).not.toMatch(/^Agendado:/)
  })
})

describe('S24 — cancelamento só com botão', () => {
  it('insistência em cancelar oferece botão e o toque cancela sem handoff', async () => {
    const NOW = Date.UTC(2026, 10, 16, 15, 0)
    const s = seedLab(NOW, '5511900000124')
    try {
      const starts = zonedCivilToUtc(TZ, 2026, 11, 20, 12, 0)
      const booked = confirmAppointmentOp(
        s.db,
        s.caller,
        {
          clientRequestId: 'apt-s24',
          serviceId: s.micro.id,
          professionalId: s.pro.id,
          startsAt: starts,
          contactId: s.contact.id,
          conversationId: s.cnv.id,
          actorClerkUserId: s.caller.actorId!,
          zoneIds: s.zones.map((z) => z.id),
        },
        s.clock,
      )
      const first = handleCancelIntentAutodraft(
        s.db,
        s.tenantId,
        s.cnv.id,
        s.contact.id,
        'vou ter q cancelar o microagulhamento',
        s.clock,
      )
      expect(first.handled).toBe(true)
      if (!first.handled) return
      expect(first.replyText).toMatch(/remarcar/i)
      expect(getBookingFrame(s.db, s.tenantId, s.cnv.id)?.rescheduleAppointmentId).toBe(booked.value.id)

      const second = tryCancelAutodraftContinuation(
        s.db,
        s.tenantId,
        s.cnv.id,
        'não, só cancelar mesmo',
        s.clock,
      )
      expect(second.handled).toBe(true)
      if (!second.handled) return
      expect(second.interactive?.buttons?.[0]?.title).toBe('Cancelar marcação')

      const click = handleCancelConfirmButtonClick(
        s.db,
        s.caller,
        {
          tenantId: s.tenantId,
          contactId: s.contact.id,
          conversationId: s.cnv.id,
          buttonId: cancelConfirmButtonId(booked.value.id),
        },
        s.clock,
      )
      expect(click.handled).toBe(true)
      const row = s.db.get<{ status: string }>(
        `SELECT status FROM appointments WHERE tenant_id = ? AND id = ?`,
        s.tenantId,
        booked.value.id,
      )
      expect(row?.status).toBe('cancelled')
      const alert = s.db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM operational_audit WHERE tenant_id = ? AND action = 'conversation.flagged_for_review' AND detail_json LIKE ?`,
        s.tenantId,
        `%${s.cnv.id}%`,
      )?.n
      expect(alert ?? 0).toBe(0)
    } finally {
      s.close()
    }
  })
})

describe('S25 — dia errado no cancelamento', () => {
  it('várias marcações e dia sem match → lista interativa com serviço e hora', () => {
    const NOW = Date.UTC(2026, 10, 16, 15, 0)
    const s = seedLab(NOW, '5511900000126')
    try {
      const wed = zonedCivilToUtc(TZ, 2026, 11, 18, 9, 0)
      const fri = zonedCivilToUtc(TZ, 2026, 11, 20, 12, 0)
      confirmAppointmentOp(
        s.db,
        s.caller,
        {
          clientRequestId: 'apt-s25a',
          serviceId: s.micro.id,
          professionalId: s.pro.id,
          startsAt: wed,
          contactId: s.contact.id,
          conversationId: s.cnv.id,
          actorClerkUserId: s.caller.actorId!,
          zoneIds: s.zones.map((z) => z.id),
        },
        s.clock,
      )
      confirmAppointmentOp(
        s.db,
        s.caller,
        {
          clientRequestId: 'apt-s25b',
          serviceId: s.micro.id,
          professionalId: s.pro.id,
          startsAt: fri,
          contactId: s.contact.id,
          conversationId: s.cnv.id,
          actorClerkUserId: s.caller.actorId!,
          zoneIds: s.zones.map((z) => z.id),
        },
        s.clock,
      )
      const start = handleCancelIntentAutodraft(
        s.db,
        s.tenantId,
        s.cnv.id,
        s.contact.id,
        'preciso cancelar na quinta',
        s.clock,
        { capability: true },
      )
      expect(start.handled).toBe(true)
      if (!start.handled) return
      expect(start.reason).toBe('cancel_disambiguate')
      expect(start.interactive?.list?.button).toBe(SLOT_LIST_BUTTON_LABEL)
      const rows = start.interactive?.list?.sections.flatMap((sec) => sec.rows) ?? []
      expect(rows).toHaveLength(2)
      expect(rows.map((r) => r.title)).toContain('Microagulhamento')
      expect(rows.some((r) => (r.description ?? r.title).match(/18\/11|20\/11/))).toBe(true)

      const sent = sendOutboundMessageOp(
        s.db,
        s.caller,
        {
          conversationId: s.cnv.id,
          body: start.replyText,
          interactive: start.interactive ?? null,
          clientRequestId: 'test-cancel-list',
          authorClerkUserId: s.caller.actorId!,
          authorDisplayName: 'Test',
          ...(start.deferredFrame?.hasWork
            ? { afterPersist: start.deferredFrame.toAfterPersist(s.clock) }
            : {}),
        },
        s.clock,
      )
      expect(sent.outbox.length).toBeGreaterThan(0)
    } finally {
      s.close()
    }
  })

  it('toque na lista escolhe a marcação e só cancela após o botão', async () => {
    const NOW = Date.UTC(2026, 10, 16, 15, 0)
    const s = seedLab(NOW, '5511900000127')
    try {
      const wed = zonedCivilToUtc(TZ, 2026, 11, 18, 9, 0)
      const fri = zonedCivilToUtc(TZ, 2026, 11, 20, 12, 0)
      const aptWed = confirmAppointmentOp(
        s.db,
        s.caller,
        {
          clientRequestId: 'apt-s25c',
          serviceId: s.micro.id,
          professionalId: s.pro.id,
          startsAt: wed,
          contactId: s.contact.id,
          conversationId: s.cnv.id,
          actorClerkUserId: s.caller.actorId!,
          zoneIds: s.zones.map((z) => z.id),
        },
        s.clock,
      )
      const aptFri = confirmAppointmentOp(
        s.db,
        s.caller,
        {
          clientRequestId: 'apt-s25d',
          serviceId: s.micro.id,
          professionalId: s.pro.id,
          startsAt: fri,
          contactId: s.contact.id,
          conversationId: s.cnv.id,
          actorClerkUserId: s.caller.actorId!,
          zoneIds: s.zones.map((z) => z.id),
        },
        s.clock,
      )
      const catalogVersion = readCatalogVersion(s.db, s.tenantId)
      const built = buildCancelAppointmentChoiceInteractive({
        catalogVersion,
        appointments: [
          {
            id: aptWed.value.id,
            serviceName: 'Microagulhamento',
            whenLabel: 'terça 18/11 às 09:00',
          },
          {
            id: aptFri.value.id,
            serviceName: 'Microagulhamento',
            whenLabel: 'sexta 20/11 às 12:00',
          },
        ],
      })
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        {
          catalogVersion,
          pending: {
            ...built.pending,
            messageId: insertMessage(
              s.db,
              {
                tenantId: s.tenantId,
                conversationId: s.cnv.id,
                direction: 'outbound',
                body: 'lista',
                deliveryState: 'delivered',
                createdAt: s.clock.nowMs(),
              },
              s.clock,
            ).id,
          },
        },
        s.clock,
      )
      const pickFri = encodeChoiceId('marcacao', catalogVersion, aptFri.value.id)
      const click = await handleChoiceOfferClick(
        s.db,
        s.caller,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          buttonId: pickFri,
          capability: true,
        },
        s.clock,
      )
      expect(click.handled).toBe(true)
      expect(getBookingFrame(s.db, s.tenantId, s.cnv.id)?.rescheduleAppointmentId).toBe(aptFri.value.id)

      let row = s.db.get<{ status: string }>(
        `SELECT status FROM appointments WHERE tenant_id = ? AND id = ?`,
        s.tenantId,
        aptFri.value.id,
      )
      expect(row?.status).toBe('confirmed')

      const insist = tryCancelAutodraftContinuation(
        s.db,
        s.tenantId,
        s.cnv.id,
        'não, só cancelar',
        s.clock,
      )
      expect(insist.handled).toBe(true)
      if (!insist.handled) return
      row = s.db.get<{ status: string }>(
        `SELECT status FROM appointments WHERE tenant_id = ? AND id = ?`,
        s.tenantId,
        aptFri.value.id,
      )
      expect(row?.status).toBe('confirmed')

      const confirmed = handleCancelConfirmButtonClick(
        s.db,
        s.caller,
        {
          tenantId: s.tenantId,
          contactId: s.contact.id,
          conversationId: s.cnv.id,
          buttonId: cancelConfirmButtonId(aptFri.value.id),
        },
        s.clock,
      )
      expect(confirmed.handled).toBe(true)
      row = s.db.get<{ status: string }>(
        `SELECT status FROM appointments WHERE tenant_id = ? AND id = ?`,
        s.tenantId,
        aptFri.value.id,
      )
      expect(row?.status).toBe('cancelled')
    } finally {
      s.close()
    }
  })

  it('capacidade pausada mantém fallback em texto', () => {
    const NOW = Date.UTC(2026, 10, 16, 15, 0)
    const s = seedLab(NOW, '5511900000128')
    try {
      confirmAppointmentOp(
        s.db,
        s.caller,
        {
          clientRequestId: 'apt-s25e',
          serviceId: s.micro.id,
          professionalId: s.pro.id,
          startsAt: zonedCivilToUtc(TZ, 2026, 11, 18, 9, 0),
          contactId: s.contact.id,
          conversationId: s.cnv.id,
          actorClerkUserId: s.caller.actorId!,
          zoneIds: s.zones.map((z) => z.id),
        },
        s.clock,
      )
      confirmAppointmentOp(
        s.db,
        s.caller,
        {
          clientRequestId: 'apt-s25f',
          serviceId: s.micro.id,
          professionalId: s.pro.id,
          startsAt: zonedCivilToUtc(TZ, 2026, 11, 20, 12, 0),
          contactId: s.contact.id,
          conversationId: s.cnv.id,
          actorClerkUserId: s.caller.actorId!,
          zoneIds: s.zones.map((z) => z.id),
        },
        s.clock,
      )
      const start = handleCancelIntentAutodraft(
        s.db,
        s.tenantId,
        s.cnv.id,
        s.contact.id,
        'cancelar quinta',
        s.clock,
        { capability: false },
      )
      expect(start.handled).toBe(true)
      if (!start.handled) return
      expect(start.interactive).toBeUndefined()
      expect(start.replyText).toMatch(/18\/11|20\/11/)
      expect(start.replyText).toMatch(/Microagulhamento/)
    } finally {
      s.close()
    }
  })

  it('aponta sexta quando a cliente disse quinta antes do botão', () => {
    const NOW = Date.UTC(2026, 10, 16, 15, 0)
    const s = seedLab(NOW, '5511900000125')
    try {
      const fri = zonedCivilToUtc(TZ, 2026, 11, 20, 12, 0)
      confirmAppointmentOp(
        s.db,
        s.caller,
        {
          clientRequestId: 'apt-s25',
          serviceId: s.micro.id,
          professionalId: s.pro.id,
          startsAt: fri,
          contactId: s.contact.id,
          conversationId: s.cnv.id,
          actorClerkUserId: s.caller.actorId!,
          zoneIds: s.zones.map((z) => z.id),
        },
        s.clock,
      )
      const res = resolveCancelTargetAppointment(
        s.db,
        s.tenantId,
        s.contact.id,
        'vou cancelar o microagulhamento de quinta',
        s.clock,
      )
      expect(res.kind).toBe('day_mismatch')
      if (res.kind !== 'day_mismatch') return
      expect(res.replyText).toMatch(/sexta|20\/11/i)
      expect(res.replyText).toMatch(/quinta/i)
      expect(res.replyText).toMatch(/é essa/i)
      expect(res.replyText).toMatch(/não encontrei marcação/i)
    } finally {
      s.close()
    }
  })
})