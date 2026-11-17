import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../db/clock'
import { upsertContact } from '../clinic/contacts'
import { createConversation } from '../clinic/inbox/conversations'
import { seedSyntheticWhatsappTemplates } from '../clinic/inbox/templates'
import { bootClinicDb } from '../clinic/test-db'
import { syncWhatsappChannel } from '../clinic/whatsapp/channel'
import { IDLE_PROMPT_BODY, sweepDueIdleConversations } from '../clinic/followup/idle'
import { insertMessage } from '../clinic/inbox/messages'
import { ensureOpenOpportunity } from '../clinic/pipeline/operations'
import {
  ALARM_SHED_AUTODRAFT_THRESHOLD,
  ALARM_SHED_IDLE_THRESHOLD,
  countDueAlarmBacklog,
  shedDueAlarmBacklog,
} from './clinic-do-alarm-shed'

const TENANT = 'clinic-demo-a'

function connectWa(
  db: ReturnType<typeof bootClinicDb>['db'],
  clock: ReturnType<typeof createControllableClock>,
) {
  syncWhatsappChannel(
    db,
    TENANT,
    {
      status: 'connected',
      bindingId: 'b-shed',
      phoneNumberId: 'pn-shed',
      wabaId: 'w-shed',
      displayPhone: '+1555',
      action: 'channel_connected',
    },
    clock,
  )
  seedSyntheticWhatsappTemplates(db, TENANT, clock)
}
const NOW = Date.UTC(2026, 10, 15, 4, 0, 0)

describe('shedDueAlarmBacklog', () => {
  it('não limpa abaixo do limiar', () => {
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    try {
      const c1 = upsertContact(boot.db, { tenantId: TENANT, waId: '550000009001', displayName: 'A' }, clock)
      const c2 = upsertContact(boot.db, { tenantId: TENANT, waId: '550000009002', displayName: 'B' }, clock)
      const conv1 = createConversation(boot.db, { tenantId: TENANT, contactId: c1.id }, clock)
      const conv2 = createConversation(boot.db, { tenantId: TENANT, contactId: c2.id }, clock)
      for (const id of [conv1.id, conv2.id]) {
        boot.db.run(
          `UPDATE conversations SET idle_due_at = ?, idle_phase = 'prompt' WHERE tenant_id = ? AND id = ?`,
          NOW - 1,
          TENANT,
          id,
        )
      }
      boot.db.run(
        `INSERT INTO ai_autodraft_jobs
           (tenant_id, conversation_id, message_id, due_at, state, created_at, updated_at)
         VALUES (?, ?, 'msg1', ?, 'queued', ?, ?)`,
        TENANT,
        conv1.id,
        NOW - 1,
        NOW - 1_000,
        NOW - 1_000,
      )
      expect(ALARM_SHED_IDLE_THRESHOLD).toBeGreaterThan(2)
      expect(ALARM_SHED_AUTODRAFT_THRESHOLD).toBeGreaterThan(1)
      const r = shedDueAlarmBacklog(boot.db, TENANT, NOW)
      expect(r.shed).toBe(false)
      expect(countDueAlarmBacklog(boot.db, TENANT, NOW)).toEqual({ idleDue: 2, autodraftDue: 1 })
    } finally {
      boot.close()
    }
  })

  it('limpa idle e autodraft vencidos quando o backlog passa o limiar', () => {
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    try {
      const dueIds: string[] = []
      for (let i = 0; i < ALARM_SHED_IDLE_THRESHOLD; i++) {
        const contact = upsertContact(
          boot.db,
          { tenantId: TENANT, waId: `55000000901${i}`, displayName: `C${i}` },
          clock,
        )
        const conv = createConversation(boot.db, { tenantId: TENANT, contactId: contact.id }, clock)
        dueIds.push(conv.id)
        boot.db.run(
          `UPDATE conversations SET idle_due_at = ?, idle_phase = 'prompt' WHERE tenant_id = ? AND id = ?`,
          NOW - 1,
          TENANT,
          conv.id,
        )
      }
      const futureContact = upsertContact(
        boot.db,
        { tenantId: TENANT, waId: '550000009099', displayName: 'Future' },
        clock,
      )
      const future = createConversation(boot.db, { tenantId: TENANT, contactId: futureContact.id }, clock)
      boot.db.run(
        `UPDATE conversations SET idle_due_at = ?, idle_phase = 'prompt' WHERE tenant_id = ? AND id = ?`,
        NOW + 60_000,
        TENANT,
        future.id,
      )

      const due0 = dueIds[0]!
      const due1 = dueIds[1]!
      const due2 = dueIds[2] ?? future.id
      boot.db.run(
        `INSERT INTO ai_autodraft_jobs
           (tenant_id, conversation_id, message_id, due_at, state, created_at, updated_at)
         VALUES (?, ?, 'msg0', ?, 'queued', ?, ?)`,
        TENANT,
        due0,
        NOW - 1,
        NOW - 1_000,
        NOW - 1_000,
      )
      boot.db.run(
        `INSERT INTO ai_autodraft_jobs
           (tenant_id, conversation_id, message_id, due_at, state, created_at, updated_at)
         VALUES (?, ?, 'msg1', ?, 'generating', ?, ?)`,
        TENANT,
        due1,
        NOW + 999,
        NOW - 1_000,
        NOW - 1_000,
      )
      boot.db.run(
        `INSERT INTO ai_autodraft_jobs
           (tenant_id, conversation_id, message_id, due_at, state, created_at, updated_at)
         VALUES (?, ?, 'msg2', ?, 'queued', ?, ?)`,
        TENANT,
        due2,
        NOW + 60_000,
        NOW - 1_000,
        NOW - 1_000,
      )

      const r = shedDueAlarmBacklog(boot.db, TENANT, NOW)
      expect(r.shed).toBe(true)
      expect(r.idleCleared).toBe(0)
      expect(r.idleDeferred).toBe(true)
      expect(r.autodraftDropped).toBe(2)
      expect(countDueAlarmBacklog(boot.db, TENANT, NOW)).toEqual({
        idleDue: ALARM_SHED_IDLE_THRESHOLD,
        autodraftDue: 0,
      })
      expect(
        boot.db.get<{ n: number }>(
          `SELECT COUNT(*) AS n FROM conversations WHERE tenant_id = ? AND idle_due_at IS NOT NULL`,
          TENANT,
        )?.n,
      ).toBe(ALARM_SHED_IDLE_THRESHOLD + 1)
      expect(
        boot.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ai_autodraft_jobs WHERE tenant_id = ?`, TENANT)
          ?.n,
      ).toBe(1)
    } finally {
      boot.close()
    }
  })

  it('shed por autodraft não apaga idle — o sweep DEC-087 ainda corre na passagem seguinte', () => {
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    try {
      connectWa(boot.db, clock)
      const contact = upsertContact(
        boot.db,
        { tenantId: TENANT, waId: '5511987654321', displayName: 'Idle' },
        clock,
      )
      const conv = createConversation(boot.db, { tenantId: TENANT, contactId: contact.id }, clock)
      ensureOpenOpportunity(
        boot.db,
        { tenantId: TENANT, contactId: contact.id, conversationId: conv.id },
        clock,
      )
      boot.db.run(
        `UPDATE conversations SET idle_due_at = ?, idle_phase = 'prompt' WHERE tenant_id = ? AND id = ?`,
        NOW - 1,
        TENANT,
        conv.id,
      )
      insertMessage(
        boot.db,
        {
          tenantId: TENANT,
          conversationId: conv.id,
          direction: 'inbound',
          body: 'oi',
          externalMessageId: 'wa:shed-idle',
          deliveryState: 'received',
          createdAt: NOW - 20 * 60_000,
        },
        clock,
      )
      const contact2 = upsertContact(
        boot.db,
        { tenantId: TENANT, waId: '5511987654322', displayName: 'B' },
        clock,
      )
      const conv2 = createConversation(boot.db, { tenantId: TENANT, contactId: contact2.id }, clock)
      boot.db.run(
        `INSERT INTO ai_autodraft_jobs
           (tenant_id, conversation_id, message_id, due_at, state, created_at, updated_at)
         VALUES (?, ?, 'msg-x', ?, 'queued', ?, ?)`,
        TENANT,
        conv.id,
        NOW - 1,
        NOW - 1_000,
        NOW - 1_000,
      )
      boot.db.run(
        `INSERT INTO ai_autodraft_jobs
           (tenant_id, conversation_id, message_id, due_at, state, created_at, updated_at)
         VALUES (?, ?, 'msg-y', ?, 'generating', ?, ?)`,
        TENANT,
        conv2.id,
        NOW + 9_999,
        NOW - 1_000,
        NOW - 1_000,
      )

      const r = shedDueAlarmBacklog(boot.db, TENANT, NOW)
      expect(r.shed).toBe(true)
      expect(r.autodraftDropped).toBe(ALARM_SHED_AUTODRAFT_THRESHOLD)
      expect(r.idleCleared).toBe(0)
      expect(
        boot.db.get<{ due: number | null; phase: string | null }>(
          `SELECT idle_due_at AS due, idle_phase AS phase FROM conversations WHERE id = ?`,
          conv.id,
        ),
      ).toEqual({ due: NOW - 1, phase: 'prompt' })

      const swept = sweepDueIdleConversations(boot.db, TENANT, clock)
      expect(swept.some((s) => s.conversationId === conv.id && s.action === 'prompted')).toBe(true)
      const prompt = boot.db.get<{ body: string }>(
        `SELECT body FROM messages WHERE conversation_id = ? AND body = ?`,
        conv.id,
        IDLE_PROMPT_BODY,
      )
      expect(prompt?.body).toBe(IDLE_PROMPT_BODY)
    } finally {
      boot.close()
    }
  })
})
