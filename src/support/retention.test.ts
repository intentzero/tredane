import { describe, expect, it } from 'vitest'
import { approveSupportRequest, createSupportAccessRequest } from '../db/admin'
import { asyncFromSync } from '../db/admin/async-store'
import { createControllableClock } from '../db/clock'
import { bootAdminDb } from '../db/test-db'
import { adminDbAsD1 } from '../clientweb/test-d1'
import { activateSupportSessionAsync, revokeSupportSessionAsync } from './d1-session'
import { SUPPORT_RETENTION_MS, purgeSupportRecords } from './retention'

/** Decisão 3 do Paulo (17/11/2026, #896): 5 anos depois do fim da sessão; ativas e recentes nunca. */
const T0 = 3_100_000_000_000
const DAY = 24 * 60 * 60 * 1000
const actor = { actorClerkUserId: 'user_synth_superadmin', actorClerkSessionId: 'sess_a' }

function boot() {
  const b = bootAdminDb()
  const clock = createControllableClock(T0)
  const raw = asyncFromSync(b.db)
  const d1 = adminDbAsD1(b.db)
  const count = (sql: string) => Number(b.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${sql}`)!.n)
  const request = () => {
    const r = createSupportAccessRequest(b.db, clock, {
      tenantId: 'clinic-demo-a',
      actorClerkUserId: 'user_synth_superadmin',
      subjectClerkUserId: 'user_synth_attendant_a',
      reason: 'x',
      scope: 'read_diagnostics',
    })
    approveSupportRequest(b.db, clock, { requestId: r.id, ownerClerkUserId: 'user_synth_owner_a' })
    return r.id
  }
  const audit = (action: string, at: number) =>
    b.db.run(
      `INSERT INTO central_audit_events (id, occurred_at, actor_clerk_user_id, tenant_id, action, object_type, outcome)
       VALUES (?, ?, 'user_synth_superadmin', 'clinic-demo-a', ?, 'conversation', 'success')`,
      `aud_${action}_${at}`,
      at,
      action,
    )
  return { b, clock, raw, d1, count, request, audit }
}

describe('retenção dos registos de suporte (#896)', () => {
  it('apaga sessão, pedido, término e leituras com mais de 5 anos; mantém o resto e audita a purga só com contagens', async () => {
    const t = boot()
    try {
      const requestId = t.request()
      const act = await activateSupportSessionAsync(t.raw, t.clock, { requestId, ...actor })
      await revokeSupportSessionAsync(t.raw, t.clock, { sessionId: act.session.id, actorClerkUserId: 'user_synth_owner_a', asOwner: true })
      t.audit('support.access', T0)
      t.audit('support.access.denied', T0)
      t.audit('support.session.activate', T0) // ciclo de vida: fora do prazo da decisão

      t.clock.advance(SUPPORT_RETENTION_MS + 2 * DAY)
      t.audit('support.access', t.clock.nowMs() - DAY) // recente: fica
      const result = await purgeSupportRecords(t.d1, t.clock)

      expect(result).toEqual({ ok: true, sessions: 1, requests: 1, accessEvents: 2 })
      expect(t.count('support_sessions')).toBe(0)
      expect(t.count('support_access_requests')).toBe(0)
      expect(t.count(`central_audit_events WHERE action = 'support.access'`)).toBe(1)
      // A auditoria do ciclo de vida (a real e a inserida acima) fica toda.
      expect(t.count(`central_audit_events WHERE id = 'aud_support.session.activate_${T0}'`)).toBe(1)
      expect(t.count(`central_audit_events WHERE action = 'support.session.activate'`)).toBe(2)
      const purge = t.b.db.get<{ metadata_json: string; actor_clerk_user_id: string }>(
        `SELECT metadata_json, actor_clerk_user_id FROM central_audit_events WHERE action = 'support.retention.purge'`,
      )!
      expect(purge.actor_clerk_user_id).toBe('system:support-retention')
      expect(JSON.parse(purge.metadata_json)).toMatchObject({ sessions: 1, requests: 1, accessEvents: 2 })
      expect(purge.metadata_json).not.toMatch(/user_synth|clinic-demo|x"/)
    } finally {
      t.b.close()
    }
  })

  it('dentro dos 5 anos não apaga nada e não escreve auditoria', async () => {
    const t = boot()
    try {
      const requestId = t.request()
      const act = await activateSupportSessionAsync(t.raw, t.clock, { requestId, ...actor })
      await revokeSupportSessionAsync(t.raw, t.clock, { sessionId: act.session.id, actorClerkUserId: 'user_synth_owner_a', asOwner: true })
      t.audit('support.access', T0)
      t.clock.advance(SUPPORT_RETENTION_MS - DAY)
      expect(await purgeSupportRecords(t.d1, t.clock)).toEqual({ ok: true, sessions: 0, requests: 0, accessEvents: 0 })
      expect(t.count('support_sessions')).toBe(1)
      expect(t.count('support_access_requests')).toBe(1)
      expect(t.count(`central_audit_events WHERE action = 'support.retention.purge'`)).toBe(0)
    } finally {
      t.b.close()
    }
  })

  it('uma sessão ativa nunca é apagada, nem com décadas; um pedido pendente também não', async () => {
    const t = boot()
    try {
      const requestId = t.request()
      await activateSupportSessionAsync(t.raw, t.clock, { requestId, ...actor }) // fica 'active' no D1
      const pending = createSupportAccessRequest(t.b.db, t.clock, {
        tenantId: 'clinic-demo-a',
        actorClerkUserId: 'user_synth_superadmin',
        subjectClerkUserId: 'user_synth_attendant_a',
        reason: 'y',
        scope: 'read_diagnostics',
      })
      // Defesa em profundidade: mesmo com um ended_at antigo por engano, «ativa» nunca se apaga.
      t.b.db.run(`UPDATE support_sessions SET ended_at = ? WHERE status = 'active'`, T0 - 10 * 365 * DAY)
      t.clock.advance(30 * 365 * DAY)
      const r = await purgeSupportRecords(t.d1, t.clock)
      expect(r).toMatchObject({ ok: true, sessions: 0 })
      expect(t.count('support_sessions')).toBe(1)
      expect(t.count(`support_access_requests WHERE id = '${pending.id}'`)).toBe(1)
    } finally {
      t.b.close()
    }
  })

  it('pedido rejeitado e antigo, sem sessão, é apagado; um pedido com sessão só depois da sessão', async () => {
    const t = boot()
    try {
      const rejected = createSupportAccessRequest(t.b.db, t.clock, {
        tenantId: 'clinic-demo-a',
        actorClerkUserId: 'user_synth_superadmin',
        subjectClerkUserId: 'user_synth_attendant_a',
        reason: 'z',
        scope: 'read_diagnostics',
      })
      t.b.db.run(`UPDATE support_access_requests SET status = 'rejected' WHERE id = ?`, rejected.id)
      t.clock.advance(SUPPORT_RETENTION_MS + 2 * DAY)
      const r = await purgeSupportRecords(t.d1, t.clock)
      expect(r).toMatchObject({ ok: true, requests: 1 })
      expect(t.count('support_access_requests')).toBe(0)
    } finally {
      t.b.close()
    }
  })

  it('falhar não lança', async () => {
    const t = boot()
    try {
      const broken = { prepare: () => { throw new Error('d1 em baixo') } } as unknown as D1Database
      expect(await purgeSupportRecords(broken, t.clock)).toEqual({ ok: false })
    } finally {
      t.b.close()
    }
  })

  it('o prazo é de 5 anos', () => {
    expect(SUPPORT_RETENTION_MS).toBe(5 * 365 * DAY)
  })
})
