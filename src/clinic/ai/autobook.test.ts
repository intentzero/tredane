/**
 * Agendamento pela IA após confirmação explícita (Paulo, 28/10/2026).
 * Caso base = staging: depilação masculina com a Gi, quinta 29/10/2026.
 */
import { describe, expect, it } from 'vitest'
import { SimulatedAiAdapter } from '../../ai'
import { createControllableClock } from '../../db/clock'
import { setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import { setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { cancelAppointmentOp, confirmAppointmentOp, zonedCivilToUtc } from '../scheduling'
import { bootClinicDb } from '../test-db'
import { AI_AUTOBOOK_ACTOR_ID, detectExplicitConfirmation } from './autobook'
import { enqueueAutoDraft, runDueAutoDrafts } from './index'

const TZ = 'America/Sao_Paulo'
// Quarta 28/10/2026 15:51 em São Paulo.
const NOW = Date.UTC(2026, 9, 28, 18, 51)

function seed(opts: { signal?: boolean } = {}) {
  const clock = createControllableClock(NOW)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-a'
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  const gi = upsertResourceOp(db, caller, { kind: 'professional', name: 'Gi' }, clock)
  const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala depilação', category: 'Sala' }, clock)
  const svc = upsertServiceOp(
    db,
    caller,
    {
      name: 'Depilacao masculina',
      durationMinutes: 60,
      bufferMinutes: 15,
      priceCents: 20000,
      professionalIds: [gi.id],
      roomRequirement: { mode: 'none' },
      ...(opts.signal ? { requiresSignal: true, signalKind: 'fixed' as const, signalFixedCents: 5000 } : {}),
    },
    clock,
  )
  upsertServiceOp(
    db,
    caller,
    { name: 'Limpeza de pele', durationMinutes: 60, bufferMinutes: 0, priceCents: 18000, professionalIds: [gi.id], roomRequirement: { mode: 'none' } },
    clock,
  )
  const week = [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, startMinute: 540, endMinute: 1020 }))
  setWeeklyWindowsOp(db, caller, { resourceId: gi.id, windows: [...week, { dayOfWeek: 6, startMinute: 540, endMinute: 720 }] }, clock)
  setWeeklyWindowsOp(db, caller, { resourceId: room.id, windows: week }, clock)
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(db, { tenantId, waId: '5511900000009', displayName: 'Paulo Teste' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  let t = NOW - 10 * 60_000
  const say = (direction: 'inbound' | 'outbound', body: string) => {
    const m = insertMessage(
      db,
      { tenantId, conversationId: cnv.id, direction, body, deliveryState: direction === 'inbound' ? 'received' : 'delivered', createdAt: t },
      clock,
    )
    t += 60_000
    return m
  }
  const run = async (autoBook = true) => {
    const last = db.get<{ id: string }>(
      `SELECT id FROM messages WHERE conversation_id = ? AND direction = 'inbound' ORDER BY created_at DESC LIMIT 1`,
      cnv.id,
    )!
    enqueueAutoDraft(db, tenantId, { conversationId: cnv.id, messageId: last.id }, clock)
    clock.advance(7_000)
    const out = await runDueAutoDrafts(db, caller, clock, { mode: 'synthetic', adapter: new SimulatedAiAdapter(), autoBook })
    expect(out).toHaveLength(1)
    return out[0]!
  }
  const appts = () =>
    db.all<{ id: string; starts_at: number; confirmed_by: string; status: string }>(
      `SELECT id, starts_at, confirmed_by, status FROM appointments WHERE tenant_id = ? AND contact_id = ?`,
      tenantId,
      contact.id,
    )
  return { ...boot, clock, caller, tenantId, gi, svc, cnv, say, run, appts }
}

const at = (h: number, m = 0) => zonedCivilToUtc(TZ, 2026, 10, 29, h, m)

describe('agendamento pela IA após confirmação explícita', () => {
  it('confirmação completa (dia, horário e procedimento) marca, com actor IA e auditoria', async () => {
    const s = seed()
    try {
      s.say('inbound', 'depilação masculina, tem algum horário para amanhã na parte da tarde?')
      s.say('outbound', 'Tenho amanhã (quinta, 29/10) às 14:00, 15:00 e 15:45 para a depilação masculina. Qual prefere?')
      const conf = s.say('inbound', 'Pode ser às 15h')
      const o = await s.run()
      expect(o.autoBook?.status).toBe('booked')
      const [apt] = s.appts()
      expect(apt!.starts_at).toBe(at(15))
      expect(apt!.confirmed_by).toBe(AI_AUTOBOOK_ACTOR_ID)
      expect(o.suggestion!.suggestedText).toMatch(/Agendei Depilacao masculina para quinta 29\/10 às 15:00/)
      const audit = s.db.get<{ actor: string; detail_json: string }>(
        `SELECT * FROM operational_audit WHERE action = 'appointment.ai_booked'`,
      )!
      expect(audit.actor).toBe(AI_AUTOBOOK_ACTOR_ID)
      expect(JSON.parse(audit.detail_json).confirmationMessageId).toBe(conf.id)
      const sys = s.db.get<{ body: string }>(
        `SELECT body FROM messages WHERE conversation_id = ? AND direction = 'system'`,
        s.cnv.id,
      )!
      expect(sys.body).toMatch(/^Marcado pela IA: Depilacao masculina · quinta 29\/10 às 15:00 · Gi/)
      // Repetir o mesmo turno não marca duas vezes.
      s.db.run(`DELETE FROM ai_autodraft_jobs`)
      await s.run()
      expect(s.appts()).toHaveLength(1)
    } finally {
      s.close()
    }
  })

  it('«sim» a uma proposta com os três elementos marca', async () => {
    const s = seed()
    try {
      s.say('outbound', 'Confirma depilação masculina na quinta 29/10 às 14:00?')
      s.say('inbound', 'Sim, confirmo!')
      const o = await s.run()
      expect(o.autoBook?.status).toBe('booked')
      expect(s.appts()[0]!.starts_at).toBe(at(14))
    } finally {
      s.close()
    }
  })

  it.each([
    ['falta o dia', 'Tenho 14:00 para a depilação masculina. Pode ser?', 'Sim', 'dia'],
    ['falta o horário', 'Amanhã (29/10) tenho a tarde livre para a depilação masculina.', 'Pode ser, quero', 'horario'],
    ['falta o procedimento', 'Amanhã (29/10) às 14:00 fica bom?', 'Sim', 'procedimento'],
  ])('%s → não marca e pede confirmação', async (_l, clinic, client, missing) => {
    const s = seed()
    try {
      s.say('inbound', 'Oi')
      s.say('outbound', clinic)
      s.say('inbound', client)
      const o = await s.run()
      expect(o.autoBook?.status).toBe('needs_info')
      expect(o.autoBook?.missing).toContain(missing)
      expect(s.appts()).toHaveLength(0)
      expect(o.suggestion!.internalNotes).toMatch(/Agendamento pela IA não feito/)
    } finally {
      s.close()
    }
  })

  it.each([
    ['«sim» a vários horários', 'Amanhã (29/10) tenho 14:00, 15:00 e 16:00 para a depilação masculina.', 'Sim'],
    ['dois horários na resposta', 'Amanhã (29/10) tenho 14:00 e 15:00 para a depilação masculina.', '14h ou 15h'],
    ['hesitação', 'Confirma depilação masculina na quinta 29/10 às 14:00?', 'Talvez, vou ver'],
    ['pergunta', 'Confirma depilação masculina na quinta 29/10 às 16:00?', 'Pode ser às 14h?'],
  ])('ambíguo (%s) → não marca', async (_l, clinic, client) => {
    const s = seed()
    try {
      s.say('outbound', clinic)
      s.say('inbound', client)
      const o = await s.run()
      expect(['ambiguous', 'needs_info']).toContain(o.autoBook?.status)
      expect(s.appts()).toHaveLength(0)
    } finally {
      s.close()
    }
  })

  it('conflito na revalidação → não marca e avisa a cliente com alternativas', async () => {
    const s = seed()
    try {
      confirmAppointmentOp(
        s.db,
        s.caller,
        { clientRequestId: 'busy', serviceId: s.svc.id, professionalId: s.gi.id, startsAt: at(15), contactLabel: 'Outra', actorClerkUserId: 'user_synth_owner_a' },
        s.clock,
      )
      s.say('outbound', 'Confirma depilação masculina na quinta 29/10 às 15:00?')
      s.say('inbound', 'Sim')
      const o = await s.run()
      expect(['unavailable', 'conflict']).toContain(o.autoBook?.status)
      expect(s.appts()).toHaveLength(0)
      expect(o.suggestion!.suggestedText).toMatch(/não está mais livre/)
      expect(o.suggestion!.suggestedText).not.toMatch(/Agendei/)
    } finally {
      s.close()
    }
  })

  it('serviço com sinal → não marca; segue o fluxo de Pix pelo Agendar', async () => {
    const s = seed({ signal: true })
    try {
      s.say('outbound', 'Confirma depilação masculina na quinta 29/10 às 15:00?')
      s.say('inbound', 'Sim, pode marcar')
      const o = await s.run()
      expect(o.autoBook?.status).toBe('needs_signal')
      expect(s.appts()).toHaveLength(0)
      expect(o.suggestion!.suggestedText).toMatch(/sinal de R\$ 50,00 por Pix/)
      expect(o.suggestion!.internalNotes).toMatch(/Envie a cobrança Pix pelo Agendar/)
      expect(s.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM pix_charges`)!.n).toBe(0)
    } finally {
      s.close()
    }
  })

  it('a atendente cancela pelo fluxo normal', async () => {
    const s = seed()
    try {
      s.say('outbound', 'Confirma depilação masculina na quinta 29/10 às 14:00?')
      s.say('inbound', 'Sim')
      const o = await s.run()
      const r = cancelAppointmentOp(
        s.db,
        s.caller,
        { clientRequestId: 'c1', appointmentId: o.autoBook!.appointmentId!, reason: 'contato_desistiu', actorClerkUserId: 'user_synth_owner_a' },
        s.clock,
      )
      expect(r.value.status).toBe('cancelled')
    } finally {
      s.close()
    }
  })

  it('kill switch (AI_AUTOBOOK=off) não marca', async () => {
    const s = seed()
    try {
      s.say('outbound', 'Confirma depilação masculina na quinta 29/10 às 14:00?')
      s.say('inbound', 'Sim')
      const o = await s.run(false)
      expect(o.autoBook?.status).toBe('disabled')
      expect(s.appts()).toHaveLength(0)
    } finally {
      s.close()
    }
  })
})

describe('detectExplicitConfirmation', () => {
  const services = [
    { id: 's1', name: 'Depilação masculina', active: true },
    { id: 's2', name: 'Depilação feminina', active: true },
  ] as never
  const base = { clientToday: '2026-10-28', clinicToday: '2026-10-28', services }
  it('«1 hora» de duração não é horário', () => {
    const r = detectExplicitConfirmation({ ...base, clientTexts: ['Sim'], previousClinicText: 'Depilação masculina amanhã às 15:00, dura 1 hora.' })
    expect(r).toMatchObject({ ok: true, date: '2026-10-29', time: '15:00' })
  })
  it('remarcação nunca marca sozinha', () => {
    const r = detectExplicitConfirmation({ ...base, clientTexts: ['Quero remarcar para amanhã 15h depilação masculina'], previousClinicText: null })
    expect(r.ok).toBe(false)
  })
  it('«depilação» sozinha com dois serviços parecidos é ambígua', () => {
    const r = detectExplicitConfirmation({ ...base, clientTexts: ['Sim, amanhã às 15h'], previousClinicText: 'Tenho depilação masculina e depilação feminina.' })
    expect(r.ok).toBe(false)
  })
})
