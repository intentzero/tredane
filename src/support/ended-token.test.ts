import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { approveSupportRequest, createSupportAccessRequest } from '../db/admin'
import {
  activateSupportSession,
  consumeSupportHandoff,
  decideSupportTermination,
  expireSupportSessionIfNeeded,
  requestSupportTermination,
  revokeSupportSessionsForSubject,
  resolveSupportSessionByToken,
  revokeSupportSession,
} from '../db/admin/support'
import { asyncFromSync } from '../db/admin/async-store'
import { createControllableClock } from '../db/clock'
import { bootAdminDb } from '../db/test-db'
import {
  activateSupportSessionAsync,
  consumeSupportHandoffAsync,
  decideSupportTerminationAsync,
  requestSupportTerminationAsync,
  resolveSupportSessionByTokenAsync,
  revokeSupportSessionAsync,
} from './d1-session'

/**
 * Decisão 5 do Paulo (17/11/2026, #895): ao terminar a sessão (encerrada, revogada, expirada ou aceite de término)
 * o hash do token deixa de ser guardado. A coluna é NOT NULL e única: fica o marcador `ended:<id>`.
 */
const T0 = 3_100_000_000_000
const actor = { actorClerkUserId: 'user_synth_superadmin', actorClerkSessionId: 'sess_a' }
/** A migração é uma só instrução; tiram-se os comentários para a correr no AdminDb. */
const migrationSql = () =>
  readFileSync('db/migrations/0029_support_token_hash_ended.sql', 'utf8')
    .split('\n')
    .filter((l) => !l.startsWith('--'))
    .join('\n')
    .replace(/;\s*$/, '')
const hashOf = (db: ReturnType<typeof bootAdminDb>['db'], id: string) =>
  db.get<{ token_hash: string; status: string }>(`SELECT token_hash, status FROM support_sessions WHERE id = ?`, id)!

function setup() {
  const boot = bootAdminDb()
  const clock = createControllableClock(T0)
  const req = createSupportAccessRequest(boot.db, clock, {
    tenantId: 'clinic-demo-a',
    actorClerkUserId: 'user_synth_superadmin',
    subjectClerkUserId: 'user_synth_attendant_a',
    reason: 'x',
    scope: 'read_diagnostics',
  })
  approveSupportRequest(boot.db, clock, { requestId: req.id, ownerClerkUserId: 'user_synth_owner_a' })
  return { boot, clock, requestId: req.id, raw: asyncFromSync(boot.db) }
}

async function startAsync() {
  const s = setup()
  const act = await activateSupportSessionAsync(s.raw, s.clock, { requestId: s.requestId, ...actor })
  const { sessionToken } = await consumeSupportHandoffAsync(s.raw, s.clock, { handoffCode: act.handoffCode, ...actor })
  return { ...s, sessionId: act.session.id, sessionToken }
}

describe('hash do token apagado ao terminar a sessão (#895), caminho D1', () => {
  it('enquanto ativa guarda o hash; revogada, passa a «ended:<id>» e o cookie antigo deixa de valer', async () => {
    const s = await startAsync()
    try {
      expect(hashOf(s.boot.db, s.sessionId).token_hash).toMatch(/^[0-9a-f]{64}$/)
      await revokeSupportSessionAsync(s.raw, s.clock, { sessionId: s.sessionId, actorClerkUserId: 'user_synth_owner_a', asOwner: true })
      const row = hashOf(s.boot.db, s.sessionId)
      expect(row.status).toBe('revoked')
      expect(row.token_hash).toBe(`ended:${s.sessionId}`)
      await expect(
        resolveSupportSessionByTokenAsync(s.raw, s.clock, { sessionToken: s.sessionToken, ...actor }),
      ).rejects.toMatchObject({ code: 'support_cookie_invalid' })
    } finally {
      s.boot.close()
    }
  })

  it('expirada: o hash é apagado quando o prazo é detetado', async () => {
    const s = await startAsync()
    try {
      s.clock.advance(31 * 60_000)
      await expect(
        resolveSupportSessionByTokenAsync(s.raw, s.clock, { sessionToken: s.sessionToken, ...actor }),
      ).rejects.toMatchObject({ code: 'support_session_not_active' })
      const row = hashOf(s.boot.db, s.sessionId)
      expect(row.status).toBe('expired')
      expect(row.token_hash).toBe(`ended:${s.sessionId}`)
      await expect(
        resolveSupportSessionByTokenAsync(s.raw, s.clock, { sessionToken: s.sessionToken, ...actor }),
      ).rejects.toMatchObject({ code: 'support_cookie_invalid' })
    } finally {
      s.boot.close()
    }
  })

  it('pedido de término aceite pela owner também apaga o hash', async () => {
    const s = await startAsync()
    try {
      const t = await requestSupportTerminationAsync(s.raw, s.clock, {
        sessionId: s.sessionId,
        subjectClerkUserId: 'user_synth_attendant_a',
      })
      await decideSupportTerminationAsync(s.raw, s.clock, {
        terminationRequestId: t.id,
        ownerClerkUserId: 'user_synth_owner_a',
        decision: 'end',
      })
      expect(hashOf(s.boot.db, s.sessionId).token_hash).toBe(`ended:${s.sessionId}`)
    } finally {
      s.boot.close()
    }
  })

  it('uma sessão ativa nunca perde o hash', async () => {
    const s = await startAsync()
    try {
      await resolveSupportSessionByTokenAsync(s.raw, s.clock, { sessionToken: s.sessionToken, ...actor })
      expect(hashOf(s.boot.db, s.sessionId).token_hash).toMatch(/^[0-9a-f]{64}$/)
    } finally {
      s.boot.close()
    }
  })
})

describe('hash do token apagado ao terminar a sessão (#895), caminho síncrono', () => {
  async function startSync() {
    const s = setup()
    const act = await activateSupportSession(s.boot.db, s.clock, { requestId: s.requestId, ...actor })
    const { sessionToken } = await consumeSupportHandoff(s.boot.db, s.clock, { handoffCode: act.handoffCode, ...actor })
    return { ...s, sessionId: act.session.id, sessionToken }
  }

  it('revogada e expirada passam a «ended:<id>»', async () => {
    const a = await startSync()
    try {
      revokeSupportSession(a.boot.db, a.clock, { sessionId: a.sessionId, actorClerkUserId: 'user_synth_owner_a', asOwner: true })
      expect(hashOf(a.boot.db, a.sessionId).token_hash).toBe(`ended:${a.sessionId}`)
      await expect(
        resolveSupportSessionByToken(a.boot.db, a.clock, { sessionToken: a.sessionToken, ...actor }),
      ).rejects.toMatchObject({ code: 'support_cookie_invalid' })
    } finally {
      a.boot.close()
    }
    const b = await startSync()
    try {
      b.clock.advance(31 * 60_000)
      expireSupportSessionIfNeeded(b.boot.db, b.clock, b.sessionId)
      expect(hashOf(b.boot.db, b.sessionId).token_hash).toBe(`ended:${b.sessionId}`)
    } finally {
      b.boot.close()
    }
  })
})

describe('hash do token apagado, restantes saídas do caminho síncrono (#895)', () => {
  it('término aceite e revogação por subject apagam o hash', async () => {
    // término aceite pela owner
    const b = setup()
    try {
      const act = await activateSupportSession(b.boot.db, b.clock, { requestId: b.requestId, ...actor })
      await consumeSupportHandoff(b.boot.db, b.clock, { handoffCode: act.handoffCode, ...actor })
      const t = requestSupportTermination(b.boot.db, b.clock, { sessionId: act.session.id, subjectClerkUserId: 'user_synth_attendant_a' })
      decideSupportTermination(b.boot.db, b.clock, { terminationRequestId: t.id, ownerClerkUserId: 'user_synth_owner_a', decision: 'end' })
      expect(hashOf(b.boot.db, act.session.id).token_hash).toBe(`ended:${act.session.id}`)
    } finally {
      b.boot.close()
    }
    // subject perde o acesso
    const c = setup()
    try {
      const act = await activateSupportSession(c.boot.db, c.clock, { requestId: c.requestId, ...actor })
      await consumeSupportHandoff(c.boot.db, c.clock, { handoffCode: act.handoffCode, ...actor })
      revokeSupportSessionsForSubject(c.boot.db, c.clock, {
        tenantId: 'clinic-demo-a',
        subjectClerkUserId: 'user_synth_attendant_a',
        actorClerkUserId: 'user_synth_owner_a',
      })
      expect(hashOf(c.boot.db, act.session.id).token_hash).toBe(`ended:${act.session.id}`)
    } finally {
      c.boot.close()
    }
  })
})

describe('migração 0029', () => {
  it('limpa o hash das sessões já terminadas e deixa as ativas', async () => {
    const s = await startAsync()
    try {
      const real = hashOf(s.boot.db, s.sessionId).token_hash
      // Simula o estado anterior: terminada com o hash ainda guardado.
      s.boot.db.run(`UPDATE support_sessions SET status = 'revoked', token_hash = ? WHERE id = ?`, real, s.sessionId)
      s.boot.db.run(migrationSql())
      expect(hashOf(s.boot.db, s.sessionId).token_hash).toBe(`ended:${s.sessionId}`)

      s.boot.db.run(`UPDATE support_sessions SET status = 'active', token_hash = ? WHERE id = ?`, real, s.sessionId)
      s.boot.db.run(migrationSql())
      expect(hashOf(s.boot.db, s.sessionId).token_hash).toBe(real)
    } finally {
      s.boot.close()
    }
  })
})
