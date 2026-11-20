import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { ingestContactMessage, workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import { setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import { upsertContact } from '../contacts'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { seedSyntheticWhatsappTemplates } from '../inbox/templates'
import { confirmAppointmentOp, rescheduleAppointmentOp, zonedCivilToUtc } from '../scheduling'
import {
  createOrSupersedeProposal,
  markProposalConfirmed,
  markProposalSent,
} from './proposals'
import { resolveReplacedStartsAt, sendProposalResultMessageOp } from './results'

const TENANT = 'clinic-demo-a'
const TZ = 'America/Sao_Paulo'

describe('resolveReplacedStartsAt / recibo Remarcado (TRE-93)', () => {
  it('após move in-place lê o horário antigo do evento, não a linha viva', () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 7, 15))
    const { db, close } = bootClinicDb({ clock })
    const caller = workerCaller(TENANT, 'user_synth_owner_a')
    try {
      const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala 1' }, clock)
      const pro = upsertResourceOp(
        db,
        caller,
        { kind: 'professional', name: 'Dra. Paula', homeRoomId: room.id },
        clock,
      )
      for (const resourceId of [pro.id, room.id]) {
        setWeeklyWindowsOp(
          db,
          caller,
          {
            resourceId,
            windows: [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 18 * 60 }],
          },
          clock,
        )
      }
      const svc = upsertServiceOp(
        db,
        caller,
        {
          name: 'Massagem',
          durationMinutes: 60,
          bufferMinutes: 0,
          priceCents: 10_000,
          professionalIds: [pro.id],
          roomRequirement: { mode: 'none' },
        },
        clock,
      )
      syncWhatsappChannel(
        db,
        TENANT,
        {
          status: 'connected',
          bindingId: 'b1',
          phoneNumberId: 'pn1',
          wabaId: 'w1',
          displayPhone: '+1555',
          action: 'channel_connected',
        },
        clock,
      )
      seedSyntheticWhatsappTemplates(db, TENANT, clock)
      const ing = ingestContactMessage(
        db,
        workerCaller(TENANT, 'system:ai-autodraft'),
        { providerEventKey: 'wa:tre93', waId: '5511999990000', body: 'oi' },
        clock,
      )
      const contact = upsertContact(
        db,
        { tenantId: TENANT, waId: '5511999990000', displayName: 'Gi' },
        clock,
      )
      const startsOld = zonedCivilToUtc(TZ, 2024, 1, 8, 9, 0)
      const startsNew = zonedCivilToUtc(TZ, 2024, 1, 8, 9, 30)
      const booked = confirmAppointmentOp(
        db,
        caller,
        {
          clientRequestId: 'book-tre93',
          serviceId: svc.id,
          professionalId: pro.id,
          roomResourceId: null,
          startsAt: startsOld,
          contactId: contact.id,
          conversationId: ing.conversation!.id,
          actorClerkUserId: 'user_synth_owner_a',
          actorDisplayName: 'Owner',
        },
        clock,
      )
      rescheduleAppointmentOp(
        db,
        caller,
        {
          clientRequestId: 'resched-tre93',
          appointmentId: booked.value.id,
          reason: 'contato_remarcou',
          professionalId: pro.id,
          roomResourceId: null,
          startsAt: startsNew,
          actorClerkUserId: 'user_synth_owner_a',
        },
        clock,
      )
      // Linha viva já é o novo horário — o bug lia isto como «antigo».
      const live = db.get<{ starts_at: number }>(
        `SELECT starts_at FROM appointments WHERE id = ?`,
        booked.value.id,
      )
      expect(live?.starts_at).toBe(startsNew)

      const proposal = createOrSupersedeProposal(
        db,
        TENANT,
        {
          contactId: contact.id,
          conversationId: ing.conversation!.id,
          serviceId: svc.id,
          professionalId: pro.id,
          startsAt: startsNew,
          endsAt: startsNew + 60 * 60_000,
          durationMinutes: 60,
          replacesAppointmentId: booked.value.id,
        },
        clock,
      ).proposal
      markProposalSent(db, TENANT, proposal.id, clock)
      markProposalConfirmed(db, TENANT, proposal.id, clock, booked.value.id)

      expect(resolveReplacedStartsAt(db, TENANT, proposal)).toBe(startsOld)

      const result = sendProposalResultMessageOp(
        db,
        caller,
        { proposalId: proposal.id, resultKind: 'booked', channel: 'web' },
        clock,
      )
      expect(result.status).toBe('queued')
      if (result.status !== 'queued') return
      expect(result.body).toMatch(
        /^Remarcado: de segunda 08\/01 às 09:00 para segunda 08\/01 às 09:30/,
      )
      expect(result.body).not.toMatch(/de (.+) para \1/)
    } finally {
      close()
    }
  })
})
