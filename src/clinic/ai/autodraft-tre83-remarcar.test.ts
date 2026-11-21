/**
 * TRE-83 — remarca fora do expediente: Abrir agenda sem handoff DEC-113.
 * Com e sem prepareClientWebOffer (residual: sem cta_url → reply, sem pausa).
 */
import { describe, expect, it } from 'vitest'
import type { AiGenerateResult } from '../../ai'
import { createControllableClock } from '../../db/clock'
import { setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import { setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { zonedCivilToUtc } from '../scheduling'
import { createClientWebHarness } from './evals/dialogs/clientweb-driver'
import { enqueueAutoDraft, runDueAutoDrafts } from './index'
import { HUMAN_HANDOFF_TEXT, readAiReplyPause } from './human-handoff'
import { OPEN_AGENDA_REPLY_BUTTON_ID } from '../../clientweb/offer'

/** Qui 19/11/2026 21:42 America/Sao_Paulo — fora do expediente (GU-26). */
const NOW = Date.UTC(2026, 10, 20, 0, 42)
const TZ = 'America/Sao_Paulo'

function seed() {
  const clock = createControllableClock(NOW)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-tre83'
  const caller = workerCaller(tenantId, 'user_tre83')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'bind_tre83',
      phoneNumberId: 'pn_tre83',
      wabaId: 'waba_tre83',
      displayPhone: '+5511900000183',
      displayName: 'Clínica Fictícia',
      action: 'channel_connected',
    },
    clock,
  )
  const bia = upsertResourceOp(db, caller, { kind: 'professional', name: 'Bia' }, clock)
  const peeling = upsertServiceOp(
    db,
    caller,
    {
      name: 'Limpeza de pele',
      durationMinutes: 60,
      bufferMinutes: 0,
      priceCents: 15000,
      professionalIds: [bia.id],
      roomRequirement: { mode: 'none' },
    },
    clock,
  )
  setWeeklyWindowsOp(
    db,
    caller,
    { resourceId: bia.id, windows: [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, startMinute: 540, endMinute: 1080 })) },
    clock,
  )
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(db, { tenantId, waId: '5511900000183', displayName: 'Cliente' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  const startsAt = zonedCivilToUtc(TZ, 2026, 11, 25, 10, 0)
  db.run(
    `INSERT INTO appointments (id, tenant_id, service_id, professional_id, starts_at, ends_at, status, created_at, contact_id, confirmed_by)
     VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, 'system:proposal-send')`,
    'apt_tre83',
    tenantId,
    peeling.id,
    bia.id,
    startsAt,
    startsAt + 60 * 60_000,
    clock.nowMs() - 60_000,
    contact.id,
  )
  const adapter = {
    providerId: 'test',
    mode: 'synthetic' as const,
    async generate(): Promise<AiGenerateResult> {
      throw new Error('model_called')
    },
    lastInspection() {
      return null
    },
  }
  const say = (body: string) =>
    insertMessage(
      db,
      {
        tenantId,
        conversationId: cnv.id,
        direction: 'inbound',
        body,
        deliveryState: 'received',
        createdAt: clock.nowMs(),
      },
      clock,
    )
  return { db, caller, tenantId, clock, cnv, say, adapter, close: boot.close }
}

describe('TRE-83 remarca fora do expediente', () => {
  it('com prepareClientWebOffer: web_remarcar_link, sem handoff', async () => {
    const s = seed()
    try {
      const web = createClientWebHarness()
      const inbound = s.say('Quero remarcar o meu agendamento')
      enqueueAutoDraft(s.db, s.tenantId, { conversationId: s.cnv.id, messageId: inbound.id }, s.clock)
      s.clock.advance(7_000)
      const out = await runDueAutoDrafts(s.db, s.caller, s.clock, {
        mode: 'synthetic',
        adapter: s.adapter,
        prepareClientWebOffer: web.prepareOffer,
        clinicName: 'Clínica Fictícia',
      })
      expect(out[0]?.reason).toBe('web_remarcar_link')
      expect(readAiReplyPause(s.db, s.tenantId, s.cnv.id)).toBeNull()
      expect(web.issued()[0]?.purpose).toBe('remarcar')
      const body = s.db.get<{ body: string }>(
        `SELECT body FROM messages WHERE tenant_id = ? AND direction = 'outbound' ORDER BY created_at DESC LIMIT 1`,
        s.tenantId,
      )?.body
      expect(body).toMatch(/remarcar/i)
      expect(body).not.toContain(HUMAN_HANDOFF_TEXT)
      expect(body).not.toMatch(/A equipe responde a partir/i)
    } finally {
      s.close()
    }
  })

  it('sem prepareClientWebOffer: frase + reply Abrir agenda, sem pausa (DEC-202)', async () => {
    const s = seed()
    try {
      const inbound = s.say('Quero remarcar o meu agendamento')
      enqueueAutoDraft(s.db, s.tenantId, { conversationId: s.cnv.id, messageId: inbound.id }, s.clock)
      s.clock.advance(7_000)
      const out = await runDueAutoDrafts(s.db, s.caller, s.clock, {
        mode: 'synthetic',
        adapter: s.adapter,
        clinicName: 'Clínica Fictícia',
      })
      expect(out[0]?.reason).toBe('web_remarcar_link')
      expect(readAiReplyPause(s.db, s.tenantId, s.cnv.id)).toBeNull()
      const row = s.db.get<{ body: string; interactive_json: string | null }>(
        `SELECT m.body AS body, o.interactive_json AS interactive_json
         FROM messages m
         LEFT JOIN outbound_messages o ON o.tenant_id = m.tenant_id AND o.message_id = m.id
         WHERE m.tenant_id = ? AND m.direction = 'outbound'
         ORDER BY m.created_at DESC LIMIT 1`,
        s.tenantId,
      )
      expect(row?.body).toMatch(/remarcar/i)
      expect(row?.body).not.toContain(HUMAN_HANDOFF_TEXT)
      expect(row?.interactive_json ?? '').toContain(OPEN_AGENDA_REPLY_BUTTON_ID)
    } finally {
      s.close()
    }
  })

  it('texto inbound «Abrir agenda» não reenvia CTA (DEC-220)', async () => {
    const s = seed()
    try {
      const web = createClientWebHarness()
      const first = s.say('Quero remarcar o meu agendamento')
      enqueueAutoDraft(s.db, s.tenantId, { conversationId: s.cnv.id, messageId: first.id }, s.clock)
      s.clock.advance(7_000)
      await runDueAutoDrafts(s.db, s.caller, s.clock, {
        mode: 'synthetic',
        adapter: s.adapter,
        prepareClientWebOffer: web.prepareOffer,
        clinicName: 'Clínica Fictícia',
      })
      const before = s.db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM messages WHERE tenant_id = ? AND direction = 'outbound'`,
        s.tenantId,
      )?.n
      const echo = s.say('Abrir agenda')
      enqueueAutoDraft(s.db, s.tenantId, { conversationId: s.cnv.id, messageId: echo.id }, s.clock)
      s.clock.advance(7_000)
      const out = await runDueAutoDrafts(s.db, s.caller, s.clock, {
        mode: 'synthetic',
        adapter: s.adapter,
        prepareClientWebOffer: web.prepareOffer,
        clinicName: 'Clínica Fictícia',
      })
      expect(out[0]?.reason).toBe('open_agenda_title_already_offered')
      const after = s.db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM messages WHERE tenant_id = ? AND direction = 'outbound'`,
        s.tenantId,
      )?.n
      expect(after).toBe(before)
      expect(web.issued()).toHaveLength(1)
    } finally {
      s.close()
    }
  })
})
