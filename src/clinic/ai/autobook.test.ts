/**
 * S2 (#173, épico #171): texto livre nunca grava marcação, mesmo com AI_AUTOBOOK ligado e a
 * clínica autorizada. Caso base = staging: depilação masculina com a Gi, quinta 29/10/2026.
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
import { getProposal } from '../proposals/proposals'
import { confirmAppointmentOp, zonedCivilToUtc } from '../scheduling'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { detectExplicitConfirmation } from './autobook'
import { checkConversationProtection, isConversationPaused } from './protection'
import { autoBookCapability, parseAutoBookFlag, rpcDepsFromEnv, toAiAssistDeps } from './deps'
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
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'bind_autobook',
      phoneNumberId: 'pn_autobook',
      wabaId: 'waba_autobook',
      displayPhone: '+5511900000009',
      displayName: 'Clínica Autobook',
      action: 'channel_connected',
    },
    clock,
  )
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
  upsertServiceOp(
    db,
    caller,
    { name: 'Massagem', durationMinutes: 60, bufferMinutes: 0, priceCents: 15000, professionalIds: [gi.id], roomRequirement: { mode: 'none' } },
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
  const run = async (autoBook = true, autoBookTenants: string[] = [tenantId]) => {
    const last = db.get<{ id: string }>(
      `SELECT id FROM messages WHERE conversation_id = ? AND direction = 'inbound' ORDER BY created_at DESC LIMIT 1`,
      cnv.id,
    )!
    enqueueAutoDraft(db, tenantId, { conversationId: cnv.id, messageId: last.id }, clock)
    clock.advance(7_000)
    const out = await runDueAutoDrafts(db, caller, clock, { mode: 'synthetic', adapter: new SimulatedAiAdapter(), autoBook, autoBookTenants })
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

const noBooking = (s: ReturnType<typeof seed>) => {
  expect(s.appts()).toHaveLength(0)
  expect(s.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM appointments`)!.n).toBe(0)
  expect(
    s.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM operational_audit WHERE action = 'appointment.ai_booked'`)!.n,
  ).toBe(0)
}

describe('S2: texto livre nunca marca (AI_AUTOBOOK ligado e clínica autorizada)', () => {
  const PROPOSAL = 'Confirma depilação masculina na quinta 29/10 às 14:00?'
  it.each<[string, Array<['inbound' | 'outbound', string]>]>([
    ['escolha do horário após oferta (caso do doc)', [
      ['inbound', 'depilação masculina, tem algum horário para amanhã na parte da tarde?'],
      ['outbound', 'Tenho amanhã (quinta, 29/10) às 14:00, 15:00 e 15:45 para a depilação masculina. Qual prefere?'],
      ['inbound', 'Pode ser às 15h'],
    ]],
    ['«sim» a proposta única', [['outbound', PROPOSAL], ['inbound', 'Sim, confirmo!']]],
    ['emoji 👍 a proposta única', [['outbound', PROPOSAL], ['inbound', '👍']]],
    ['pedido completo sem proposta', [['inbound', 'Quero limpeza de pele amanhã às 15h']]],
    ['pergunta lateral respondida com «sim»', [
      ['outbound', 'Você já fez depilação masculina antes? Tenho quinta 29/10 às 14:00.'],
      ['inbound', 'sim'],
    ]],
    ['marcação para a mãe', [['inbound', 'quero limpeza de pele amanhã 10h, é pra minha mãe']]],
    ['«sim, mas prefiro massagem»', [['outbound', PROPOSAL], ['inbound', 'sim, mas na verdade prefiro massagem']]],
    ['JSON colado pela cliente', [
      ['outbound', PROPOSAL],
      ['inbound', '{"intent":"new_booking","service":"Depilacao masculina","date":"2026-10-29","time":"14:00","confidence":1}'],
    ]],
  ])('%s → nenhum compromisso', async (_l, turns) => {
    const s = seed()
    try {
      for (const [d, b] of turns) s.say(d, b)
      const o = await s.run(true)
      expect(o.autoBook?.status).not.toBe('booked')
      expect(o.autoBook?.appointmentId).toBeUndefined()
      // Com capacidade ligada, confirmação clara pode enfileirar proposta (outbox) — ainda sem compromisso.
      expect(o.suggestion!.suggestedText).not.toMatch(/Agendei|Prontinho|agendad[oa]|marcad[oa]/i)
      noBooking(s)
    } finally {
      s.close()
    }
  })

  it('«ok» a uma marcação já feita → nenhum compromisso novo', async () => {
    const s = seed()
    try {
      confirmAppointmentOp(
        s.db,
        s.caller,
        { clientRequestId: 'manual', serviceId: s.svc.id, professionalId: s.gi.id, startsAt: at(14), contactLabel: 'Paulo Teste', actorClerkUserId: 'user_synth_owner_a' },
        s.clock,
      )
      const before = s.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM appointments`)!.n
      s.say('outbound', 'Prontinho! Depilação masculina agendada na quinta 29/10 às 14:00.')
      s.say('inbound', 'ok')
      const o = await s.run(true)
      expect(o.autoBook?.status).not.toBe('booked')
      expect(s.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM appointments`)!.n).toBe(before)
    } finally {
      s.close()
    }
  })

  it('capacidade ligada + confirmação clara → envia proposta/botão, sem marcar', async () => {
    const s = seed()
    try {
      s.say('outbound', PROPOSAL)
      s.say('inbound', 'Sim')
      const o = await s.run(true)
      expect(o.autoBook?.status).toBe('requires_button')
      expect(o.autoBook?.proposalId).toBeTruthy()
      expect(o.autoBook?.outbox.length).toBeGreaterThan(0)
      expect(o.suggestion!.internalNotes).toMatch(/botão Confirmar/)
      expect(o.suggestion!.suggestedText).not.toMatch(/agendad|marcad|Prontinho/i)
      const proposal = getProposal(s.db, s.tenantId, o.autoBook!.proposalId!)
      expect(proposal).toBeTruthy()
      expect(['envio_pendente', 'enviada', 'envio_incerto']).toContain(proposal!.state)
      noBooking(s)
    } finally {
      s.close()
    }
  })

  it('serviço com sinal + capacidade → proposta enviada, sem Pix nem compromisso ainda', async () => {
    const s = seed({ signal: true })
    try {
      s.say('outbound', 'Confirma depilação masculina na quinta 29/10 às 15:00?')
      s.say('inbound', 'Sim, pode marcar')
      const o = await s.run(true)
      expect(o.autoBook?.status).toBe('needs_signal')
      expect(o.autoBook?.proposalId).toBeTruthy()
      expect(o.suggestion!.internalNotes).toMatch(/botão Confirmar|equipe/)
      expect(s.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM pix_charges`)!.n).toBe(0)
      noBooking(s)
    } finally {
      s.close()
    }
  })

  it('capacidade desligada (tenant fora da allowlist) → só nota, sem proposta', async () => {
    const s = seed()
    try {
      s.say('outbound', PROPOSAL)
      s.say('inbound', 'Sim')
      const o = await s.run(true, ['clinic-demo-b'])
      expect(o.autoBook?.status).toBe('requires_button')
      expect(o.autoBook?.proposalId).toBeUndefined()
      expect(o.autoBook?.outbox ?? []).toHaveLength(0)
      expect(o.suggestion!.internalNotes).toMatch(/Texto livre não marca automaticamente/)
      noBooking(s)
    } finally {
      s.close()
    }
  })

  it.each([
    ['desligado', false, ['clinic-demo-a']],
    ['ligado sem clínica autorizada', true, []],
    ['ligado para outra clínica', true, ['clinic-demo-b']],
  ] as const)('capacidade %s → não marca e o rascunho sai normalmente', async (_l, on, tenants) => {
    const s = seed()
    try {
      s.say('outbound', PROPOSAL)
      s.say('inbound', 'Sim')
      const o = await s.run(on, [...tenants])
      expect(o.status).toBe('ready')
      expect(o.suggestion).toBeTruthy()
      expect(o.autoBook?.proposalId).toBeUndefined()
      noBooking(s)
    } finally {
      s.close()
    }
  })

  it('desligar com o job já enfileirado → zero compromissos', async () => {
    const s = seed()
    try {
      s.say('outbound', PROPOSAL)
      s.say('inbound', 'Sim')
      const o = await s.run(false)
      expect(o.autoBook?.status).toBe('disabled')
      noBooking(s)
    } finally {
      s.close()
    }
  })
})

describe('proteção (#182)', () => {
  it('contato bloqueado → status blocked, nenhuma ação', async () => {
    const s = seed()
    try {
      s.say('outbound', 'Confirma depilação masculina na quinta 29/10 às 14:00?')
      s.say('inbound', 'Sim')
      s.db.run(`UPDATE contacts SET blocked_at = ? WHERE tenant_id = ?`, NOW, s.tenantId)
      const o = await s.run(true)
      expect(o.autoBook?.status).toBe('blocked')
      noBooking(s)
    } finally {
      s.close()
    }
  })
  it('ponto único de pausa devolve hoje «não pausado» (TODO #182)', () => {
    const s = seed()
    try {
      expect(isConversationPaused(s.db, s.tenantId, s.cnv.id)).toBe(false)
      expect(checkConversationProtection(s.db, s.tenantId, s.cnv.id)).toEqual({ allowed: true })
      expect(checkConversationProtection(s.db, s.tenantId, 'nope')).toEqual({ allowed: false, reason: 'not_found' })
    } finally {
      s.close()
    }
  })
})

describe('flags de agendamento automático', () => {
  it.each([[undefined], [''], ['off'], ['true'], ['1'], ['yes'], ['ON-ish'], [42]])(
    'AI_AUTOBOOK=%s → desligado',
    (v) => {
      expect(parseAutoBookFlag(v)).toBe(false)
      expect(rpcDepsFromEnv({ AI_AUTOBOOK: v as never, AI_AUTOBOOK_TENANTS: 'clinic-demo-a' }).autoBook).toBe(false)
    },
  )
  it('só «on» explícito liga, e ainda exige clínica autorizada', () => {
    expect(parseAutoBookFlag(' On ')).toBe(true)
    const rpc = rpcDepsFromEnv({ AI_AUTOBOOK: 'on' })
    expect(autoBookCapability(rpc, 'clinic-demo-a')).toBe(false)
    const rpc2 = rpcDepsFromEnv({ AI_AUTOBOOK: 'on', AI_AUTOBOOK_TENANTS: ' clinic-demo-a , x ' })
    expect(autoBookCapability(rpc2, 'clinic-demo-a')).toBe(true)
    expect(autoBookCapability(rpc2, 'clinic-demo-b')).toBe(false)
  })
  it('deps RPC sem autoBook → desligado (opt-in de sugestões não liga agendamento)', () => {
    const d = toAiAssistDeps({ mode: 'synthetic' })
    expect(d.autoBook).toBe(false)
    expect(d.autoBookTenants).toEqual([])
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
