/**
 * S8 / #179 — minimização de contexto, isolamento e retenção de artefactos IA.
 * Dados sintéticos apenas.
 */
import { describe, expect, it } from 'vitest'
import {
  redactProhibitedFromText,
} from '../../ai'
import { systemClock } from '../../db/clock'
import { workerCaller } from '../envelopes'
import { upsertService } from '../config/services'
import { setClinicAiAssistEnabled, ensureClinicSettings } from '../config/settings'
import { upsertContact, listContacts } from '../contacts'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { ensureOpenOpportunity } from '../pipeline/operations'
import { bindOrAssertTenant } from '../tenant'
import { bootClinicDb } from '../test-db'
import {
  getClinicPurgeState,
  wipeClinicOperationalData,
} from '../retention/tenant-purge-local'
import {
  assertContextMinimized,
  buildAiContextPayload,
} from './index'

function seedClinic(
  db: ReturnType<typeof bootClinicDb>['db'],
  clock: ReturnType<typeof bootClinicDb>['clock'],
  tenantId: string,
  opts: {
    displayName: string
    waId: string
    inboundBodies: string[]
    services?: Array<{
      name: string
      priceCents: number | null
      clientExplanation: string | null
    }>
    googleBusinessUrl?: string
  },
) {
  const caller = workerCaller(tenantId, 'user_s8_test')
  bindOrAssertTenant(db, caller, clock)
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  if (opts.googleBusinessUrl) {
    ensureClinicSettings(db, tenantId, clock)
    db.run(
      `UPDATE clinic_settings SET google_business_url = ?, updated_at = ? WHERE id = 1 AND tenant_id = ?`,
      opts.googleBusinessUrl,
      clock.nowMs(),
      tenantId,
    )
  }
  for (const s of opts.services ?? [
    { name: 'Limpeza de pele', priceCents: 12000, clientExplanation: null },
  ]) {
    upsertService(
      db,
      tenantId,
      {
        name: s.name,
        durationMinutes: 60,
        bufferMinutes: 15,
        priceCents: s.priceCents,
        clientExplanation: s.clientExplanation,
        active: true,
        professionalIds: [],
        roomRequirement: { mode: 'none' },
      },
      clock,
    )
  }
  const contact = upsertContact(
    db,
    { tenantId, waId: opts.waId, displayName: opts.displayName },
    clock,
  )
  const cnv = createConversation(
    db,
    { tenantId, contactId: contact.id, status: 'open' },
    clock,
  )
  ensureOpenOpportunity(
    db,
    { tenantId, contactId: contact.id, conversationId: cnv.id },
    clock,
  )
  let t = clock.nowMs() - opts.inboundBodies.length * 1000
  for (const body of opts.inboundBodies) {
    insertMessage(
      db,
      {
        tenantId,
        conversationId: cnv.id,
        direction: 'inbound',
        body,
        deliveryState: 'received',
        createdAt: t,
      },
      clock,
    )
    t += 1000
  }
  return { caller, conversationId: cnv.id, contactId: contact.id }
}

describe('S8 minimização de contexto IA (#179)', () => {
  it('redactProhibitedFromText remove telefone, e-mail e tokens', () => {
    expect(redactProhibitedFromText('Liga +55 11 98888-7777')).toContain('[redacted]')
    expect(redactProhibitedFromText('wa.me/5511988887777')).toContain('[redacted]')
    expect(redactProhibitedFromText('manda em ana.ficticia@exemplo.com')).toContain('[redacted]')
    expect(redactProhibitedFromText('token Bearer sk-live-ABCDEFGH1234')).toContain('[redacted]')
    expect(redactProhibitedFromText('api_key=supersecretvalue99')).toContain('[redacted]')
    expect(redactProhibitedFromText('ghp_ABCDEFGHIJKLMNOP')).toContain('[redacted]')
  })

  it('catálogo com telefone no nome/explicação é redigido e assert falha se vazar', async () => {
    const { db, clock, close } = bootClinicDb()
    try {
      const tenantId = 'clinic-demo-s8-catalog'
      const seeded = seedClinic(db, clock, tenantId, {
        displayName: 'Marina Silva',
        waId: '5511987009001',
        inboundBodies: ['Oi'],
        services: [
          {
            name: 'Pacote Ligue 11999998888',
            priceCents: 10000,
            clientExplanation: 'Confirme no 11 98888-1234 antes',
          },
        ],
      })
      const built = await buildAiContextPayload(db, tenantId, seeded.conversationId)
      expect(built.payload.services[0]?.name).toContain('[redacted]')
      expect(built.payload.services[0]?.clientExplanation).toContain('[redacted]')
      assertContextMinimized(built.payload)
      expect(JSON.stringify(built.payload)).not.toMatch(/11999998888|98888-1234/)
    } finally {
      close()
    }
  })

  it('multi-conversa: só a conversa alvo entra no payload', async () => {
    const { db, clock, close } = bootClinicDb()
    try {
      const tenantId = 'clinic-demo-s8-multi'
      const a = seedClinic(db, clock, tenantId, {
        displayName: 'Ana A',
        waId: '5511987009010',
        inboundBodies: ['Segredo conversa A — laser facial'],
      })
      const contactB = upsertContact(
        db,
        { tenantId, waId: '5511987009011', displayName: 'Bia B' },
        clock,
      )
      const cnvB = createConversation(
        db,
        { tenantId, contactId: contactB.id, status: 'open' },
        clock,
      )
      insertMessage(
        db,
        {
          tenantId,
          conversationId: cnvB.id,
          direction: 'inbound',
          body: 'Segredo conversa B — botox',
          deliveryState: 'received',
          createdAt: clock.nowMs(),
        },
        clock,
      )

      const built = await buildAiContextPayload(db, tenantId, a.conversationId, { clock })
      assertContextMinimized(built.payload)
      const json = JSON.stringify(built.payload)
      expect(json).toContain('laser facial')
      expect(json).not.toContain('botox')
      expect(json).not.toContain('Segredo conversa B')
      expect(built._debugExcluded.otherConversationIds).toContain(cnvB.id)
      expect(built.payload.contactFirstName).toBe('Ana')
    } finally {
      close()
    }
  })

  it('wipe do tenant zera tabelas AI inclusive jobs e usage', () => {
    const { db, close } = bootClinicDb()
    try {
      const clock = systemClock
      const tenantId = 'clinic-demo-s8-wipe'
      const caller = workerCaller(tenantId, 'system')
      bindOrAssertTenant(db, caller, clock)
      const seeded = seedClinic(db, clock, tenantId, {
        displayName: 'Gina Wipe',
        waId: '5511987009050',
        inboundBodies: ['Oi'],
      })
      db.run(
        `INSERT INTO ai_autodraft_jobs (
          tenant_id, conversation_id, message_id, due_at, state, created_at, updated_at
        ) VALUES (?, ?, 'msg_w', ?, 'queued', ?, ?)`,
        tenantId,
        seeded.conversationId,
        clock.nowMs() + 1000,
        clock.nowMs(),
        clock.nowMs(),
      )
      db.run(
        `INSERT INTO ai_daily_usage (tenant_id, day, drafts, cap_reached_at) VALUES (?, '2099-01-01', 3, NULL)`,
        tenantId,
      )

      wipeClinicOperationalData(db, caller, clock)
      expect(getClinicPurgeState(db).status).toBe('wiped')
      expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM ai_suggestions')?.n).toBe(0)
      expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM ai_commands')?.n).toBe(0)
      expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM ai_autodraft_jobs')?.n).toBe(0)
      expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM ai_daily_usage')?.n).toBe(0)
      expect(listContacts(db, tenantId)).toHaveLength(0)
    } finally {
      close()
    }
  })

  it('assertContextMinimized rejeita telefone residual e segredos no JSON', () => {
    expect(() =>
      assertContextMinimized({
        contactFirstName: 'Ana',
        stage: null,
        services: [],
        messages: [{ direction: 'inbound', body: 'Liga 11988887777 agora' }],
        hasClinicOutbound: false,
        clinicOutboundCount: 0,
      }),
    ).toThrow(/ai_context_message_contains_phone/)

    expect(() =>
      assertContextMinimized({
        contactFirstName: 'Ana',
        stage: null,
        services: [],
        messages: [{ direction: 'inbound', body: 'ok' }],
        hasClinicOutbound: false,
        clinicOutboundCount: 0,
        phone: '5511999999999',
      } as Parameters<typeof assertContextMinimized>[0] & { phone: string }),
    ).toThrow(/ai_context_contains_prohibited_keys/)
  })

})
