import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../db/clock'
import { ingestContactMessage, workerCaller } from '../clinic'
import { bootClinicDb } from '../clinic/test-db'
import {
  replaceServiceZonesOp,
  setWeeklyWindowsOp,
  upsertResourceOp,
  upsertServiceOp,
} from '../clinic/config'
import { upsertContact } from '../clinic/contacts'
import { syncWhatsappChannel } from '../clinic/whatsapp/channel'
import { seedSyntheticWhatsappTemplates } from '../clinic/inbox/templates'
import { executeProposalConfirmOp } from '../clinic/proposals/execute-confirm'
import { WEB_RECEIPT_SENTENCE } from '../clinic/proposals/render'
import {
  CLIENT_WEB_HORIZON_DAYS,
  clampDateRange,
  findRecentWebBooking,
  listClientWebSlots,
  planWebProposal,
  readClientWebCatalog,
} from './booking'

const TENANT = 'clinic-demo-a'

/** Domingo 07/01/2024 15:00 UTC; segunda 08/01 tem expediente 09–18. */
function seed() {
  const clock = createControllableClock(Date.UTC(2024, 0, 7, 15))
  const { db, close } = bootClinicDb({ clock })
  const caller = workerCaller(TENANT, 'user_synth_owner_a')
  const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala 1' }, clock)
  const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Dra. Paula Reis', homeRoomId: room.id }, clock)
  setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 18 * 60 }] }, clock)
  setWeeklyWindowsOp(db, caller, { resourceId: room.id, windows: [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 18 * 60 }] }, clock)
  const simple = upsertServiceOp(
    db,
    caller,
    { name: 'Limpeza de pele', durationMinutes: 60, bufferMinutes: 0, priceCents: 12_000, professionalIds: [pro.id], roomRequirement: { mode: 'none' } },
    clock,
  )
  const laser = upsertServiceOp(
    db,
    caller,
    {
      name: 'Depilação a laser',
      durationMinutes: 60,
      bufferMinutes: 0,
      priceCents: 12_000,
      variantKind: 'Zona',
      variantKindPlural: 'Zonas',
      professionalIds: [pro.id],
      roomRequirement: { mode: 'none' },
    },
    clock,
  )
  replaceServiceZonesOp(
    db,
    caller,
    laser.id,
    [
      { name: 'Axilas', audience: 'feminino', durationMinutes: 15, priceCents: 4_000 },
      { name: 'Barba', audience: 'masculino', durationMinutes: 30, priceCents: 8_000 },
      { name: 'Sobrancelha', audience: 'ambos', durationMinutes: 15, priceCents: 3_000 },
    ],
    clock,
  )
  const inactive = upsertServiceOp(
    db,
    caller,
    { name: 'Serviço desligado', durationMinutes: 30, bufferMinutes: 0, professionalIds: [pro.id], roomRequirement: { mode: 'none' } },
    clock,
  )
  db.run('UPDATE services SET active = 0 WHERE tenant_id = ? AND id = ?', TENANT, inactive.id)

  syncWhatsappChannel(
    db,
    TENANT,
    { status: 'connected', bindingId: 'b1', phoneNumberId: 'pn1', wabaId: 'w1', displayPhone: '+1555', action: 'channel_connected' },
    clock,
  )
  seedSyntheticWhatsappTemplates(db, TENANT, clock)
  const ingested = ingestContactMessage(
    db,
    workerCaller(TENANT, 'system:ai-autodraft'),
    { providerEventKey: 'wa:web:1', waId: '5511900001111', body: 'quero agendar' },
    clock,
  )
  const contact = upsertContact(db, { tenantId: TENANT, waId: '5511900001111', displayName: 'Marina Souza' }, clock)
  const session = { contactId: contact.id, conversationId: ingested.conversation!.id }
  const zoneId = (name: string) =>
    (db.get('SELECT id FROM service_zones WHERE tenant_id = ? AND service_id = ? AND name = ?', TENANT, laser.id, name) as { id: string }).id
  return { db, close, clock, caller, simple, laser, session, zoneId }
}

describe('catálogo da página (REQ-112)', () => {
  it('lista só serviços ativos e marcáveis, com zonas ativas e horizonte', () => {
    const { db, close, clock, laser } = seed()
    try {
      const catalog = readClientWebCatalog(db, TENANT, clock)
      expect(catalog.services.map((s) => s.name).sort()).toEqual(['Depilação a laser', 'Limpeza de pele'])
      expect(catalog.horizonDays).toBe(CLIENT_WEB_HORIZON_DAYS)
      expect(catalog.today).toBe('2024-01-07')
      const l = catalog.services.find((s) => s.id === laser.id)!
      expect(l.zones.map((z) => z.name).sort()).toEqual(['Axilas', 'Barba', 'Sobrancelha'])
      expect(JSON.stringify(catalog)).not.toMatch(/synonym|sinónimo/i)
    } finally {
      close()
    }
  })

  it('serviço cujas zonas estão todas inativas não é marcável', () => {
    const { db, close, clock, laser } = seed()
    try {
      db.run('UPDATE service_zones SET active = 0 WHERE tenant_id = ? AND service_id = ?', TENANT, laser.id)
      expect(readClientWebCatalog(db, TENANT, clock).services.map((s) => s.name)).toEqual(['Limpeza de pele'])
    } finally {
      close()
    }
  })
})

describe('horas por intervalo (DEC-201 provisório)', () => {
  it('clampDateRange limita ao horizonte e recusa intervalos inválidos', () => {
    expect(clampDateRange('2024-01-07', '2024-01-01', '2024-01-09')).toEqual({ from: '2024-01-07', to: '2024-01-09' })
    expect(clampDateRange('2024-01-07', '2024-01-07', '2025-01-01')).toEqual({ from: '2024-01-07', to: '2024-02-05' })
    expect(clampDateRange('2024-01-07', '2024-03-01', '2024-03-05')).toBeNull()
    expect(clampDateRange('2024-01-07', 'ontem', '2024-01-09')).toBeNull()
  })

  it('devolve as horas de segunda e nenhuma no domingo', async () => {
    const { db, close, clock, simple } = seed()
    try {
      const res = await listClientWebSlots(db, TENANT, clock, { serviceId: simple.id, variantIds: [], from: '2024-01-07', to: '2024-01-08' })
      expect(res.ok).toBe(true)
      if (!res.ok) return
      expect(res.slots.every((s) => s.date === '2024-01-08')).toBe(true)
      expect(res.slots[0]).toEqual({ id: '2024-01-08T09:00', date: '2024-01-08', time: '09:00' })
      expect(res.slots.length).toBeGreaterThan(5)
    } finally {
      close()
    }
  })

  it('recusa serviço desligado, zona inexistente e intervalo fora do horizonte', async () => {
    const { db, close, clock, simple, laser } = seed()
    try {
      const inactive = db.get('SELECT id FROM services WHERE name = ?', 'Serviço desligado') as { id: string }
      expect(await listClientWebSlots(db, TENANT, clock, { serviceId: inactive.id, variantIds: [], from: '2024-01-08', to: '2024-01-08' })).toEqual({ ok: false, error: 'service_unavailable' })
      expect(await listClientWebSlots(db, TENANT, clock, { serviceId: laser.id, variantIds: ['zone-inventada'], from: '2024-01-08', to: '2024-01-08' })).toEqual({ ok: false, error: 'variants_invalid' })
      expect(await listClientWebSlots(db, TENANT, clock, { serviceId: simple.id, variantIds: [], from: '2025-01-01', to: '2025-01-02' })).toEqual({ ok: false, error: 'range_invalid' })
    } finally {
      close()
    }
  })
})

describe('planWebProposal + executor com canal web (DEC-197)', () => {
  it('cria a proposta enviada e autorizada, e o executor marca com ator e recibo da página', async () => {
    const { db, close, clock, caller, simple, session } = seed()
    try {
      const planned = await planWebProposal(db, TENANT, clock, session, { serviceId: simple.id, variantIds: [], line: null, slotId: '2024-01-08T10:00' })
      expect(planned.ok).toBe(true)
      if (!planned.ok) return
      expect(planned.proposal.state).toBe('enviada')
      expect(planned.handoff.authorization.allowed).toBe(true)

      const done = await executeProposalConfirmOp(db, caller, { handoff: planned.handoff, capability: true, channel: 'web' }, clock)
      expect(done.status).toBe('booked')
      if (done.status !== 'booked') return

      const apt = db.get('SELECT contact_id, status, confirmed_by FROM appointments WHERE tenant_id = ? AND id = ?', TENANT, done.appointment.id) as { contact_id: string; status: string; confirmed_by: string }
      expect(apt).toMatchObject({ contact_id: session.contactId, status: 'confirmed', confirmed_by: 'contact:web' })
      const audit = db.all("SELECT action, actor FROM operational_audit WHERE action LIKE 'appointment.%booked'") as Array<{ action: string; actor: string }>
      expect(audit).toContainEqual({ action: 'appointment.client_web_booked', actor: 'contact:web' })
      expect(audit.some((a) => a.action === 'appointment.ai_booked')).toBe(false)
      const sent = db.all("SELECT body FROM messages WHERE direction = 'outbound' ORDER BY created_at") as Array<{ body: string }>
      expect(sent.some((m) => m.body.includes(WEB_RECEIPT_SENTENCE))).toBe(true)
    } finally {
      close()
    }
  })

  it('o mesmo toque duas vezes não duplica a marcação', async () => {
    const { db, close, clock, caller, simple, session } = seed()
    try {
      const planned = await planWebProposal(db, TENANT, clock, session, { serviceId: simple.id, variantIds: [], line: null, slotId: '2024-01-08T11:00' })
      if (!planned.ok) throw new Error('plano falhou')
      const first = await executeProposalConfirmOp(db, caller, { handoff: planned.handoff, capability: true, channel: 'web' }, clock)
      const again = await executeProposalConfirmOp(db, caller, { handoff: planned.handoff, capability: true, channel: 'web' }, clock)
      expect(first.status).toBe('booked')
      expect(again.status).toBe('booked')
      expect((db.get("SELECT COUNT(*) AS n FROM appointments WHERE status = 'confirmed'") as { n: number }).n).toBe(1)
    } finally {
      close()
    }
  })

  it('hora ocupada, id inválido e fora do horizonte são recusados antes de criar proposta', async () => {
    const { db, close, clock, caller, simple, session } = seed()
    try {
      const first = await planWebProposal(db, TENANT, clock, session, { serviceId: simple.id, variantIds: [], line: null, slotId: '2024-01-08T09:00' })
      if (!first.ok) throw new Error('plano falhou')
      await executeProposalConfirmOp(db, caller, { handoff: first.handoff, capability: true, channel: 'web' }, clock)
      const taken = await planWebProposal(db, TENANT, clock, session, { serviceId: simple.id, variantIds: [], line: null, slotId: '2024-01-08T09:00' })
      expect(taken).toEqual({ ok: false, error: 'slot_unavailable' })
      expect(await planWebProposal(db, TENANT, clock, session, { serviceId: simple.id, variantIds: [], line: null, slotId: 'segunda às 10' })).toEqual({ ok: false, error: 'slot_invalid' })
      expect(await planWebProposal(db, TENANT, clock, session, { serviceId: simple.id, variantIds: [], line: null, slotId: '2025-01-06T10:00' })).toEqual({ ok: false, error: 'slot_invalid' })
    } finally {
      close()
    }
  })

  it('zonas: exige a linha quando há duas, recusa zona de outro género e soma a duração', async () => {
    const { db, close, clock, laser, session, zoneId } = seed()
    try {
      const base = { serviceId: laser.id, slotId: '2024-01-08T10:00' }
      expect(await planWebProposal(db, TENANT, clock, session, { ...base, variantIds: [zoneId('Axilas')], line: null })).toEqual({ ok: false, error: 'line_required' })
      expect(await planWebProposal(db, TENANT, clock, session, { ...base, variantIds: [zoneId('Barba')], line: 'feminino' })).toEqual({ ok: false, error: 'line_mismatch' })
      const ok = await planWebProposal(db, TENANT, clock, session, { ...base, variantIds: [zoneId('Axilas'), zoneId('Sobrancelha')], line: 'feminino' })
      expect(ok.ok).toBe(true)
      if (!ok.ok) return
      expect(ok.proposal.endsAt - ok.proposal.startsAt).toBeGreaterThan(0)
      expect(await planWebProposal(db, TENANT, clock, session, { ...base, variantIds: ['zona-inventada'], line: 'feminino' })).toEqual({ ok: false, error: 'variants_invalid' })
    } finally {
      close()
    }
  })

  it('uma proposta nova da mesma conversa substitui a anterior (uma versão válida)', async () => {
    const { db, close, clock, simple, session } = seed()
    try {
      const a = await planWebProposal(db, TENANT, clock, session, { serviceId: simple.id, variantIds: [], line: null, slotId: '2024-01-08T10:00' })
      const b = await planWebProposal(db, TENANT, clock, session, { serviceId: simple.id, variantIds: [], line: null, slotId: '2024-01-08T14:00' })
      if (!a.ok || !b.ok) throw new Error('plano falhou')
      expect(b.proposal.version).toBe(a.proposal.version + 1)
      expect((db.get("SELECT COUNT(*) AS n FROM appointment_proposals WHERE state = 'enviada'") as { n: number }).n).toBe(1)
    } finally {
      close()
    }
  })

  it('findRecentWebBooking devolve a marcação da própria cliente (toque duplo) e mais nenhuma', async () => {
    const { db, close, clock, caller, simple, session } = seed()
    try {
      const slotId = '2024-01-08T15:00'
      expect(findRecentWebBooking(db, TENANT, clock, session, { serviceId: simple.id, slotId })).toBeNull()
      const planned = await planWebProposal(db, TENANT, clock, session, { serviceId: simple.id, variantIds: [], line: null, slotId })
      if (!planned.ok) throw new Error('plano falhou')
      const done = await executeProposalConfirmOp(db, caller, { handoff: planned.handoff, capability: true, channel: 'web' }, clock)
      if (done.status !== 'booked') throw new Error('não marcou')
      expect(findRecentWebBooking(db, TENANT, clock, session, { serviceId: simple.id, slotId })?.id).toBe(done.appointment.id)
      // Outra cliente, outro serviço ou outra hora não a veem.
      expect(findRecentWebBooking(db, TENANT, clock, { contactId: 'ctc-outra' }, { serviceId: simple.id, slotId })).toBeNull()
      expect(findRecentWebBooking(db, TENANT, clock, session, { serviceId: 'svc-outro', slotId })).toBeNull()
      expect(findRecentWebBooking(db, TENANT, clock, session, { serviceId: simple.id, slotId: '2024-01-08T16:00' })).toBeNull()
      // Passados 10 minutos já não vale como repetição.
      clock.advance(11 * 60 * 1000)
      expect(findRecentWebBooking(db, TENANT, clock, session, { serviceId: simple.id, slotId })).toBeNull()
    } finally {
      close()
    }
  })
})
