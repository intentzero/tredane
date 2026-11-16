import type { Clock } from '../db/clock'
import type { ClinicDb } from '../clinic/store'
import { upsertContact } from '../clinic/contacts'
import { createConversation } from '../clinic/inbox/conversations'

export type FkFixtureIds = {
  contactId: string
  convId: string
  msgId: string
  outId: string
  attId: string
  propId: string
  oppId: string
  holdId: string
  apptId: string
  siId: string
  pcId: string
}

/** Semeia linhas em todas as tabelas-filhas com FK relevantes ao lab_reset. */
export function seedLabResetFkGraph(
  db: ClinicDb,
  clock: Clock,
  tenantId: string,
  contactId: string,
  waId: string,
  convId: string,
  nowMs: number,
): FkFixtureIds {
  upsertContact(db, { tenantId, waId, displayName: 'Synth', id: contactId }, clock)
  createConversation(db, { tenantId, contactId, status: 'open', id: convId }, clock)

  const msgId = `msg_${contactId}`
  const outId = `out_${contactId}`
  const attId = `att_${contactId}`
  const propId = `prop_${contactId}`
  const oppId = `opp_${contactId}`
  const holdId = `hold_${contactId}`
  const apptId = `apt_${contactId}`
  const siId = `si_${contactId}`
  const pcId = `pc_${contactId}`

  db.run(
    `INSERT INTO messages (id, tenant_id, conversation_id, direction, body, delivery_state, created_at)
     VALUES (?, ?, ?, 'inbound', 'oi', 'received', ?)`,
    msgId,
    tenantId,
    convId,
    nowMs,
  )
  db.run(
    `INSERT INTO outbound_messages (id, tenant_id, conversation_id, message_id, client_request_id,
      kind, delivery_state, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'text', 'pending', ?, ?)`,
    outId,
    tenantId,
    convId,
    msgId,
    `cr_${contactId}`,
    nowMs,
    nowMs,
  )
  db.run(
    `INSERT INTO attachments (
      id, tenant_id, conversation_id, message_id, r2_key, content_type,
      source, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'image/jpeg', 'synthetic', 'ready', ?, ?)`,
    attId,
    tenantId,
    convId,
    msgId,
    `r2/${contactId}`,
    nowMs,
    nowMs,
  )
  db.run(
    `INSERT INTO ai_suggestions (
      id, tenant_id, conversation_id, kind, status, provider, model,
      requested_by_clerk_user_id, created_at, updated_at)
     VALUES (?, ?, ?, 'reply', 'pending', 'p', 'm', 'lab', ?, ?)`,
    `ais_${contactId}`,
    tenantId,
    convId,
    nowMs,
    nowMs,
  )
  db.run(
    `INSERT INTO ai_commands (tenant_id, client_request_id, command, conversation_id, result_json, created_at)
     VALUES (?, ?, 'suggest_reply', ?, '{}', ?)`,
    tenantId,
    `aic_${contactId}`,
    convId,
    nowMs,
  )
  db.run(
    `INSERT INTO ai_autodraft_jobs (tenant_id, conversation_id, message_id, due_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    tenantId,
    convId,
    msgId,
    nowMs + 60_000,
    nowMs,
    nowMs,
  )
  db.run(
    `INSERT INTO llm_jobs (
      tenant_id, id, conversation_id, message_id, purpose, state,
      idempotency_key, snapshot_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'extract', 'done', ?, '{}', ?, ?)`,
    tenantId,
    `llm_${contactId}`,
    convId,
    msgId,
    `idem_${contactId}`,
    nowMs,
    nowMs,
  )
  db.run(
    `INSERT INTO appointment_proposals (
      id, tenant_id, lineage_id, version, contact_id, conversation_id, state,
      clinic_location_text, beneficiary_kind, beneficiary_name, service_id, service_name,
      starts_at, ends_at, duration_minutes, timezone, requires_signal, signal_conditions_text,
      created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?, 'enviada', '', 'titular', 'Synth', 'svc1', 'X',
      ?, ?, 60, 'America/Sao_Paulo', 0, '', ?, ?)`,
    propId,
    tenantId,
    propId,
    contactId,
    convId,
    nowMs + 4 * 3_600_000,
    nowMs + 5 * 3_600_000,
    nowMs,
    nowMs,
  )
  db.run(
    `INSERT INTO visit_zone_snapshots (
      id, tenant_id, owner_kind, owner_id, zone_id, name, duration_minutes, sort_order)
     VALUES (?, ?, 'proposal', ?, 'z1', 'Z', 30, 0)`,
    `vzs_${contactId}`,
    tenantId,
    propId,
  )
  db.run(
    `INSERT INTO opportunities (id, tenant_id, contact_id, conversation_id, stage, status,
      cycle_number, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'em_atendimento', 'open', 1, ?, ?)`,
    oppId,
    tenantId,
    contactId,
    convId,
    nowMs,
    nowMs,
  )
  db.run(
    `INSERT INTO opportunity_stage_history (id, tenant_id, opportunity_id, to_stage, created_at)
     VALUES (?, ?, ?, 'em_atendimento', ?)`,
    `osh_${contactId}`,
    tenantId,
    oppId,
    nowMs,
  )
  db.run(
    `INSERT INTO schedule_holds (id, tenant_id, opportunity_id, conversation_id, contact_id,
      service_id, professional_id, duration_minutes, window_starts_at, window_ends_at,
      status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'svc1', 'pro1', 60, ?, ?, 'active', 'lab', ?, ?)`,
    holdId,
    tenantId,
    oppId,
    convId,
    contactId,
    nowMs,
    nowMs + 3_600_000,
    nowMs,
    nowMs,
  )
  db.run(
    `INSERT INTO scheduling_intents (
      id, tenant_id, conversation_id, contact_id, service_id, professional_id,
      starts_at, ends_at, occupies_until, timezone, status, created_by_clerk_user_id,
      created_at, updated_at, opportunity_id)
     VALUES (?, ?, ?, ?, 'svc1', 'pro1', ?, ?, ?, 'America/Sao_Paulo', 'awaiting_signal', 'lab', ?, ?, ?)`,
    siId,
    tenantId,
    convId,
    contactId,
    nowMs + 2 * 3_600_000,
    nowMs + 3 * 3_600_000,
    nowMs + 3 * 3_600_000,
    nowMs,
    nowMs,
    oppId,
  )
  db.run(
    `INSERT INTO appointments (
      id, tenant_id, service_id, professional_id, starts_at, ends_at, status,
      created_at, contact_id, confirmed_by)
     VALUES (?, ?, 'svc1', 'pro1', ?, ?, 'confirmed', ?, ?, 'lab:test')`,
    apptId,
    tenantId,
    nowMs + 2 * 3_600_000,
    nowMs + 3 * 3_600_000,
    nowMs,
    contactId,
  )
  db.run(
    `INSERT INTO appointment_allocations (
      id, tenant_id, appointment_id, resource_kind, resource_id, occupied_from, occupied_until)
     VALUES (?, ?, ?, 'professional', 'pro1', ?, ?)`,
    `alc_${contactId}`,
    tenantId,
    apptId,
    nowMs,
    nowMs + 3_600_000,
  )
  db.run(
    `INSERT INTO appointment_events (
      id, tenant_id, appointment_id, operation, occurred_at)
     VALUES (?, ?, ?, 'confirmed', ?)`,
    `aev_${contactId}`,
    tenantId,
    apptId,
    nowMs,
  )
  db.run(
    `INSERT INTO visit_zone_snapshots (
      id, tenant_id, owner_kind, owner_id, zone_id, name, duration_minutes, sort_order)
     VALUES (?, ?, 'appointment', ?, 'z1', 'Z', 30, 0)`,
    `vza_${contactId}`,
    tenantId,
    apptId,
  )
  db.run(
    `INSERT INTO pending_communications (
      id, tenant_id, conversation_id, contact_id, kind, status, started_at,
      alert_after_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'proposal_send', 'open', ?, ?, ?, ?)`,
    pcId,
    tenantId,
    convId,
    contactId,
    nowMs,
    nowMs + 300_000,
    nowMs,
    nowMs,
  )
  db.run(
    `INSERT INTO schedule_sessions (tenant_id, conversation_id, service_id, updated_at)
     VALUES (?, ?, 'svc1', ?)`,
    tenantId,
    convId,
    nowMs,
  )
  db.run(
    `INSERT INTO booking_sessions (session_id, tenant_id, conversation_id, opened_at, open_reason)
     VALUES (?, ?, ?, ?, 'test')`,
    `bs_${contactId}`,
    tenantId,
    convId,
    nowMs,
  )

  return { contactId, convId, msgId, outId, attId, propId, oppId, holdId, apptId, siId, pcId }
}

export function snapshotFkRows(db: ClinicDb, tenantId: string, ids: FkFixtureIds) {
  return {
    contact: db.get(`SELECT * FROM contacts WHERE tenant_id = ? AND id = ?`, tenantId, ids.contactId),
    conv: db.get(`SELECT * FROM conversations WHERE tenant_id = ? AND id = ?`, tenantId, ids.convId),
    msg: db.get(`SELECT * FROM messages WHERE tenant_id = ? AND id = ?`, tenantId, ids.msgId),
    out: db.get(`SELECT * FROM outbound_messages WHERE tenant_id = ? AND id = ?`, tenantId, ids.outId),
    att: db.get(`SELECT * FROM attachments WHERE tenant_id = ? AND id = ?`, tenantId, ids.attId),
    prop: db.get(`SELECT * FROM appointment_proposals WHERE tenant_id = ? AND id = ?`, tenantId, ids.propId),
    opp: db.get(`SELECT * FROM opportunities WHERE tenant_id = ? AND id = ?`, tenantId, ids.oppId),
    hold: db.get(`SELECT * FROM schedule_holds WHERE tenant_id = ? AND id = ?`, tenantId, ids.holdId),
    appt: db.get(`SELECT * FROM appointments WHERE tenant_id = ? AND id = ?`, tenantId, ids.apptId),
    si: db.get(`SELECT * FROM scheduling_intents WHERE tenant_id = ? AND id = ?`, tenantId, ids.siId),
    pc: db.get(`SELECT * FROM pending_communications WHERE tenant_id = ? AND id = ?`, tenantId, ids.pcId),
    vzs: db.get(`SELECT * FROM visit_zone_snapshots WHERE tenant_id = ? AND owner_id = ?`, tenantId, ids.propId),
    vza: db.get(`SELECT * FROM visit_zone_snapshots WHERE tenant_id = ? AND owner_id = ?`, tenantId, ids.apptId),
    ss: db.get(`SELECT * FROM schedule_sessions WHERE tenant_id = ? AND conversation_id = ?`, tenantId, ids.convId),
    bs: db.get(`SELECT * FROM booking_sessions WHERE tenant_id = ? AND conversation_id = ?`, tenantId, ids.convId),
  }
}