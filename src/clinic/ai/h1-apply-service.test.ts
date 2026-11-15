/**
 * DEC-190 / PR-C: extrator aplica serviceId validado quando léxico none.
 * Frases fictícias; adaptador fixo (sem Gateway).
 */
import { describe, expect, it } from 'vitest'
import {
  SimulatedAiAdapter,
  type AiGenerateInput,
  type AiGenerateResult,
} from '../../ai'
import { createControllableClock } from '../../db/clock'
import { setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import { setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { workerCaller } from '../envelopes'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { enqueueAutoDraft, runDueAutoDrafts } from './autodraft'
import { getBookingFrame } from './schedule-session'
import { listServices } from '../config/services'

const NOW = Date.UTC(2026, 10, 5, 15, 0)

class FixedServiceExtractAdapter extends SimulatedAiAdapter {
  constructor(private readonly serviceId: string) {
    super()
  }

  override async generate(input: AiGenerateInput): Promise<AiGenerateResult> {
    if (input.profile === 'extract' || (input.tools && input.tools.length > 0)) {
      return {
        ok: true,
        text: JSON.stringify({
          acts: ['marcar'],
          serviceId: this.serviceId,
          dateLiteral: 'amanhã',
          confidence: 0.5,
        }),
        provider: this.providerId,
        model: 'test-extract',
        latencyMs: 5,
        inputTokens: 20,
        outputTokens: 10,
        toolName: input.tools?.[0]?.name ?? 'extract_turn_slots',
      }
    }
    return super.generate(input)
  }
}

describe('DEC-190 H1 apply service quando léxico none', () => {
  it('«queria relaxar as costas amanhã» grava serviceId no frame via extrator', async () => {
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    const { db } = boot
    const tenantId = 'clinic-demo-h1'
    const caller = workerCaller(tenantId, 'user_synth_owner')
    try {
      syncWhatsappChannel(
        db,
        tenantId,
        {
          status: 'connected',
          bindingId: 'bind_h1',
          phoneNumberId: 'pn_h1',
          wabaId: 'waba_h1',
          displayPhone: '+5511900000190',
          displayName: 'Clínica H1',
          action: 'channel_connected',
        },
        clock,
      )
      const gi = upsertResourceOp(db, caller, { kind: 'professional', name: 'Gi' }, clock)
      const massagem = upsertServiceOp(
        db,
        caller,
        {
          name: 'Massagem relaxante',
          durationMinutes: 50,
          bufferMinutes: 0,
          priceCents: 15000,
          professionalIds: [gi.id],
          roomRequirement: { mode: 'none' },
        },
        clock,
      )
      setWeeklyWindowsOp(
        db,
        caller,
        {
          resourceId: gi.id,
          windows: [1, 2, 3, 4, 5].map((d) => ({
            dayOfWeek: d,
            startMinute: 540,
            endMinute: 1080,
          })),
        },
        clock,
      )
      setClinicAiAssistEnabled(db, tenantId, true, clock)
      const contact = upsertContact(
        db,
        { tenantId, waId: '5511900000190', displayName: 'Ana Ficticia' },
        clock,
      )
      const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
      const msg = insertMessage(
        db,
        {
          tenantId,
          conversationId: cnv.id,
          direction: 'inbound',
          body: 'queria relaxar as costas amanhã',
          deliveryState: 'received',
        },
        clock,
      )
      enqueueAutoDraft(db, tenantId, { conversationId: cnv.id, messageId: msg.id }, clock)
      clock.advance(7_000)
      await runDueAutoDrafts(db, caller, clock, {
        mode: 'synthetic',
        adapter: new FixedServiceExtractAdapter(massagem.id),
      })

      const frame = getBookingFrame(db, tenantId, cnv.id)
      expect(frame?.serviceId).toBe(massagem.id)
      expect(frame?.date).toBe('2026-11-06')
      // Sem inventar line (DEC-079).
      expect(frame?.line).toBeNull()
      expect(listServices(db, tenantId).some((s) => s.id === massagem.id)).toBe(true)
    } finally {
      boot.close()
    }
  })
})
