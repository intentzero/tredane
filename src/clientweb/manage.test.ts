import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../db/clock'
import { ingestContactMessage, workerCaller } from '../clinic'
import { bootClinicDb } from '../clinic/test-db'
import { replaceServiceZonesOp, setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../clinic/config'
import { upsertContact } from '../clinic/contacts'
import { syncWhatsappChannel } from '../clinic/whatsapp/channel'
import { seedSyntheticWhatsappTemplates } from '../clinic/inbox/templates'
import { executeProposalConfirmOp } from '../clinic/proposals/execute-confirm'
import { WEB_RECEIPT_SENTENCE } from '../clinic/proposals/render'
import { planWebProposal } from './booking'
import { POST_BOOKING_BODY } from '../clinic/followup/post-booking'
import {
  appendWebCancelChatEffects,
  cancelFromWeb,
  cancelReceiptBody,
  hasPaidSignal,
  listRescheduleSlots,
  loadWebAppointment,
  planWebReschedule,
  rescheduleAlreadyAt,
  WEB_CANCEL_RECEIPT_SENTENCE,
} from './manage'

const TENANT = 'clinic-demo-a'

/** Domingo 07/01/2024; segunda 08/01 tem expediente 09–18. */
function seed() {
  const clock = createControllableClock(Date.UTC(2024, 0, 7, 15))
  const { db, close } = bootClinicDb({ clock })
  const caller = workerCaller(TENANT, 'user_synth_owner_a')
  const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala 1' }, clock)
  const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Dra. Paula Reis', homeRoomId: room.id }, clock)
  for (const resourceId of [pro.id, room.id]) {
    setWeeklyWindowsOp(db, caller, { resourceId, windows: [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 18 * 60 }, { dayOfWeek: 2, startMinute: 9 * 60, endMinute: 18 * 60 }] }, clock)
  }
  const laser = upsertServiceOp(
    db,
    caller,
    { name: 'Depilação a laser', durationMinutes: 60, bufferMinutes: 0, priceCents: 12_000, variantKind: 'Zona', variantKindPlural: 'Zonas', professionalIds: [pro.id], roomRequirement: { mode: 'none' } },
    clock,
  )
  replaceServiceZonesOp(
    db,
    caller,
    laser.id,
    [
      { name: 'Axilas', audience: 'ambos', durationMinutes: 15, priceCents: 4_000 },
      { name: 'Virilha', audience: 'ambos', durationMinutes: 30, priceCents: 8_000 },
    ],
    clock,
  )
  syncWhatsappChannel(db, TENANT, { status: 'connected', bindingId: 'b1', phoneNumberId: 'pn1', wabaId: 'w1', displayPhone: '+1555', action: 'channel_connected' }, clock)
  seedSyntheticWhatsappTemplates(db, TENANT, clock)
  const mk = (wa: string, name: string, key: string) => {
    const ing = ingestContactMessage(db, workerCaller(TENANT, 'system:ai-autodraft'), { providerEventKey: key, waId: wa, body: 'oi' }, clock)
    const c = upsertContact(db, { tenantId: TENANT, waId: wa, displayName: name }, clock)
    return { contactId: c.id, conversationId: ing.conversation!.id }
  }
  const marina = mk('5511900001111', 'Marina Souza', 'wa:m1')
  const outra = mk('5511900002222', 'Outra Pessoa', 'wa:o1')
  const zoneId = (name: string) => (db.get('SELECT id FROM service_zones WHERE tenant_id = ? AND service_id = ? AND name = ?', TENANT, laser.id, name) as { id: string }).id
  const book = async (who: { contactId: string; conversationId: string }, slotId: string, variantIds: string[] = []) => {
    const planned = await planWebProposal(db, TENANT, clock, who, { serviceId: laser.id, variantIds: variantIds.length ? variantIds : [zoneId('Axilas'), zoneId('Virilha')], line: null, slotId })
    if (!planned.ok) throw new Error(`plano falhou: ${planned.error}`)
    const done = await executeProposalConfirmOp(db, caller, { handoff: planned.handoff, capability: true, channel: 'web' }, clock)
    if (done.status !== 'booked') throw new Error(`não marcou: ${done.status}`)
    return done.appointment
  }
  return { db, close, clock, caller, laser, marina, outra, zoneId, book }
}

describe('remarcar pela página (REQ-113, DEC-198)', () => {
  it('horas para remarcar excluem a hora atual e libertam a própria vaga', async () => {
    const { db, close, clock, marina, book } = seed()
    try {
      const apt = await book(marina, '2024-01-08T10:00')
      const res = await listRescheduleSlots(db, TENANT, clock, marina, { appointmentId: apt.id, from: '2024-01-08', to: '2024-01-08' })
      if (!res.ok) throw new Error('sem horas')
      const times = res.slots.map((s) => s.time)
      expect(times).not.toContain('10:00')
      expect(times).toContain('10:15') // só livre porque a própria marcação deixa de ocupar
      expect(times).toContain('14:00')
    } finally {
      close()
    }
  })

  it('move a mesma marcação, mantém serviço e zonas e acrescenta o recibo no chat', async () => {
    const { db, close, clock, caller, marina, book } = seed()
    try {
      const apt = await book(marina, '2024-01-08T10:00')
      const planned = await planWebReschedule(db, TENANT, clock, marina, { appointmentId: apt.id, slotId: '2024-01-08T14:00' })
      if (!planned.ok) throw new Error(planned.error)
      expect(planned.proposal.replacesAppointmentId).toBe(apt.id)
      expect(planned.proposal.requiresSignal).toBe(false)
      const done = await executeProposalConfirmOp(db, caller, { handoff: planned.handoff, capability: true, channel: 'web' }, clock)
      expect(done.status).toBe('booked')

      const rows = db.all("SELECT id, status, starts_at, ends_at FROM appointments WHERE status = 'confirmed'") as Array<{ id: string; starts_at: number; ends_at: number }>
      expect(rows).toHaveLength(1)
      expect(rows[0]!.id).toBe(apt.id)
      expect(rows[0]!.starts_at).toBeGreaterThan(apt.startsAt)
      expect(rows[0]!.ends_at - rows[0]!.starts_at).toBe(apt.endsAt - apt.startsAt)
      const zones = db.all("SELECT zone_id FROM visit_zone_snapshots WHERE owner_kind = 'appointment' AND owner_id = ?", apt.id) as unknown[]
      expect(zones.length).toBe(2)
      const audit = db.all("SELECT actor FROM operational_audit WHERE action LIKE 'appointment.%'") as Array<{ actor: string }>
      expect(audit.some((a) => a.actor === 'contact:web')).toBe(true)
      const bodies = (db.all("SELECT body FROM messages WHERE direction = 'outbound'") as Array<{ body: string }>).map((m) => m.body)
      expect(bodies.some((b) => b.startsWith('Remarcado:') && b.includes(WEB_RECEIPT_SENTENCE))).toBe(true)
    } finally {
      close()
    }
  })

  it('recusa marcação de outra cliente, a hora atual e ids inválidos', async () => {
    const { db, close, clock, marina, outra, book } = seed()
    try {
      const apt = await book(marina, '2024-01-08T10:00')
      expect(await planWebReschedule(db, TENANT, clock, outra, { appointmentId: apt.id, slotId: '2024-01-08T14:00' })).toEqual({ ok: false, error: 'appointment_not_found' })
      expect(await planWebReschedule(db, TENANT, clock, marina, { appointmentId: apt.id, slotId: '2024-01-08T10:00' })).toEqual({ ok: false, error: 'slot_unavailable' })
      expect(await planWebReschedule(db, TENANT, clock, marina, { appointmentId: apt.id, slotId: 'amanhã' })).toEqual({ ok: false, error: 'slot_invalid' })
      expect(await planWebReschedule(db, TENANT, clock, marina, { appointmentId: 'apt-inventada', slotId: '2024-01-08T14:00' })).toEqual({ ok: false, error: 'appointment_not_found' })
      expect(loadWebAppointment(db, TENANT, clock, outra, apt.id)).toBeNull()
      expect((await listRescheduleSlots(db, TENANT, clock, outra, { appointmentId: apt.id, from: '2024-01-08', to: '2024-01-08' })).ok).toBe(false)
    } finally {
      close()
    }
  })

  it('toque duplo: depois de remarcar, o mesmo pedido devolve a marcação e não erra', async () => {
    const { db, close, clock, caller, marina, book } = seed()
    try {
      const apt = await book(marina, '2024-01-08T10:00')
      expect(rescheduleAlreadyAt(db, TENANT, clock, marina, { appointmentId: apt.id, slotId: '2024-01-08T14:00' })).toBeNull()
      const planned = await planWebReschedule(db, TENANT, clock, marina, { appointmentId: apt.id, slotId: '2024-01-08T14:00' })
      if (!planned.ok) throw new Error(planned.error)
      await executeProposalConfirmOp(db, caller, { handoff: planned.handoff, capability: true, channel: 'web' }, clock)
      clock.advance(1000)
      expect(rescheduleAlreadyAt(db, TENANT, clock, marina, { appointmentId: apt.id, slotId: '2024-01-08T14:00' })?.id).toBe(apt.id)
      expect(rescheduleAlreadyAt(db, TENANT, clock, marina, { appointmentId: apt.id, slotId: '2024-01-08T15:00' })).toBeNull()
    } finally {
      close()
    }
  })
})

describe('cancelar pela página (REQ-114, DEC-198)', () => {
  it('cancela uma marcação sem sinal, com ator contact:web, e repetir não faz nada de novo', async () => {
    const { db, close, clock, caller, marina, book } = seed()
    try {
      const apt = await book(marina, '2024-01-08T10:00')
      const first = cancelFromWeb(db, workerCaller(TENANT, 'contact:web'), clock, marina, apt.id)
      expect(first.result).toMatchObject({ status: 'cancelled', serviceName: 'Depilação a laser' })
      expect(db.get('SELECT status, cancelled_by FROM appointments WHERE id = ?', apt.id)).toMatchObject({ status: 'cancelled', cancelled_by: 'contact:web' })
      // skipCancelNotice: o aviso genérico DEC-095 não sai aqui (só o recibo web).
      const afterCancel = (db.all("SELECT body FROM messages WHERE direction = 'outbound'") as Array<{ body: string }>).map((m) => m.body)
      expect(afterCancel.filter((b) => b.startsWith('Cancelado:'))).toEqual([])
      const again = cancelFromWeb(db, caller, clock, marina, apt.id)
      expect(again.result).toMatchObject({ status: 'cancelled' })
      expect(again.outbox).toEqual([])
      const cancelled = first.result as { status: 'cancelled'; serviceName: string; startsAt: number }
      expect(
        cancelReceiptBody(db, TENANT, clock, { ...cancelled, appointmentId: apt.id }),
      ).toMatch(/^Cancelado: Depilação a laser · Axilas, Virilha · .*Não foi você\? Fale com a equipe\.$/)
    } finally {
      close()
    }
  })

  it('CW-12 (unidade): um recibo com zonas + follow-up Posso ajudar (sem duplicar Cancelado)', async () => {
    const { db, close, clock, marina, book } = seed()
    try {
      const apt = await book(marina, '2024-01-08T10:00')
      const beforeHelp = (
        db.all("SELECT body FROM messages WHERE direction = 'outbound'") as Array<{ body: string }>
      ).filter((m) => m.body === POST_BOOKING_BODY).length
      const webCaller = workerCaller(TENANT, 'contact:web')
      const done = cancelFromWeb(db, webCaller, clock, marina, apt.id)
      expect(done.result.status).toBe('cancelled')
      const cancelled = done.result as { status: 'cancelled'; serviceName: string; startsAt: number }
      appendWebCancelChatEffects(
        db,
        webCaller,
        {
          conversationId: marina.conversationId,
          appointmentId: apt.id,
          serviceName: cancelled.serviceName,
          startsAt: cancelled.startsAt,
        },
        clock,
        done.outbox,
      )
      const bodies = (db.all("SELECT body FROM messages WHERE direction = 'outbound' ORDER BY created_at") as Array<{ body: string }>).map(
        (m) => m.body,
      )
      const cancelados = bodies.filter((b) => b.startsWith('Cancelado:'))
      expect(cancelados).toHaveLength(1)
      expect(cancelados[0]).toContain('Axilas, Virilha')
      expect(cancelados[0]).toContain(WEB_CANCEL_RECEIPT_SENTENCE)
      // Pós-cancelamento acrescenta um DEC-086 (clientRequestId distinto do pós-Agendado).
      expect(bodies.filter((b) => b === POST_BOOKING_BODY)).toHaveLength(beforeHelp + 1)
      // Idempotente: segundo efeito não duplica recibo nem follow-up pós-cancel.
      appendWebCancelChatEffects(
        db,
        webCaller,
        {
          conversationId: marina.conversationId,
          appointmentId: apt.id,
          serviceName: cancelled.serviceName,
          startsAt: cancelled.startsAt,
        },
        clock,
        [],
      )
      const bodiesAgain = (db.all("SELECT body FROM messages WHERE direction = 'outbound'") as Array<{ body: string }>).map((m) => m.body)
      expect(bodiesAgain.filter((b) => b.startsWith('Cancelado:'))).toHaveLength(1)
      expect(bodiesAgain.filter((b) => b === POST_BOOKING_BODY)).toHaveLength(beforeHelp + 1)
    } finally {
      close()
    }
  })

  it('não cancela marcação de outra cliente nem inexistente', async () => {
    const { db, close, clock, caller, marina, outra, book } = seed()
    try {
      const apt = await book(marina, '2024-01-08T10:00')
      expect(cancelFromWeb(db, caller, clock, outra, apt.id).result).toEqual({ status: 'not_found' })
      expect(cancelFromWeb(db, caller, clock, marina, 'apt-inventada').result).toEqual({ status: 'not_found' })
      expect(db.get('SELECT status FROM appointments WHERE id = ?', apt.id)).toMatchObject({ status: 'confirmed' })
    } finally {
      close()
    }
  })

  it('com sinal pago não cancela: pede à equipe e a marcação fica', async () => {
    const { db, close, clock, caller, marina, book } = seed()
    try {
      const apt = await book(marina, '2024-01-08T10:00')
      expect(hasPaidSignal(db, TENANT, apt.id)).toBe(false)
      db.run('PRAGMA foreign_keys = OFF')
      db.run(
        `INSERT INTO pix_charges (id, tenant_id, account_id, provider, external_reference, amount_cents, status, appointment_id, created_at, updated_at)
         VALUES ('chg-1', ?, 'acc-1', 'synthetic', 'ref-1', 5000, 'paid', ?, 1, 1)`,
        TENANT,
        apt.id,
      )
      expect(hasPaidSignal(db, TENANT, apt.id)).toBe(true)
      expect(loadWebAppointment(db, TENANT, clock, marina, apt.id)?.hasPaidSignal).toBe(true)
      const res = cancelFromWeb(db, caller, clock, marina, apt.id)
      expect(res.result).toEqual({ status: 'needs_team' })
      expect(db.get('SELECT status FROM appointments WHERE id = ?', apt.id)).toMatchObject({ status: 'confirmed' })
    } finally {
      close()
    }
  })
})
