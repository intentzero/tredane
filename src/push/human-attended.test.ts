import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../db/clock'
import { notifyHumanHandoff } from '../clinic/ai/human-handoff'
import { upsertContact } from '../clinic/contacts'
import { createConversation, setConversationAssignee } from '../clinic/inbox/conversations'
import { bootClinicDb } from '../clinic/test-db'
import { syncWhatsappChannel } from '../clinic/whatsapp/channel'
import { isHumanAttendedConversation } from './human-attended'

const NOW = Date.UTC(2026, 10, 13, 12, 0)

describe('isHumanAttendedConversation (DEC-173)', () => {
  it('false no funil IA; true após Assumir; true em handoff', () => {
    const clock = createControllableClock(NOW)
    const { db, close } = bootClinicDb({ clock })
    try {
      const tenantId = 'clinic-demo-a'
      syncWhatsappChannel(
        db,
        tenantId,
        {
          status: 'connected',
          bindingId: 'bind_dec173',
          phoneNumberId: 'pn_dec173',
          wabaId: 'waba_dec173',
          displayPhone: '+5511900000173',
          displayName: 'Clínica DEC173',
          action: 'channel_connected',
        },
        clock,
      )
      const contact = upsertContact(
        db,
        { tenantId, waId: '5511900000174', displayName: 'Lia' },
        clock,
      )
      const cnv = createConversation(
        db,
        { tenantId, contactId: contact.id, status: 'new' },
        clock,
      )
      expect(
        isHumanAttendedConversation(db, tenantId, cnv.id, cnv.assigneeClerkUserId),
      ).toBe(false)

      setConversationAssignee(db, {
        tenantId,
        conversationId: cnv.id,
        assigneeClerkUserId: 'user_synth_owner_a',
        assigneeDisplayName: 'Ana',
        updatedAt: NOW,
      })
      expect(
        isHumanAttendedConversation(db, tenantId, cnv.id, 'user_synth_owner_a'),
      ).toBe(true)

      setConversationAssignee(db, {
        tenantId,
        conversationId: cnv.id,
        assigneeClerkUserId: null,
        assigneeDisplayName: null,
        updatedAt: NOW + 1,
      })
      expect(isHumanAttendedConversation(db, tenantId, cnv.id, null)).toBe(false)

      notifyHumanHandoff(
        db,
        tenantId,
        {
          conversationId: cnv.id,
          reason: 'customer_requested',
          clientRequestId: 'handoff-dec173',
        },
        clock,
      )
      expect(isHumanAttendedConversation(db, tenantId, cnv.id, null)).toBe(true)
    } finally {
      close()
    }
  })
})
