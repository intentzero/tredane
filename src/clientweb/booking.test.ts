import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../db/clock'
import { ingestContactMessage, workerCaller } from '../clinic'
import { bootClinicDb } from '../clinic/test-db'
import {
  replaceServiceCombosOp,
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
      expect(l.combos).toEqual([])
    } finally {
      close()
    }
  })

  it('inclui combos activos aplicáveis no catálogo (DEC-080)', () => {
    const { db, close, clock, caller, laser, zoneId } = seed()
    try {
      replaceServiceCombosOp(
        db,
        caller,
        laser.id,
        [
          {
            name: 'Axilas + sobrancelha',
            priceCents: 6_000,
            zoneIds: [zoneId('Axilas'), zoneId('Sobrancelha')],
            active: true,
          },
        ],
        clock,
      )
      const l = readClientWebCatalog(db, TENANT, clock).services.find((s) => s.id === laser.id)!
      expect(l.combos).toHaveLength(1)
      expect(l.combos[0]).toMatchObject({
        name: 'Axilas + sobrancelha',
        priceCents: 6_000,
        zoneIds: [zoneId('Axilas'), zoneId('Sobrancelha')],
      })
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

  it('serviço sem profissional activa não entra no catálogo nem marca (Conferir)', async () => {
    const { db, close, clock, caller, session } = seed()
    try {
      const orphan = upsertServiceOp(
        db,
        caller,
        {
          name: 'Bronzeamento',
          durationMinutes: 30,
          bufferMinutes: 0,
          priceCents: 15_000,
          professionalIds: [],
          roomRequirement: { mode: 'none' },
        },
        clock,
      )
      expect(readClientWebCatalog(db, TENANT, clock).services.map((s) => s.name)).not.toContain('Bronzeamento')
      expect(
        await listClientWebSlots(db, TENANT, clock, {
          serviceId: orphan.id,
          variantIds: [],
          from: '2024-01-08',
          to: '2024-01-08',
        }),
      ).toEqual({ ok: false, error: 'service_unavailable' })
      expect(
        await planWebProposal(db, TENANT, clock, session, {
          serviceId: orphan.id,
          variantIds: [],
          line: null,
          slotId: '2024-01-08T09:00',
        }),
      ).toEqual({ ok: false, error: 'service_unavailable' })
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

  it('daysOnly devolve só a primeira hora de cada dia (calendário) e não tem o teto de horas', async () => {
    const { db, close, clock, simple } = seed()
    try {
      const res = await listClientWebSlots(db, TENANT, clock, { serviceId: simple.id, variantIds: [], from: '2024-01-07', to: '2024-01-22', daysOnly: true })
      if (!res.ok) throw new Error('sem resultado')
      expect(res.slots.map((s) => s.date)).toEqual(['2024-01-08', '2024-01-15', '2024-01-22'])
      expect(res.slots.every((s) => s.time === '09:00')).toBe(true)
    } finally {
      close()
    }
  })

  it('o catálogo leva os sinónimos só para a pesquisa casar', () => {
    const { db, close, clock, simple } = seed()
    try {
      db.run('UPDATE services SET synonyms_json = ? WHERE tenant_id = ? AND id = ?', JSON.stringify(['limpeza facial']), TENANT, simple.id)
      const svc = readClientWebCatalog(db, TENANT, clock).services.find((x) => x.id === simple.id)!
      expect(svc.synonyms).toEqual(['limpeza facial'])
    } finally {
      close()
    }
  })
})

describe('preferência de profissional (DEC-218)', () => {
  function seedTwoPros() {
    const clock = createControllableClock(Date.UTC(2024, 0, 7, 15))
    const { db, close } = bootClinicDb({ clock })
    const caller = workerCaller(TENANT, 'user_synth_owner_a')
    const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala 1' }, clock)
    const gi = upsertResourceOp(db, caller, { kind: 'professional', name: 'Gi', homeRoomId: room.id }, clock)
    const paula = upsertResourceOp(
      db,
      caller,
      { kind: 'professional', name: 'Paula', homeRoomId: room.id },
      clock,
    )
    for (const pro of [gi, paula]) {
      setWeeklyWindowsOp(
        db,
        caller,
        { resourceId: pro.id, windows: [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 18 * 60 }] },
        clock,
      )
    }
    setWeeklyWindowsOp(
      db,
      caller,
      { resourceId: room.id, windows: [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 18 * 60 }] },
      clock,
    )
    const service = upsertServiceOp(
      db,
      caller,
      {
        name: 'Limpeza de pele',
        durationMinutes: 60,
        bufferMinutes: 0,
        priceCents: 12_000,
        professionalIds: [gi.id, paula.id],
        roomRequirement: { mode: 'none' },
      },
      clock,
    )
    syncWhatsappChannel(
      db,
      TENANT,
      {
        status: 'connected',
        bindingId: 'b1',
        phoneNumberId: 'pn1',
        wabaId: 'w1',
        displayPhone: '+1555',
        action: 'channel_connected',
      },
      clock,
    )
    seedSyntheticWhatsappTemplates(db, TENANT, clock)
    const ingested = ingestContactMessage(
      db,
      workerCaller(TENANT, 'system:ai-autodraft'),
      { providerEventKey: 'wa:web:pref:1', waId: '5511900002222', body: 'quero agendar' },
      clock,
    )
    const contact = upsertContact(
      db,
      { tenantId: TENANT, waId: '5511900002222', displayName: 'Marina Souza' },
      clock,
    )
    const session = { contactId: contact.id, conversationId: ingested.conversation!.id }
    return { db, close, clock, caller, service, gi, paula, session }
  }

  it('catálogo lista profissionais ativas do serviço', () => {
    const { db, close, clock, service, gi, paula } = seedTwoPros()
    try {
      const svc = readClientWebCatalog(db, TENANT, clock).services.find((s) => s.id === service.id)!
      expect(svc.professionals.map((p) => p.name).sort()).toEqual(['Gi', 'Paula'])
      expect(svc.professionals.map((p) => p.id).sort()).toEqual([gi.id, paula.id].sort())
    } finally {
      close()
    }
  })

  it('filtra horas pela profissional preferida', async () => {
    const { db, close, clock, service, gi } = seedTwoPros()
    try {
      const all = await listClientWebSlots(db, TENANT, clock, {
        serviceId: service.id,
        variantIds: [],
        from: '2024-01-08',
        to: '2024-01-08',
      })
      const onlyGi = await listClientWebSlots(db, TENANT, clock, {
        serviceId: service.id,
        variantIds: [],
        from: '2024-01-08',
        to: '2024-01-08',
        professionalId: gi.id,
      })
      expect(all.ok && onlyGi.ok).toBe(true)
      if (!all.ok || !onlyGi.ok) return
      expect(all.slots.length).toBeGreaterThan(0)
      expect(onlyGi.slots.length).toBeGreaterThan(0)
      expect(onlyGi.slots[0]!.id).toBe('2024-01-08T09:00')
      expect(
        await listClientWebSlots(db, TENANT, clock, {
          serviceId: service.id,
          variantIds: [],
          from: '2024-01-08',
          to: '2024-01-08',
          professionalId: 'pro-inventada',
        }),
      ).toEqual({ ok: false, error: 'professional_invalid' })
    } finally {
      close()
    }
  })

  it('Sem preferência atribui por round-robin e grava o cursor por serviço', async () => {
    const { db, close, clock, caller, service, gi, paula, session } = seedTwoPros()
    try {
      const ordered = [gi, paula].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
      const first = await planWebProposal(db, TENANT, clock, session, {
        serviceId: service.id,
        variantIds: [],
        line: null,
        slotId: '2024-01-08T09:00',
      })
      expect(first.ok).toBe(true)
      if (!first.ok) return
      expect(first.proposal.professionalId).toBe(ordered[0]!.id)
      await executeProposalConfirmOp(
        db,
        caller,
        { handoff: first.handoff, capability: true, channel: 'web' },
        clock,
      )

      const second = await planWebProposal(db, TENANT, clock, session, {
        serviceId: service.id,
        variantIds: [],
        line: null,
        slotId: '2024-01-08T10:00',
      })
      expect(second.ok).toBe(true)
      if (!second.ok) return
      expect(second.proposal.professionalId).toBe(ordered[1]!.id)

      const preferred = await planWebProposal(db, TENANT, clock, session, {
        serviceId: service.id,
        variantIds: [],
        line: null,
        slotId: '2024-01-08T11:00',
        professionalId: paula.id,
      })
      expect(preferred.ok).toBe(true)
      if (!preferred.ok) return
      expect(preferred.proposal.professionalId).toBe(paula.id)
    } finally {
      close()
    }
  })
})
