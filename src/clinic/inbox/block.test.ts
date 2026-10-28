import { describe, expect, it } from 'vitest'
import { ingestContactMessage, workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import {
  blockContactOp,
  getContactDetailOp,
  getConversationDetailOp,
  listConversationsOp,
  sendOutboundMessageOp,
  unblockContactOp,
} from './operations'

const ACTOR = { actorClerkUserId: 'user_synth_attendant_a', actorDisplayName: 'Ana' }

describe('Clinic inbox — bloquear contato (Proposto)', () => {
  it('bloqueia: encerra a conversa, suprime mensagens novas e recusa o envio; desbloquear reabre o fluxo', () => {
    const { db, clock, close } = bootClinicDb()
    try {
      const caller = workerCaller('clinic-demo-a', ACTOR.actorClerkUserId)
      const first = ingestContactMessage(
        db,
        caller,
        { providerEventKey: 'wa:blk:1', waId: '5511987002001', displayName: 'Contato Fictício', body: 'oi' },
        clock,
      )
      const contactId = first.contact!.id
      const conversationId = first.conversation!.id

      const blocked = blockContactOp(db, caller, { contactId, ...ACTOR, reason: 'Spam ou propaganda' }, clock)
      expect(blocked.value.contact.blockedAt).not.toBeNull()
      expect(blocked.value.contact.blockedByDisplayName).toBe('Ana')
      expect(blocked.value.closedConversationIds).toEqual([conversationId])
      expect(blocked.outbox.map((o) => o.type)).toEqual(['conversation.closed'])

      const detail = getConversationDetailOp(db, caller, { conversationId }, clock)
      expect(detail.status).toBe('closed')
      expect(detail.contact.blockedAt).not.toBeNull()
      expect(detail.messages.some((m) => m.body.includes('bloqueou este contato'))).toBe(true)

      // Mensagem nova: evento deduplicado, mas nada entra no painel.
      const after = ingestContactMessage(
        db,
        caller,
        { providerEventKey: 'wa:blk:2', waId: '5511987002001', body: 'ainda aqui' },
        clock,
      )
      expect(after.duplicate).toBe(false)
      expect(after.message).toBeNull()
      expect(after.conversation).toBeNull()
      const list = listConversationsOp(db, caller, { filter: 'all' }, clock)
      expect(list.items[0]!.status).toBe('closed')
      expect(getConversationDetailOp(db, caller, { conversationId }, clock).messages.some((m) => m.body === 'ainda aqui')).toBe(false)

      expect(() =>
        sendOutboundMessageOp(db, caller, { conversationId, clientRequestId: 'req-blk-1', body: 'olá', authorClerkUserId: ACTOR.actorClerkUserId, authorDisplayName: 'Ana' }, clock),
      ).toThrow(/bloqueado/)

      const unblocked = unblockContactOp(db, caller, { contactId, ...ACTOR }, clock)
      expect(unblocked.value.contact.blockedAt).toBeNull()
      const back = ingestContactMessage(
        db,
        caller,
        { providerEventKey: 'wa:blk:3', waId: '5511987002001', body: 'voltei' },
        clock,
      )
      expect(back.message).toBeTruthy()
      expect(back.conversation!.status).not.toBe('closed')
    } finally {
      close()
    }
  })

  it('é idempotente e isolado por clínica', () => {
    const a = bootClinicDb()
    const b = bootClinicDb()
    try {
      const callerA = workerCaller('clinic-demo-a', ACTOR.actorClerkUserId)
      const callerB = workerCaller('clinic-demo-b', 'user_synth_owner_b')
      const waId = '5511987002002'
      const ra = ingestContactMessage(a.db, callerA, { providerEventKey: 'wa:i:1', waId, body: 'a' }, a.clock)
      const rb = ingestContactMessage(b.db, callerB, { providerEventKey: 'wa:i:2', waId, body: 'b' }, b.clock)
      const once = blockContactOp(a.db, callerA, { contactId: ra.contact!.id, ...ACTOR }, a.clock)
      const twice = blockContactOp(a.db, callerA, { contactId: ra.contact!.id, ...ACTOR }, a.clock)
      expect(twice.value.contact.blockedAt).toBe(once.value.contact.blockedAt)
      expect(twice.outbox).toHaveLength(0)
      expect(() => blockContactOp(a.db, callerA, { contactId: rb.contact!.id, ...ACTOR }, a.clock)).toThrow()
      const other = ingestContactMessage(b.db, callerB, { providerEventKey: 'wa:i:3', waId, body: 'c' }, b.clock)
      expect(other.message).toBeTruthy()
    } finally {
      a.close()
      b.close()
    }
  })
})

describe('Clinic inbox — bloquear contato com Pix pendente (Decidido)', () => {
  function insertCharge(
    db: ReturnType<typeof bootClinicDb>['db'],
    contactId: string,
    status: string,
    expiresAt: number | null,
    nowMs: number,
  ) {
    db.run(
      `INSERT INTO pix_charges (id, tenant_id, account_id, provider, external_reference, amount_cents,
         status, expires_at, contact_id, created_at, updated_at)
       VALUES (?, 'clinic-demo-a', 'acc_ficticia', 'fake', ?, 5000, ?, ?, ?, ?, ?)`,
      `chg_${status}_${expiresAt ?? 'none'}`,
      `ext_${status}_${expiresAt ?? 'none'}`,
      status,
      expiresAt,
      contactId,
      nowMs,
      nowMs,
    )
  }

  it('sinaliza Pix pendente no detalhe e o bloqueio não altera a cobrança', () => {
    const { db, clock, close } = bootClinicDb()
    try {
      const caller = workerCaller('clinic-demo-a', ACTOR.actorClerkUserId)
      const first = ingestContactMessage(
        db,
        caller,
        { providerEventKey: 'wa:blkpix:1', waId: '5511987002011', displayName: 'Contato Fictício', body: 'oi' },
        clock,
      )
      const contactId = first.contact!.id
      const conversationId = first.conversation!.id
      const now = clock.nowMs()

      expect(getConversationDetailOp(db, caller, { conversationId }, clock).contactHasPendingPix).toBe(false)
      expect(getContactDetailOp(db, caller, contactId, clock).hasPendingPix).toBe(false)

      // Pago ou expirado não conta.
      insertCharge(db, contactId, 'paid', null, now)
      insertCharge(db, contactId, 'awaiting_payment', now - 1, now)
      expect(getContactDetailOp(db, caller, contactId, clock).hasPendingPix).toBe(false)

      insertCharge(db, contactId, 'awaiting_payment', now + 3_600_000, now)
      expect(getConversationDetailOp(db, caller, { conversationId }, clock).contactHasPendingPix).toBe(true)
      expect(getContactDetailOp(db, caller, contactId, clock).hasPendingPix).toBe(true)

      const before = db.all(`SELECT * FROM pix_charges WHERE contact_id = ? ORDER BY id`, contactId)
      blockContactOp(db, caller, { contactId, ...ACTOR, reason: null }, clock)
      const after = db.all(`SELECT * FROM pix_charges WHERE contact_id = ? ORDER BY id`, contactId)
      expect(after).toEqual(before)
      expect(getContactDetailOp(db, caller, contactId, clock).hasPendingPix).toBe(true)
    } finally {
      close()
    }
  })
})
