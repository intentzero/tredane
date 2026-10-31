import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { ingestContactMessage, workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { seedSyntheticWhatsappTemplates } from './templates'
import { sendOutboundMessageOp } from './operations'
import {
  applyHumanOutboundPrefix,
  isHumanStaffAuthor,
  shouldPrefixHumanOutbound,
} from './human-prefix'

describe('DEC-088 human outbound prefix', () => {
  it('formata e é idempotente', () => {
    expect(applyHumanOutboundPrefix('Pode ser às 16h?', 'Ana')).toBe('[Ana] Pode ser às 16h?')
    expect(applyHumanOutboundPrefix('[Ana] Já dito', 'Ana')).toBe('[Ana] Já dito')
    expect(applyHumanOutboundPrefix('x', '  ')).toBe('x')
  })

  it('só texto livre de humano', () => {
    expect(isHumanStaffAuthor('user_ana')).toBe(true)
    expect(isHumanStaffAuthor('system:ai-autodraft')).toBe(false)
    expect(
      shouldPrefixHumanOutbound({
        kind: 'text',
        authorClerkUserId: 'user_ana',
        authorDisplayName: 'Ana',
      }),
    ).toBe(true)
    expect(
      shouldPrefixHumanOutbound({
        kind: 'interactive',
        authorClerkUserId: 'user_ana',
        authorDisplayName: 'Ana',
      }),
    ).toBe(false)
    expect(
      shouldPrefixHumanOutbound({
        kind: 'text',
        authorClerkUserId: 'system:ai-autodraft',
        authorDisplayName: 'IA',
      }),
    ).toBe(false)
  })

  it('sendOutboundMessageOp prefixa só o payload whatsapp.send', () => {
    const clock = createControllableClock(Date.UTC(2026, 9, 31, 15))
    const { db, close } = bootClinicDb({ clock })
    try {
      const caller = workerCaller('clinic-demo-a', 'user_synth_attendant_a')
      syncWhatsappChannel(
        db,
        'clinic-demo-a',
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
      seedSyntheticWhatsappTemplates(db, 'clinic-demo-a', clock)
      const ingested = ingestContactMessage(
        db,
        caller,
        {
          providerEventKey: 'wa:prefix:1',
          waId: '5511987001999',
          body: 'oi',
        },
        clock,
      )
      const sent = sendOutboundMessageOp(
        db,
        caller,
        {
          conversationId: ingested.conversation!.id,
          body: 'Pode ser às 16h?',
          clientRequestId: 'prefix-req-1',
          authorClerkUserId: 'user_synth_attendant_a',
          authorDisplayName: 'Ana',
        },
        clock,
      )
      expect(sent.value.message.body).toBe('Pode ser às 16h?')
      const sendOb = sent.outbox.find((o) => o.type === 'whatsapp.send')
      expect(sendOb).toBeTruthy()
      const payload = JSON.parse(sendOb!.payloadJson) as { body: string }
      expect(payload.body).toBe('[Ana] Pode ser às 16h?')
      const dup = sendOutboundMessageOp(
        db,
        caller,
        {
          conversationId: ingested.conversation!.id,
          body: 'Pode ser às 16h?',
          clientRequestId: 'prefix-req-1',
          authorClerkUserId: 'user_synth_attendant_a',
          authorDisplayName: 'Ana',
        },
        clock,
      )
      expect(dup.value.duplicate).toBe(true)
      expect(dup.value.message.body).toBe('Pode ser às 16h?')
    } finally {
      close()
    }
  })
})
