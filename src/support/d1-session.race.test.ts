import { describe, expect, it } from 'vitest'
import { bootAdminDb } from '../db/test-db'
import { asyncFromSync, type AsyncAdminDb } from '../db/admin/async-store'
import { approveSupportRequest, createSupportAccessRequest } from '../db/admin'
import { createControllableClock } from '../db/clock'
import {
  activateSupportSessionAsync,
  cancelSupportRequestAsync,
  consumeSupportHandoffAsync,
  decideSupportTerminationAsync,
  requestSupportTerminationAsync,
  revokeSupportSessionAsync,
} from './d1-session'

/**
 * No D1 não há transações interativas: a barreira de concorrência é `changes = 1` no `UPDATE`/`INSERT … SELECT`.
 * Estes testes **forçam a corrida**: seguram todas as escritas até as duas partes terem lido, de modo que só
 * a condição na própria instrução SQL separa o vencedor do perdedor.
 */
function gated(inner: AsyncAdminDb, reads: number): AsyncAdminDb {
  let seen = 0
  let release!: () => void
  const open = new Promise<void>((r) => (release = r))
  const isWrite = (sql: string) => /^\s*(UPDATE|INSERT)/i.test(sql)
  return {
    async get(sql, ...p) {
      const row = await inner.get(sql, ...p)
      if (!isWrite(sql) && ++seen >= reads) release()
      return row as never
    },
    all: (sql, ...p) => inner.all(sql, ...p),
    async run(sql, ...p) {
      if (isWrite(sql) && /support_(sessions|access_requests|termination_requests)/.test(sql)) await open
      return inner.run(sql, ...p)
    },
  }
}

const T0 = 3_100_000_000_000

function setup() {
  const boot = bootAdminDb()
  const clock = createControllableClock(T0)
  const raw = asyncFromSync(boot.db)
  const req = createSupportAccessRequest(boot.db, clock, {
    tenantId: 'clinic-demo-a',
    actorClerkUserId: 'user_synth_superadmin',
    subjectClerkUserId: 'user_synth_attendant_a',
    reason: 'x',
    scope: 'read_diagnostics',
  })
  approveSupportRequest(boot.db, clock, { requestId: req.id, ownerClerkUserId: 'user_synth_owner_a' })
  return { boot, clock, raw, requestId: req.id }
}
const actor = { actorClerkUserId: 'user_synth_superadmin', actorClerkSessionId: 'sess_a' }

describe('barreira de concorrência do ciclo da sessão de suporte (#853)', () => {
  it('duas ativações simultâneas do mesmo pedido criam uma só sessão', async () => {
    const { boot, clock, raw, requestId } = setup()
    try {
      const db = gated(raw, 2)
      const results = await Promise.allSettled([
        activateSupportSessionAsync(db, clock, { requestId, ...actor }),
        activateSupportSessionAsync(db, clock, { requestId, ...actor }),
      ])
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
      expect((failed.reason as { code?: string }).code).toBe('support_session_already_active')
      expect(Number(boot.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM support_sessions`)?.n)).toBe(1)
    } finally {
      boot.close()
    }
  })

  it('duas trocas simultâneas do mesmo handoff: só uma obtém o cookie', async () => {
    const { boot, clock, raw, requestId } = setup()
    try {
      const act = await activateSupportSessionAsync(raw, clock, { requestId, ...actor })
      const db = gated(raw, 2)
      const results = await Promise.allSettled([
        consumeSupportHandoffAsync(db, clock, { handoffCode: act.handoffCode, ...actor }),
        consumeSupportHandoffAsync(db, clock, { handoffCode: act.handoffCode, ...actor }),
      ])
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
      expect((failed.reason as { code?: string }).code).toBe('handoff_consume_conflict')
    } finally {
      boot.close()
    }
  })

  it('duas revogações simultâneas: uma vence, a outra dá conflito, e a auditoria tem uma só entrada', async () => {
    const { boot, clock, raw, requestId } = setup()
    try {
      const act = await activateSupportSessionAsync(raw, clock, { requestId, ...actor })
      const db = gated(raw, 2)
      const results = await Promise.allSettled([
        revokeSupportSessionAsync(db, clock, { sessionId: act.session.id, actorClerkUserId: 'user_synth_owner_a', asOwner: true }),
        revokeSupportSessionAsync(db, clock, { sessionId: act.session.id, actorClerkUserId: 'user_synth_superadmin' }),
      ])
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
      expect((failed.reason as { code?: string }).code).toBe('support_revoke_conflict')
      const audits = boot.db.all<{ n: number }>(`SELECT COUNT(*) AS n FROM central_audit_events WHERE action = 'support.session.revoke'`)
      expect(Number(audits[0]!.n)).toBe(1)
    } finally {
      boot.close()
    }
  })

  it('cancelar e ativar ao mesmo tempo: nunca fica uma sessão ativa de um pedido cancelado', async () => {
    const { boot, clock, raw, requestId } = setup()
    try {
      const db = gated(raw, 2)
      await Promise.allSettled([
        activateSupportSessionAsync(db, clock, { requestId, ...actor }),
        cancelSupportRequestAsync(db, clock, { requestId, actorClerkUserId: 'user_synth_superadmin' }),
      ])
      const row = boot.db.get<{ s: string; n: number }>(
        `SELECT r.status AS s, (SELECT COUNT(*) FROM support_sessions x WHERE x.support_access_request_id = r.id) AS n
         FROM support_access_requests r WHERE r.id = ?`,
        requestId,
      )!
      // Ou há sessão e o pedido ficou aprovado, ou foi cancelado e não há sessão: nunca as duas coisas.
      expect(row.s === 'cancelled' ? Number(row.n) : Number(row.n) - 1).toBe(0)
    } finally {
      boot.close()
    }
  })

  it('dois pedidos de fim simultâneos do subject: um só pedido pendente, o outro recebe o mesmo', async () => {
    const { boot, clock, raw, requestId } = setup()
    try {
      const act = await activateSupportSessionAsync(raw, clock, { requestId, ...actor })
      // Cada pedido faz 3 leituras antes de escrever: a escrita só abre quando os dois as fizeram.
      const db = gated(raw, 6)
      const input = { sessionId: act.session.id, subjectClerkUserId: 'user_synth_attendant_a' }
      const results = await Promise.all([
        requestSupportTerminationAsync(db, clock, input),
        requestSupportTerminationAsync(db, clock, input),
      ])
      expect(results.filter((r) => r.created)).toHaveLength(1)
      expect(results[0]!.id).toBe(results[1]!.id)
      const n = boot.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM support_termination_requests WHERE status = 'pending'`)
      expect(Number(n?.n)).toBe(1)
      const audits = boot.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM central_audit_events WHERE action = 'support.termination.request'`)
      expect(Number(audits?.n)).toBe(1)
    } finally {
      boot.close()
    }
  })

  it.each([
    ['manter primeiro', ['keep', 'end']],
    ['encerrar primeiro', ['end', 'keep']],
  ] as const)('«manter» e «encerrar» simultâneos (%s): uma decisão vence e a sessão fica coerente com ela', async (_n, order) => {
    const { boot, clock, raw, requestId } = setup()
    try {
      const act = await activateSupportSessionAsync(raw, clock, { requestId, ...actor })
      const term = await requestSupportTerminationAsync(raw, clock, {
        sessionId: act.session.id,
        subjectClerkUserId: 'user_synth_attendant_a',
      })
      const db = gated(raw, 6)
      const decide = (decision: 'end' | 'keep') =>
        decideSupportTerminationAsync(db, clock, { terminationRequestId: term.id, ownerClerkUserId: 'user_synth_owner_a', decision })
      const results = await Promise.allSettled(order.map((d) => decide(d)))
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
      expect((failed.reason as { code?: string }).code).toBe('termination_decide_conflict')
      const row = boot.db.get<{ t: string; s: string }>(
        `SELECT t.status AS t, s.status AS s FROM support_termination_requests t
         JOIN support_sessions s ON s.id = t.support_session_id WHERE t.id = ?`,
        term.id,
      )!
      expect(row.s).toBe(row.t === 'declined' ? 'active' : 'revoked')
      expect(['declined', 'accepted']).toContain(row.t)
    } finally {
      boot.close()
    }
  })
})
