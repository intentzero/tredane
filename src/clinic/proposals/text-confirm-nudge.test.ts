import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { APPOINTMENT_PROPOSAL_VALIDITY_MS } from '../constants'
import {
  setWeeklyWindowsOp,
  upsertResourceOp,
  upsertServiceOp,
} from '../config'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { confirmAppointmentOp, zonedCivilToUtc } from '../scheduling'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { createProposal, markProposalSent } from './index'
import {
  PROPOSAL_CONFIRM_NUDGE_LEAD,
  isProposalAffirmativeText,
  sendProposalConfirmNudgeOp,
  shouldReofferProposalOnAffirmText,
} from './text-confirm-nudge'
import type { AppointmentProposalRow } from './types'

const TZ = 'America/Sao_Paulo'
const T0 = Date.UTC(2026, 10, 16, 14, 0)

function openProposal(): AppointmentProposalRow {
  return {
    id: 'prop_nudge',
    tenantId: 't1',
    contactId: 'c1',
    conversationId: 'cnv1',
    serviceId: 'svc1',
    serviceName: 'Drenagem linfática',
    professionalId: 'p1',
    professionalName: 'Gi',
    startsAt: Date.UTC(2026, 10, 18, 16, 0),
    endsAt: Date.UTC(2026, 10, 18, 16, 45),
    durationMinutes: 45,
    timezone: TZ,
    priceCents: 16000,
    requiresSignal: false,
    signalKind: null,
    signalFixedCents: null,
    signalPercent: null,
    signalConditionsText: '',
    clinicLocationText: '',
    version: 1,
    state: 'enviada',
    beneficiaryKind: 'titular',
    replacesAppointmentId: null,
    createdAt: 0,
    updatedAt: 0,
    confirmSuspended: false,
    expiresAt: T0 + APPOINTMENT_PROPOSAL_VALIDITY_MS,
  } as unknown as AppointmentProposalRow
}

function seedNudge() {
  const clock = createControllableClock(T0)
  const boot = bootClinicDb({ clock })
  const tenantId = 'clinic-demo-dec061-nudge'
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  syncWhatsappChannel(
    boot.db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'bind_nudge',
      phoneNumberId: 'pn',
      wabaId: 'waba',
      displayPhone: '+5511999000200',
      displayName: 'Demo',
      action: 'channel_connected',
    },
    clock,
  )
  const room = upsertResourceOp(boot.db, caller, { kind: 'room', name: 'Sala 1', category: 'Sala' }, clock)
  const pro = upsertResourceOp(
    boot.db,
    caller,
    { kind: 'professional', name: 'Pro', homeRoomId: room.id },
    clock,
  )
  const svc = upsertServiceOp(
    boot.db,
    caller,
    {
      name: 'Drenagem linfática',
      durationMinutes: 45,
      bufferMinutes: 0,
      priceCents: 16_000,
      professionalIds: [pro.id],
      roomRequirement: { mode: 'rooms', resourceIds: [room.id] },
    },
    clock,
  )
  const week = [1, 2, 3, 4, 5, 6, 7].map((d) => ({
    dayOfWeek: d,
    startMinute: 9 * 60,
    endMinute: 19 * 60,
  }))
  setWeeklyWindowsOp(boot.db, caller, { resourceId: pro.id, windows: week }, clock)
  setWeeklyWindowsOp(boot.db, caller, { resourceId: room.id, windows: week }, clock)
  const contact = upsertContact(boot.db, { tenantId, waId: '5511999000300', displayName: 'Bia' }, clock)
  const cnv = createConversation(boot.db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  insertMessage(
    boot.db,
    {
      tenantId,
      conversationId: cnv.id,
      direction: 'inbound',
      body: 'oi',
      deliveryState: 'received',
      createdAt: clock.nowMs(),
    },
    clock,
  )
  return { ...boot, clock, tenantId, caller, pro, room, svc, contact, cnv }
}

describe('text-confirm-nudge (DEC-061)', () => {
  it.each([
    'sim',
    'ok',
    'ok 👍',
    'confirmo',
    'confirmar',
    'pode ser',
    'isso',
    'fechado, confirmo',
    'isso pode confirmar',
    'pode marcar',
    'sim pode marcar. obrigada',
    'ok aguardo entao obg',
  ])('isProposalAffirmativeText(%j) = true', (text) => {
    expect(isProposalAffirmativeText(text)).toBe(true)
  })

  it.each([
    'quero remarcar',
    'na verdade prefiro massagem',
    'tem horário amanhã?',
    'alo??',
  ])('isProposalAffirmativeText(%j) = false', (text) => {
    expect(isProposalAffirmativeText(text)).toBe(false)
  })

  it('shouldReofferProposalOnAffirmText com proposta enviada', () => {
    const open = openProposal()
    expect(
      shouldReofferProposalOnAffirmText({
        open,
        turnText: 'sim',
        tz: TZ,
      }),
    ).toBe(true)
    expect(
      shouldReofferProposalOnAffirmText({
        open: { ...open, confirmSuspended: true },
        turnText: 'sim',
        tz: TZ,
      }),
    ).toBe(false)
    expect(
      shouldReofferProposalOnAffirmText({
        open: { ...open, state: 'expirada' },
        turnText: 'sim',
        tz: TZ,
      }),
    ).toBe(false)
  })

  it('nudge copy DEC-061 (sem Show! repetido)', () => {
    expect(PROPOSAL_CONFIRM_NUDGE_LEAD).toBe('Para confirmar, toca em Confirmar 👇')
    expect(PROPOSAL_CONFIRM_NUDGE_LEAD).toMatch(/Confirmar/)
    expect(PROPOSAL_CONFIRM_NUDGE_LEAD).not.toMatch(/Show!|equipe validar|Não consigo confirmar/i)
  })

  it('sendProposalConfirmNudgeOp — só botão Confirmar, mesmo horário', () => {
    const s = seedNudge()
    try {
      const startsAt = zonedCivilToUtc(TZ, 2026, 11, 18, 13, 0)
      const proposal = createProposal(
        s.db,
        s.tenantId,
        {
          contactId: s.contact.id,
          conversationId: s.cnv.id,
          serviceId: s.svc.id,
          professionalId: s.pro.id,
          startsAt,
        },
        s.clock,
      )
      markProposalSent(s.db, s.tenantId, proposal.id, s.clock)
      const nudge = sendProposalConfirmNudgeOp(
        s.db,
        s.caller,
        {
          proposal,
          conversationId: s.cnv.id,
          clientRequestId: 'proposal.confirm_nudge:test:v1:msg1',
        },
        s.clock,
      )
      expect(nudge.status).toBe('queued')
      if (nudge.status === 'queued') {
        expect(nudge.lead).toBe(PROPOSAL_CONFIRM_NUDGE_LEAD)
        expect(nudge.interactive.buttons).toHaveLength(1)
        expect(nudge.interactive.buttons[0]?.title).toBe('Confirmar')
      }
      expect(
        s.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM appointments WHERE tenant_id = ?`, s.tenantId)!.n,
      ).toBe(0)
    } finally {
      s.close()
    }
  })

  it('proposta expirada → skipped_no_proposal (fallback)', () => {
    const s = seedNudge()
    try {
      const startsAt = zonedCivilToUtc(TZ, 2026, 11, 18, 13, 0)
      const proposal = createProposal(
        s.db,
        s.tenantId,
        {
          contactId: s.contact.id,
          conversationId: s.cnv.id,
          serviceId: s.svc.id,
          professionalId: s.pro.id,
          startsAt,
        },
        s.clock,
      )
      markProposalSent(s.db, s.tenantId, proposal.id, s.clock)
      s.clock.advance(APPOINTMENT_PROPOSAL_VALIDITY_MS + 1)
      const nudge = sendProposalConfirmNudgeOp(
        s.db,
        s.caller,
        {
          proposal,
          conversationId: s.cnv.id,
          clientRequestId: 'proposal.confirm_nudge:exp:v1:msg1',
        },
        s.clock,
      )
      expect(nudge.status).toBe('skipped_no_proposal')
    } finally {
      s.close()
    }
  })

  it('horário ocupado → skipped_no_proposal (fallback, sem marcar)', () => {
    const s = seedNudge()
    try {
      const startsAt = zonedCivilToUtc(TZ, 2026, 11, 18, 13, 0)
      confirmAppointmentOp(
        s.db,
        s.caller,
        {
          clientRequestId: 'apt-dec061-busy',
          contactId: s.contact.id,
          conversationId: s.cnv.id,
          serviceId: s.svc.id,
          professionalId: s.pro.id,
          roomResourceId: s.room.id,
          startsAt,
          contactLabel: 'Ocupado',
          actorClerkUserId: 'user_synth_owner_a',
        },
        s.clock,
      )
      const proposal = createProposal(
        s.db,
        s.tenantId,
        {
          contactId: s.contact.id,
          conversationId: s.cnv.id,
          serviceId: s.svc.id,
          professionalId: s.pro.id,
          startsAt,
        },
        s.clock,
      )
      markProposalSent(s.db, s.tenantId, proposal.id, s.clock)
      const nudge = sendProposalConfirmNudgeOp(
        s.db,
        s.caller,
        {
          proposal,
          conversationId: s.cnv.id,
          clientRequestId: 'proposal.confirm_nudge:busy:v1:msg1',
        },
        s.clock,
      )
      expect(nudge.status).toBe('skipped_no_proposal')
    } finally {
      s.close()
    }
  })

  it('sem proposta enviada → skipped_no_proposal', () => {
    const s = seedNudge()
    try {
      const startsAt = zonedCivilToUtc(TZ, 2026, 11, 18, 13, 0)
      const proposal = createProposal(
        s.db,
        s.tenantId,
        {
          contactId: s.contact.id,
          conversationId: s.cnv.id,
          serviceId: s.svc.id,
          professionalId: s.pro.id,
          startsAt,
        },
        s.clock,
      )
      const nudge = sendProposalConfirmNudgeOp(
        s.db,
        s.caller,
        {
          proposal,
          conversationId: s.cnv.id,
          clientRequestId: 'proposal.confirm_nudge:prep:v1:msg1',
        },
        s.clock,
      )
      expect(nudge.status).toBe('skipped_no_proposal')
    } finally {
      s.close()
    }
  })
})