/**
 * Exclusão de contacto + wipe local (#43 / REQ-071).
 */
import { describe, expect, it } from 'vitest'
import { systemClock } from '../../db/clock'
import { bootClinicDb } from '../test-db'
import { workerCaller } from '../envelopes'
import { ingestContactMessage } from '../operations'
import { ContactTombstonedError, getContact, listContacts, upsertContact } from '../contacts'
import { deleteContactOp } from './contact-delete'
import { findContactTombstoneByWaId } from './tombstones'
import { ANONYMIZED_CONTACT_LABEL } from './types'
import {
  getClinicPurgeState,
  wipeClinicOperationalData,
} from './tenant-purge-local'
import { listOperationalAudit } from '../audit'
import { newId } from '../ids'

describe('retenção — exclusão de contacto', () => {
  it('owner cascade: mensagens sumidas, compromisso anonimizado, tombstone bloqueia replay', () => {
    const { db, close } = bootClinicDb()
    try {
      const clock = systemClock
      const tenantId = 'clinic-demo-retention-a'
      const caller = workerCaller(tenantId, 'user_synth_owner_a')

      const ingested = ingestContactMessage(
        db,
        caller,
        {
          providerEventKey: 'wa:evt:ret-1',
          waId: '5511999990001',
          displayName: 'Ana Fictícia',
          body: 'Quero agendar limpeza de pele',
        },
        clock,
      )
      expect(ingested.contact).toBeTruthy()
      const contactId = ingested.contact!.id

      const apptId = newId('apt')
      const now = clock.nowMs()
      db.run(
        `INSERT INTO appointments (
          id, tenant_id, service_id, professional_id, room_resource_id,
          starts_at, ends_at, status, contact_label, created_at, contact_id
        ) VALUES (?, ?, 'svc-x', 'pro-x', NULL, ?, ?, 'confirmed', ?, ?, ?)`,
        apptId,
        tenantId,
        now + 3600_000,
        now + 5400_000,
        'Ana Fictícia',
        now,
        contactId,
      )

      const deleted = deleteContactOp(db, caller, contactId, clock)
      expect(deleted.value.deletedMessageCount).toBeGreaterThanOrEqual(1)
      expect(deleted.value.anonymizedAppointmentCount).toBe(1)
      expect(getContact(db, tenantId, contactId)).toBeUndefined()
      expect(listContacts(db, tenantId)).toHaveLength(0)

      const appt = db.get<{ contact_id: string | null; contact_label: string | null }>(
        `SELECT contact_id, contact_label FROM appointments WHERE tenant_id = ? AND id = ?`,
        tenantId,
        apptId,
      )
      expect(appt?.contact_id).toBeNull()
      expect(appt?.contact_label).toBe(ANONYMIZED_CONTACT_LABEL)

      const tombstone = findContactTombstoneByWaId(db, tenantId, '5511999990001')
      expect(tombstone?.contactId).toBe(contactId)

      const replay = ingestContactMessage(
        db,
        caller,
        {
          providerEventKey: 'wa:evt:ret-1',
          waId: '5511999990001',
          displayName: 'Ana Fictícia',
          body: 'replay não deve recriar',
        },
        clock,
      )
      expect(replay.suppressedTombstone).toBe(true)
      expect(replay.duplicate).toBe(true)
      expect(replay.contact).toBeNull()
      expect(replay.conversation).toBeNull()
      expect(replay.message).toBeNull()
      expect(listContacts(db, tenantId)).toHaveLength(0)
      expect(() =>
        upsertContact(
          db,
          { tenantId, waId: '5511999990001', displayName: 'Ana Fictícia' },
          clock,
        ),
      ).toThrow(ContactTombstonedError)

      const audit = listOperationalAudit(db, tenantId)
      const del = audit.find((a) => a.action === 'contact.deleted')
      expect(del).toBeTruthy()
      expect(del!.detailJson).not.toContain('Ana')
      expect(del!.detailJson).not.toContain('5511999990001')
      expect(del!.detailJson).not.toContain('limpeza')
    } finally {
      close()
    }
  })

  it('DEC-099: evento novo abre contacto limpo; replay do evento anterior não restaura histórico', () => {
    const { db, close } = bootClinicDb()
    try {
      const clock = systemClock
      const tenantId = 'clinic-demo-retention-reopen'
      const caller = workerCaller(tenantId, 'user_synth_owner_reopen')
      const waId = '5511999990002'
      const oldBody = 'Quero a limpeza de pele de março'
      const newBody = 'Olá, posso marcar de novo?'

      const ingested = ingestContactMessage(
        db,
        caller,
        {
          providerEventKey: 'wa:evt:old-1',
          waId,
          displayName: 'Ana Fictícia',
          body: oldBody,
        },
        clock,
      )
      const oldContactId = ingested.contact!.id
      const oldConversationId = ingested.conversation!.id
      const oldOpportunityId = db.get<{ id: string }>(
        `SELECT id FROM opportunities WHERE tenant_id = ? AND contact_id = ?`,
        tenantId,
        oldContactId,
      )!.id

      const apptId = newId('apt')
      const now = clock.nowMs()
      db.run(
        `INSERT INTO appointments (
          id, tenant_id, service_id, professional_id, room_resource_id,
          starts_at, ends_at, status, contact_label, created_at, contact_id, conversation_id, opportunity_id
        ) VALUES (?, ?, 'svc-x', 'pro-x', NULL, ?, ?, 'confirmed', ?, ?, ?, ?, ?)`,
        apptId,
        tenantId,
        now + 3600_000,
        now + 5400_000,
        'Ana Fictícia',
        now,
        oldContactId,
        oldConversationId,
        oldOpportunityId,
      )

      deleteContactOp(db, caller, oldContactId, clock)
      expect(
        db.get<{ n: number }>(
          `SELECT COUNT(*) AS n FROM inbound_events WHERE tenant_id = ? AND provider_event_key = ?`,
          tenantId,
          'wa:evt:old-1',
        )?.n,
      ).toBe(1)
      expect(
        db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM messages WHERE tenant_id = ?`, tenantId)?.n,
      ).toBe(0)

      const replay = ingestContactMessage(
        db,
        caller,
        {
          providerEventKey: 'wa:evt:old-1',
          waId,
          displayName: 'Ana Fictícia',
          body: oldBody,
        },
        clock,
      )
      expect(replay.suppressedTombstone).toBe(true)
      expect(replay.duplicate).toBe(true)
      expect(replay.conversation).toBeNull()
      expect(replay.message).toBeNull()
      expect(listContacts(db, tenantId)).toHaveLength(0)
      expect(findContactTombstoneByWaId(db, tenantId, waId)?.contactId).toBe(oldContactId)

      const fresh = ingestContactMessage(
        db,
        caller,
        {
          providerEventKey: 'wa:evt:new-1',
          waId,
          displayName: 'Ana Fictícia',
          body: newBody,
        },
        clock,
      )
      expect(fresh.suppressedTombstone).toBe(false)
      expect(fresh.duplicate).toBe(false)
      expect(fresh.contact).toBeTruthy()
      expect(fresh.contact!.id).not.toBe(oldContactId)
      expect(fresh.conversation).toBeTruthy()
      expect(fresh.conversation!.id).not.toBe(oldConversationId)
      expect(fresh.message?.body).toBe(newBody)
      expect(findContactTombstoneByWaId(db, tenantId, waId)).toBeUndefined()

      const bodies = db
        .all<{ body: string }>(`SELECT body FROM messages WHERE tenant_id = ?`, tenantId)
        .map((row) => row.body)
      expect(bodies).toEqual([newBody])
      expect(
        db.get<{ n: number }>(
          `SELECT COUNT(*) AS n FROM conversations WHERE tenant_id = ?`,
          tenantId,
        )?.n,
      ).toBe(1)
      expect(
        db.get<{ n: number }>(
          `SELECT COUNT(*) AS n FROM opportunities WHERE tenant_id = ? AND id = ?`,
          tenantId,
          oldOpportunityId,
        )?.n,
      ).toBe(0)
      const opps = db.all<{ contact_id: string }>(
        `SELECT contact_id FROM opportunities WHERE tenant_id = ?`,
        tenantId,
      )
      expect(opps).toHaveLength(1)
      expect(opps[0]?.contact_id).toBe(fresh.contact!.id)

      const appt = db.get<{
        contact_id: string | null
        contact_label: string | null
        conversation_id: string | null
        opportunity_id: string | null
      }>(
        `SELECT contact_id, contact_label, conversation_id, opportunity_id
         FROM appointments WHERE tenant_id = ? AND id = ?`,
        tenantId,
        apptId,
      )
      expect(appt?.contact_id).toBeNull()
      expect(appt?.conversation_id).toBeNull()
      expect(appt?.opportunity_id).toBeNull()
      expect(appt?.contact_label).toBe(ANONYMIZED_CONTACT_LABEL)
      expect(
        db.get<{ n: number }>(
          `SELECT COUNT(*) AS n FROM appointments WHERE tenant_id = ? AND contact_id = ?`,
          tenantId,
          fresh.contact!.id,
        )?.n,
      ).toBe(0)

      const later = ingestContactMessage(
        db,
        caller,
        {
          providerEventKey: 'wa:evt:new-2',
          waId,
          displayName: 'Ana Fictícia',
          body: 'E na quinta?',
        },
        clock,
      )
      expect(later.suppressedTombstone).toBe(false)
      expect(later.contact!.id).toBe(fresh.contact!.id)
      expect(later.conversation!.id).toBe(fresh.conversation!.id)
      expect(later.message?.body).toBe('E na quinta?')

      const replayAfter = ingestContactMessage(
        db,
        caller,
        {
          providerEventKey: 'wa:evt:old-1',
          waId,
          displayName: 'Ana Fictícia',
          body: oldBody,
        },
        clock,
      )
      expect(replayAfter.duplicate).toBe(true)
      expect(replayAfter.suppressedTombstone).toBe(false)
      expect(replayAfter.message).toBeNull()
      expect(replayAfter.conversation).toBeNull()
      const bodiesAfter = db
        .all<{ body: string }>(
          `SELECT body FROM messages WHERE tenant_id = ? ORDER BY created_at, id`,
          tenantId,
        )
        .map((row) => row.body)
      expect(bodiesAfter).toEqual([newBody, 'E na quinta?'])
      expect(bodiesAfter).not.toContain(oldBody)

      const audit = listOperationalAudit(db, tenantId)
      const suppressed = audit.find((row) => row.action === 'contact.ingest_suppressed_tombstone')
      const reopened = audit.find((row) => row.action === 'contact.reopened_after_delete')
      expect(suppressed).toBeTruthy()
      expect(reopened).toBeTruthy()
      for (const row of [suppressed!, reopened!]) {
        expect(row.detailJson ?? '').not.toContain(waId)
        expect(row.detailJson ?? '').not.toContain(oldBody)
        expect(row.detailJson ?? '').not.toContain(newBody)
        expect(row.detailJson ?? '').not.toContain('Ana')
      }
      expect(reopened!.detailJson).toContain(oldContactId)
      expect(reopened!.objectId).toBe(fresh.contact!.id)
    } finally {
      close()
    }
  })

  it('AC-52: cascade com schedule_sessions — mensagens/pipeline somem e agenda anonimiza', () => {
    const { db, close } = bootClinicDb()
    try {
      const clock = systemClock
      const tenantId = 'clinic-demo-retention-session'
      const caller = workerCaller(tenantId, 'user_synth_owner_session')

      const ingested = ingestContactMessage(
        db,
        caller,
        {
          providerEventKey: 'wa:evt:ret-session-1',
          waId: '5511999888777',
          displayName: 'Paulo',
          body: 'Quero marcar',
        },
        clock,
      )
      const contactId = ingested.contact!.id
      const conversationId = ingested.conversation!.id

      // Sessão de agendamento (DEC-078) — FK para conversations; regressão do bug de staging.
      db.run(
        `INSERT INTO schedule_sessions (
          tenant_id, conversation_id, service_id, audience_line, day_label, period, updated_at
        ) VALUES (?, ?, ?, NULL, NULL, NULL, ?)`,
        tenantId,
        conversationId,
        'svc-session',
        clock.nowMs(),
      )

      const apptId = newId('apt')
      const now = clock.nowMs()
      db.run(
        `INSERT INTO appointments (
          id, tenant_id, service_id, professional_id, room_resource_id,
          starts_at, ends_at, status, contact_label, created_at, contact_id, conversation_id
        ) VALUES (?, ?, ?, ?, NULL, ?, ?, 'confirmed', ?, ?, ?, ?)`,
        apptId,
        tenantId,
        'svc-x',
        'pro-x',
        now + 3600_000,
        now + 5400_000,
        'Paulo',
        now,
        contactId,
        conversationId,
      )

      const deleted = deleteContactOp(db, caller, contactId, clock)
      expect(deleted.value.deletedMessageCount).toBeGreaterThanOrEqual(1)
      expect(deleted.value.deletedConversationCount).toBe(1)
      expect(deleted.value.deletedOpportunityCount).toBeGreaterThanOrEqual(1)
      expect(deleted.value.anonymizedAppointmentCount).toBe(1)

      expect(getContact(db, tenantId, contactId)).toBeUndefined()
      expect(
        db.get<{ n: number }>(
          `SELECT COUNT(*) AS n FROM messages WHERE tenant_id = ?`,
          tenantId,
        )?.n,
      ).toBe(0)
      expect(
        db.get<{ n: number }>(
          `SELECT COUNT(*) AS n FROM conversations WHERE tenant_id = ?`,
          tenantId,
        )?.n,
      ).toBe(0)
      expect(
        db.get<{ n: number }>(
          `SELECT COUNT(*) AS n FROM opportunities WHERE tenant_id = ?`,
          tenantId,
        )?.n,
      ).toBe(0)
      expect(
        db.get<{ n: number }>(
          `SELECT COUNT(*) AS n FROM schedule_sessions WHERE tenant_id = ?`,
          tenantId,
        )?.n,
      ).toBe(0)

      const appt = db.get<{ contact_id: string | null; contact_label: string | null }>(
        `SELECT contact_id, contact_label FROM appointments WHERE tenant_id = ? AND id = ?`,
        tenantId,
        apptId,
      )
      expect(appt?.contact_id).toBeNull()
      expect(appt?.contact_label).toBe(ANONYMIZED_CONTACT_LABEL)
      expect(appt?.contact_label).not.toBe('Paulo')
    } finally {
      close()
    }
  })

  it('isolamento: exclusão em A não afecta B', () => {
    const a = bootClinicDb()
    const b = bootClinicDb()
    try {
      const clock = systemClock
      const callerA = workerCaller('clinic-demo-retention-iso-a', 'owner_a')

      const ca = upsertContact(
        a.db,
        { tenantId: 'clinic-demo-retention-iso-a', waId: '551100000001', displayName: 'A' },
        clock,
      )
      deleteContactOp(a.db, callerA, ca.id, clock)

      const cb = upsertContact(
        b.db,
        { tenantId: 'clinic-demo-retention-iso-b', waId: '551100000002', displayName: 'B' },
        clock,
      )
      expect(getContact(a.db, 'clinic-demo-retention-iso-a', ca.id)).toBeUndefined()
      expect(getContact(b.db, 'clinic-demo-retention-iso-b', cb.id)?.displayName).toBe('B')
    } finally {
      a.close()
      b.close()
    }
  })

  it('wipe local do DO é idempotente e marca wiped', () => {
    const { db, close } = bootClinicDb()
    try {
      const clock = systemClock
      const tenantId = 'clinic-demo-retention-wipe'
      const caller = workerCaller(tenantId, 'system')
      upsertContact(db, { tenantId, waId: '5511888777666', displayName: 'X' }, clock)
      // bind
      wipeClinicOperationalData(db, caller, clock)

      expect(listContacts(db, tenantId)).toHaveLength(0)
      expect(getClinicPurgeState(db).status).toBe('wiped')

      const second = wipeClinicOperationalData(db, caller, clock)
      expect(second.alreadyWiped).toBe(true)
    } finally {
      close()
    }
  })
})
