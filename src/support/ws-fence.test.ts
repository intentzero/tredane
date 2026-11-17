/**
 * Ligações WebSocket de sessão de suporte (#853 PR 4, ADR-0017 §4): só sinais sem payload, presas à sessão,
 * e o fence por sessão não corta o subject real ligado ao mesmo tempo.
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../db/clock'
import { bootClinicDb } from '../clinic/test-db'
import {
  appendRealtimeEvent,
  closeSupportSessionSockets,
  createMapAccessAuthority,
  deliverEventToSockets,
  ensureRealtimeFence,
  activeViewerUserIds,
  type DeliverySocket,
  type SocketAttachment,
} from '../realtime'
import type { AccessAuthority, SupportSessionDecision } from '../realtime/authority'

const T = 'clinic-demo-a'
const SUBJECT = 'user_synth_attendant_a'

function sock(att: SocketAttachment) {
  const sent: string[] = []
  const closed: Array<{ code?: number; reason?: string }> = []
  const s: DeliverySocket & { sent: string[]; closed: typeof closed } = {
    sent,
    closed,
    send: (d) => void sent.push(d),
    close: (code, reason) => void closed.push({ code, reason }),
    deserializeAttachment: () => att,
  }
  return s
}
const base = { tenantId: T, authEpoch: 0, connectedAt: 1, sessionId: 'sess' }
const supportAtt = (id = 'ssn_1'): SocketAttachment => ({ ...base, connectionId: `ws_${id}`, clerkUserId: SUBJECT, role: 'attendant', supportSessionId: id })
const subjectAtt: SocketAttachment = { ...base, connectionId: 'ws_real', clerkUserId: SUBJECT, role: 'attendant' }

function authorityWith(session: () => SupportSessionDecision): AccessAuthority {
  const inner = createMapAccessAuthority(new Map([[`${T}:${SUBJECT}`, 'attendant']]))
  return { checkMembership: inner.checkMembership, checkSupportSession: async () => session() }
}

function setup() {
  const clinic = bootClinicDb()
  const clock = createControllableClock(3_100_000_000_000)
  ensureRealtimeFence(clinic.db, clock)
  const emit = (type: string, payload: Record<string, unknown>, audience?: 'owners' | 'subject' | 'owners_and_subject') =>
    appendRealtimeEvent(clinic.db, { tenantId: T, type, entityType: 'conversation', entityId: 'conv_1', payload, audience, eventId: `e_${type}_${Math.random()}` }, clock)
  return { clinic, clock, emit }
}

describe('WebSocket de suporte — entrega', () => {
  it('o suporte recebe só o sinal (sem payload) de message.* e conversation.*; o subject recebe tudo', async () => {
    const { clinic, clock, emit } = setup()
    try {
      const support = sock(supportAtt())
      const real = sock(subjectAtt)
      const evt = emit('message.created', { body: 'texto íntimo', waId: '5511999990000' })
      await deliverEventToSockets(clinic.db, [support, real], evt, authorityWith(() => ({ status: 'allow' })), clock)
      const got = JSON.parse(support.sent[0]!)
      expect(got).toMatchObject({ type: 'event', eventType: 'message.created', entity: { id: 'conv_1' }, payload: {} })
      expect(support.sent[0]).not.toMatch(/texto íntimo|5511999990000/)
      expect(JSON.parse(real.sent[0]!).payload.body).toBe('texto íntimo')
    } finally {
      clinic.close()
    }
  })

  it('o suporte não recebe outros tipos, rascunhos da IA nem eventos de audiência restrita', async () => {
    const { clinic, clock, emit } = setup()
    try {
      const support = sock(supportAtt())
      const auth = authorityWith(() => ({ status: 'allow' }))
      for (const [type, aud] of [
        ['config.service_created', undefined],
        ['conversation.ai_draft', undefined],
        ['membership.revoked', undefined],
        ['conversation.assigned', 'owners'],
        ['message.created', 'subject'],
      ] as const) {
        await deliverEventToSockets(clinic.db, [support], emit(type, { subjectClerkUserId: SUBJECT }, aud), auth, clock)
      }
      expect(support.sent).toEqual([])
    } finally {
      clinic.close()
    }
  })

  it('sessão terminada ou expirada: fecha a ligação sem entregar nada', async () => {
    for (const reason of ['support_revoked', 'session_expired'] as const) {
      const { clinic, clock, emit } = setup()
      try {
        const support = sock(supportAtt())
        const res = await deliverEventToSockets(clinic.db, [support], emit('message.created', {}), authorityWith(() => ({ status: 'deny', reason })), clock)
        expect(res.revoked).toEqual(['ws_ssn_1'])
        expect(support.sent.map((m) => JSON.parse(m).type)).toEqual(['access_revoked'])
        expect(JSON.parse(support.sent[0]!).reason).toBe(reason)
        expect(support.closed).toHaveLength(1)
      } finally {
        clinic.close()
      }
    }
  })

  it('não consegue verificar a sessão (ou a autoridade não o sabe fazer): não entrega, fail-closed', async () => {
    const { clinic, clock, emit } = setup()
    try {
      const a = sock(supportAtt())
      const b = sock(supportAtt('ssn_2'))
      const noMethod = createMapAccessAuthority(new Map([[`${T}:${SUBJECT}`, 'attendant']]))
      const r1 = await deliverEventToSockets(clinic.db, [a], emit('message.created', {}), authorityWith(() => ({ status: 'unavailable' })), clock)
      const r2 = await deliverEventToSockets(clinic.db, [b], emit('message.created', {}), noMethod, clock)
      expect(a.sent).toEqual([])
      expect(b.sent).toEqual([])
      expect(r1.skippedUnavailable).toHaveLength(1)
      expect(r2.skippedUnavailable).toHaveLength(1)
    } finally {
      clinic.close()
    }
  })

  it('perder o membership do subject também corta a ligação de suporte', async () => {
    const { clinic, clock, emit } = setup()
    try {
      const support = sock(supportAtt())
      const noMember = createMapAccessAuthority(new Map())
      const auth: AccessAuthority = { checkMembership: noMember.checkMembership, checkSupportSession: async () => ({ status: 'allow' }) }
      const res = await deliverEventToSockets(clinic.db, [support], emit('message.created', {}), auth, clock)
      expect(res.revoked).toHaveLength(1)
      expect(support.sent.map((m) => JSON.parse(m).type)).toEqual(['access_revoked'])
    } finally {
      clinic.close()
    }
  })
})

describe('WebSocket de suporte — fence por sessão', () => {
  it('fecha só as ligações da sessão pedida; o subject real e outras sessões ficam', () => {
    const mine = sock(supportAtt('ssn_1'))
    const mineToo = sock({ ...supportAtt('ssn_1'), connectionId: 'ws_ssn_1b' })
    const other = sock(supportAtt('ssn_2'))
    const real = sock(subjectAtt)
    const otherTenant = sock({ ...supportAtt('ssn_1'), tenantId: 'clinic-demo-b', connectionId: 'ws_b' })
    const closed = closeSupportSessionSockets([mine, mineToo, other, real, otherTenant], T, 'ssn_1', 'support_revoked')
    expect(closed.sort()).toEqual(['ws_ssn_1', 'ws_ssn_1b'])
    expect(real.closed).toHaveLength(0)
    expect(other.closed).toHaveLength(0)
    expect(otherTenant.closed).toHaveLength(0)
    expect(mine.closed).toHaveLength(1)
  })

  it('a ligação de suporte nunca conta como presença do subject', () => {
    const now = 1_000_000
    const withPresence = (a: SocketAttachment): SocketAttachment => ({ ...a, visible: true, presenceAt: now })
    expect(activeViewerUserIds([withPresence(supportAtt())], now)).toEqual([])
    expect(activeViewerUserIds([withPresence(subjectAtt), withPresence(supportAtt())], now)).toEqual([SUBJECT])
  })
})
