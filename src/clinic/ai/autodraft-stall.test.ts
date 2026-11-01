/**
 * Job deixado em `generating` (alarme que não voltou) prende o spinner.
 * A passagem seguinte reabre a linha e termina o job.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SimulatedAiAdapter } from '../../ai'
import { createControllableClock } from '../../db/clock'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { bootClinicDb } from '../test-db'
import { getAutoDraftJob, runDueAutoDrafts } from './index'

const NOW = Date.UTC(2026, 10, 1, 12, 46, 0)

describe('rascunho automático órfão', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reabre um job generating e não o deixa preso', async () => {
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const tenantId = 'clinic-demo-a'
      const caller = workerCaller(tenantId)
      const contact = upsertContact(boot.db, { tenantId, waId: '5511900000099', displayName: 'Cliente' }, clock)
      const conversation = createConversation(boot.db, { tenantId, contactId: contact.id }, clock)
      const created = clock.nowMs() - 120_000
      boot.db.run(
        `INSERT INTO ai_autodraft_jobs
           (tenant_id, conversation_id, message_id, due_at, state, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'generating', ?, ?)`,
        tenantId,
        conversation.id,
        'msg_orphan',
        created,
        created,
        created,
      )
      const out = await runDueAutoDrafts(boot.db, caller, clock, {
        mode: 'synthetic',
        adapter: new SimulatedAiAdapter(),
      })
      expect(out).toEqual([
        expect.objectContaining({
          conversationId: conversation.id,
          status: 'skipped',
          reason: 'ai_not_enabled',
        }),
      ])
      expect(getAutoDraftJob(boot.db, tenantId, conversation.id)).toBeNull()
      const logged = warn.mock.calls.map((call) => String(call[0])).join('\n')
      expect(logged).toContain('"event":"ai.autodraft_stale"')
      expect(logged).toContain(`"tenantId":"${tenantId}"`)
      expect(logged).toContain('"count":1')
      expect(logged).not.toContain('msg_orphan')
    } finally {
      boot.close()
    }
  })
})
