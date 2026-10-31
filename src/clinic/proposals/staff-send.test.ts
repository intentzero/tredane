/**
 * Atendente → proposta versionada (DEC-061), sem marcar.
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import {
  setAiProfileOp,
  setWeeklyWindowsOp,
  upsertResourceOp,
  upsertServiceOp,
} from '../config'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { clinicInbox } from '../index'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { getActiveProposalForConversation } from './proposals'
import { createAndSendStaffProposalOp } from './staff-send'

const T0 = Date.UTC(2026, 9, 29, 15, 0)

describe('createAndSendStaffProposalOp', () => {
  it('enfileira proposta interactive e não cria compromisso', () => {
    const clock = createControllableClock(T0)
    const boot = bootClinicDb({ clock })
    const { db } = boot
    const tenantId = 'clinic-demo-staff-prop'
    const caller = workerCaller(tenantId, 'user_synth_owner_a')
    syncWhatsappChannel(
      db,
      tenantId,
      {
        status: 'connected',
        bindingId: 'bind_staff',
        phoneNumberId: 'pn_staff',
        wabaId: 'waba_staff',
        displayPhone: '+5511999000000',
        displayName: 'Clínica Staff',
        action: 'channel_connected',
      },
      clock,
    )
    clinicInbox.seedSyntheticWhatsappTemplates(db, tenantId, clock)
    const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala 1' }, clock)
    const pro = upsertResourceOp(
      db,
      caller,
      { kind: 'professional', name: 'Dra. Ana', homeRoomId: room.id },
      clock,
    )
    const svc = upsertServiceOp(
      db,
      caller,
      {
        name: 'Limpeza',
        durationMinutes: 45,
        bufferMinutes: 15,
        priceCents: 18_000,
        professionalIds: [pro.id],
        roomRequirement: { mode: 'none' },
      },
      clock,
    )
    setWeeklyWindowsOp(
      db,
      caller,
      {
        resourceId: pro.id,
        windows: [{ dayOfWeek: 3, startMinute: 9 * 60, endMinute: 18 * 60 }],
      },
      clock,
    )
    setAiProfileOp(db, caller, { clinicAddress: 'Rua das Flores, 100' }, clock)
    const contact = upsertContact(
      db,
      { tenantId, waId: '5511999000999', displayName: 'Paulo' },
      clock,
    )
    const conversation = createConversation(
      db,
      { tenantId, contactId: contact.id, status: 'open' },
      clock,
    )
    // Abre janela de 24 h
    insertMessage(
      db,
      {
        tenantId,
        conversationId: conversation.id,
        direction: 'inbound',
        body: 'Queria agendar',
        externalMessageId: 'wamid_staff_in',
        deliveryState: 'received',
        createdAt: clock.nowMs(),
      },
      clock,
    )

    const startsAt = T0 + 2 * 60 * 60_000
    const result = createAndSendStaffProposalOp(
      db,
      caller,
      {
        clientRequestId: 'ui-staff-1',
        contactId: contact.id,
        conversationId: conversation.id,
        serviceId: svc.id,
        professionalId: pro.id,
        startsAt,
        durationMinutes: 45,
      },
      clock,
    )

    expect(result.appointmentCreated).toBe(false)
    expect(result.sendStatus).toBe('queued')
    expect(result.proposal.serviceName).toBe('Limpeza')
    expect(result.outbox.length).toBeGreaterThan(0)

    const active = getActiveProposalForConversation(db, tenantId, conversation.id, clock)
    expect(active?.id).toBe(result.proposal.id)

    const apts = db.all<{ id: string }>(
      `SELECT id FROM appointments WHERE tenant_id = ?`,
      tenantId,
    )
    expect(apts).toHaveLength(0)

    boot.close()
  })
})
