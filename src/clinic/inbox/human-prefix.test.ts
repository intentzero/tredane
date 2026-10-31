import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { ingestContactMessage, workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { seedSyntheticWhatsappTemplates } from './templates'
import { sendOutboundMessageOp } from './operations'
import {
  applyHumanOutboundPrefix,
  HUMAN_OUTBOUND_FALLBACK_NAME,
  isHumanStaffAuthor,
  isRoleOnlyDisplayName,
  resolveHumanOutboundDisplayName,
  shouldPrefixHumanOutbound,
} from './human-prefix'

describe('DEC-088 human outbound prefix', () => {
  it('formata e é idempotente com nome humano', () => {
    expect(applyHumanOutboundPrefix('Pode ser às 16h?', 'Ana')).toBe('[Ana] Pode ser às 16h?')
    expect(applyHumanOutboundPrefix('[Ana] Já dito', 'Ana')).toBe('[Ana] Já dito')
    expect(applyHumanOutboundPrefix('Oi', 'Maria')).toBe('[Maria] Oi')
  })

  it('usa primeiro nome de displayName completo', () => {
    expect(applyHumanOutboundPrefix('Oi', 'Maria Silva')).toBe('[Maria] Oi')
    expect(resolveHumanOutboundDisplayName('Maria Silva')).toBe('Maria')
  })

  it('nunca usa rótulo de papel no prefixo — fallback Equipe', () => {
    expect(isRoleOnlyDisplayName('Responsável')).toBe(true)
    expect(isRoleOnlyDisplayName('responsavel')).toBe(true)
    expect(isRoleOnlyDisplayName('Atendente')).toBe(true)
    expect(isRoleOnlyDisplayName('owner')).toBe(true)
    expect(isRoleOnlyDisplayName('Maria')).toBe(false)

    expect(resolveHumanOutboundDisplayName('Responsável')).toBe(HUMAN_OUTBOUND_FALLBACK_NAME)
    expect(resolveHumanOutboundDisplayName(null, 'Atendente')).toBe(HUMAN_OUTBOUND_FALLBACK_NAME)
    expect(applyHumanOutboundPrefix('Oi', 'Responsável')).toBe(
      `[${HUMAN_OUTBOUND_FALLBACK_NAME}] Oi`,
    )
    expect(applyHumanOutboundPrefix('Oi', '  ')).toBe(`[${HUMAN_OUTBOUND_FALLBACK_NAME}] Oi`)
  })

  it('preferência: nome humano sobre papel', () => {
    expect(resolveHumanOutboundDisplayName('Responsável', 'Maria')).toBe('Maria')
    expect(resolveHumanOutboundDisplayName('Maria', 'Responsável')).toBe('Maria')
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
        kind: 'text',
        authorClerkUserId: 'user_owner',
        authorDisplayName: 'Responsável',
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

  it('sendOutboundMessageOp prefixa só o payload whatsapp.send com [Maria]', () => {
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
          body: 'Oi',
          clientRequestId: 'prefix-maria-1',
          authorClerkUserId: 'user_synth_attendant_a',
          authorDisplayName: 'Maria',
        },
        clock,
      )
      expect(sent.value.message.body).toBe('Oi')
      const sendOb = sent.outbox.find((o) => o.type === 'whatsapp.send')
      expect(sendOb).toBeTruthy()
      const payload = JSON.parse(sendOb!.payloadJson) as { body: string }
      expect(payload.body).toBe('[Maria] Oi')
      expect(payload.body).not.toMatch(/Responsável|Atendente|owner/i)
    } finally {
      close()
    }
  })

  it('sendOutboundMessageOp com role «Responsável» não aparece no prefixo', () => {
    const clock = createControllableClock(Date.UTC(2026, 9, 31, 15))
    const { db, close } = bootClinicDb({ clock })
    try {
      const caller = workerCaller('clinic-demo-a', 'user_synth_owner_a')
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
          providerEventKey: 'wa:prefix:role',
          waId: '5511987001888',
          body: 'oi',
        },
        clock,
      )
      const sent = sendOutboundMessageOp(
        db,
        caller,
        {
          conversationId: ingested.conversation!.id,
          body: 'Oi',
          clientRequestId: 'prefix-role-1',
          authorClerkUserId: 'user_synth_owner_a',
          authorDisplayName: 'Responsável',
        },
        clock,
      )
      const sendOb = sent.outbox.find((o) => o.type === 'whatsapp.send')
      expect(sendOb).toBeTruthy()
      const payload = JSON.parse(sendOb!.payloadJson) as { body: string }
      expect(payload.body).toBe(`[${HUMAN_OUTBOUND_FALLBACK_NAME}] Oi`)
      expect(payload.body).not.toContain('Responsável')
      expect(payload.body).not.toContain('[Atendente]')
    } finally {
      close()
    }
  })
})
