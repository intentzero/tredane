/**
 * S2 (#173, épico #171): texto livre nunca grava marcação, com a proposta ligada e a
 * clínica sem pausa. Caso base = staging: depilação masculina com a Gi, quinta 29/10/2026.
 */
import { describe, expect, it } from 'vitest'
import { SimulatedAiAdapter } from '../../ai'
import { createControllableClock } from '../../db/clock'
import { replaceServiceZonesOp, setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import { readZoneSnapshots } from '../config/zones'
import { setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { getProposal } from '../proposals/proposals'
import { confirmAppointmentOp, zonedCivilToUtc } from '../scheduling'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { askZonesReply, detectExplicitConfirmation, extractTimes } from './autobook'
import { getScheduleSession } from './schedule-session'
import { checkConversationProtection, isConversationPaused } from './protection'
import { autoBookCapability, toAiAssistDeps } from './deps'
import { enqueueAutoDraft, runDueAutoDrafts } from './index'
import { clearScheduleSession, saveScheduleSession } from './schedule-session'

const TZ = 'America/Sao_Paulo'
// Quarta 28/10/2026 15:51 em São Paulo.
const NOW = Date.UTC(2026, 9, 28, 18, 51)

function seed(opts: { signal?: boolean } = {}) {
  // Relógio começa 10 min antes de NOW para as mensagens do funil ficarem ≤ nowMs na corrida.
  const clock = createControllableClock(NOW - 10 * 60_000)
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
  const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala depilação', category: 'Sala' }, clock)
  const gi = upsertResourceOp(
    db,
    caller,
    { kind: 'professional', name: 'Gi', homeRoomId: room.id },
    clock,
  )
  const svc = upsertServiceOp(
    db,
    caller,
    {
      name: 'Depilacao masculina',
      durationMinutes: 60,
      bufferMinutes: 15,
      priceCents: 20000,
      variantKind: 'Zona',
      variantKindPlural: 'Zonas',
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
  const say = (direction: 'inbound' | 'outbound', body: string) => {
    const m = insertMessage(
      db,
      {
        tenantId,
        conversationId: cnv.id,
        direction,
        body,
        deliveryState: direction === 'inbound' ? 'received' : 'delivered',
        createdAt: clock.nowMs(),
      },
      clock,
    )
    clock.advance(60_000)
    return m
  }
  /** Abre o funil de agendamento (DEC-090 / DEC-086): histórico de zonas/linha só conta depois. */
  const openFunnel = (serviceId: string, audienceLine: 'feminino' | 'masculino' | null = null) => {
    saveScheduleSession(db, tenantId, cnv.id, { serviceId, audienceLine }, clock)
  }
  const run = async (paused = false) => {
    const last = db.get<{ id: string }>(
      `SELECT id FROM messages WHERE conversation_id = ? AND direction = 'inbound' ORDER BY created_at DESC LIMIT 1`,
      cnv.id,
    )!
    enqueueAutoDraft(db, tenantId, { conversationId: cnv.id, messageId: last.id }, clock)
    clock.advance(7_000)
    const out = await runDueAutoDrafts(db, caller, clock, {
      mode: 'synthetic',
      adapter: new SimulatedAiAdapter(),
      autoBookPaused: paused,
    })
    expect(out).toHaveLength(1)
    return out[0]!
  }
  const appts = () =>
    db.all<{ id: string; starts_at: number; confirmed_by: string; status: string }>(
      `SELECT id, starts_at, confirmed_by, status FROM appointments WHERE tenant_id = ? AND contact_id = ?`,
      tenantId,
      contact.id,
    )
  return { ...boot, clock, caller, tenantId, gi, svc, cnv, say, run, appts, openFunnel }
}

const at = (h: number, m = 0) => zonedCivilToUtc(TZ, 2026, 10, 29, h, m)

const noBooking = (s: ReturnType<typeof seed>) => {
  expect(s.appts()).toHaveLength(0)
  expect(s.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM appointments`)!.n).toBe(0)
  expect(
    s.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM operational_audit WHERE action = 'appointment.ai_booked'`)!.n,
  ).toBe(0)
}

describe('S2: texto livre nunca marca (proposta ligada, clínica sem pausa)', () => {
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
    ['«sim, mas prefiro massagem»', [['outbound', PROPOSAL], ['inbound', 'sim, mas na verdade prefiro massagem']]],
  ])('%s → nenhum compromisso', async (_l, turns) => {
    const s = seed()
    try {
      for (const [d, b] of turns) s.say(d, b)
      const o = await s.run()
      expect(o.autoBook?.status).not.toBe('booked')
      expect(o.autoBook?.appointmentId).toBeUndefined()
      // Com capacidade ligada, confirmação clara pode enfileirar proposta (outbox) — ainda sem compromisso.
      expect(o.suggestion!.suggestedText).not.toMatch(/Agendei|Prontinho|agendad[oa]|marcad[oa]/i)
      noBooking(s)
    } finally {
      s.close()
    }
  })

  it.each([
    ['marcação para a mãe', 'quero limpeza de pele amanhã 10h, é pra minha mãe'],
    ['JSON colado pela cliente', '{"intent":"new_booking","service":"Depilacao masculina","date":"2026-10-29","time":"14:00","confidence":1}'],
  ])('%s → pausa a IA, sem compromisso e sem modelo', async (_l, body) => {
    const s = seed()
    try {
      s.say('inbound', body)
      const o = await s.run()
      expect(o.status).toBe('skipped')
      expect(o.reason).toBe('human_handoff')
      expect(o.suggestion).toBeNull()
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
      const o = await s.run()
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
      const o = await s.run()
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
      const o = await s.run()
      expect(o.autoBook?.status).toBe('needs_signal')
      expect(o.autoBook?.proposalId).toBeTruthy()
      expect(o.suggestion!.internalNotes).toMatch(/botão Confirmar|equipe/)
      expect(s.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM pix_charges`)!.n).toBe(0)
      noBooking(s)
    } finally {
      s.close()
    }
  })

  it('«1530» com dia e serviço já ditos envia a proposta, sem pergunta Confirma', async () => {
    const s = seed()
    try {
      s.say('inbound', 'quero depilação masculina na quinta')
      s.say('outbound', 'Tenho quinta 29/10 às 14:00, 15:30 e 16:00. Qual prefere?')
      s.say('inbound', '1530')
      const o = await s.run()
      expect(o.autoBook?.status).toBe('requires_button')
      expect(o.autoBook?.proposalId).toBeTruthy()
      expect(o.suggestion!.suggestedText.trim()).toBe('')
      expect(o.replyOutbox ?? []).toHaveLength(0)
      noBooking(s)
    } finally {
      s.close()
    }
  })

  it('«Tudo, pode ser às 14?» escolhe todas as zonas e envia a proposta (não silencia)', async () => {
    const s = seed()
    try {
      const dep = upsertServiceOp(
        s.db,
        s.caller,
        {
          name: 'Depilacao',
          durationMinutes: 60,
          bufferMinutes: 15,
          priceCents: 18_000,
          variantKind: 'regiao',
          variantKindPlural: 'regioes',
          professionalIds: [s.gi.id],
          roomRequirement: { mode: 'none' },
        },
        s.clock,
      )
      replaceServiceZonesOp(
        s.db,
        s.caller,
        dep.id,
        [
          { name: 'Axila', durationMinutes: 30, priceCents: 5_000, audience: 'ambos' },
          { name: 'Peitoral', durationMinutes: 30, priceCents: 7_000, audience: 'ambos' },
          { name: 'Barriga', durationMinutes: 30, priceCents: 7_000, audience: 'ambos' },
        ],
        s.clock,
      )
      s.say('outbound', 'Oi! Quer agendar depilação?')
      s.say('inbound', 'Sim, tem vaga para amanhã à tarde?')
      s.openFunnel(dep.id)
      s.say(
        'outbound',
        'Tenho amanhã (quinta, 29/10) às 14:00, 15:00 e 16:00 para depilação. Quer região axila OU peitoral e barriga?',
      )
      s.say('inbound', 'Tudo, pode ser às 14?')
      const o = await s.run()
      expect(o.autoBook?.status).toBe('requires_button')
      expect(o.autoBook?.proposalId).toBeTruthy()
      expect(o.autoBook?.time).toBe('14:00')
      expect(o.autoBook?.date).toBe('2026-10-29')
      expect(o.suggestion!.suggestedText.trim()).toBe('')
      expect(o.replyOutbox ?? []).toHaveLength(0)
      const snaps = readZoneSnapshots(s.db, s.tenantId, 'proposal', o.autoBook!.proposalId!)
      expect(snaps.map((z) => z.name).sort()).toEqual(['Axila', 'Barriga', 'Peitoral'])
      noBooking(s)
    } finally {
      s.close()
    }
  })

  it('horário claro sem zona → pergunta determinística das variantes (não silencia)', async () => {
    const s = seed()
    try {
      const dep = upsertServiceOp(
        s.db,
        s.caller,
        {
          name: 'Depilacao',
          durationMinutes: 60,
          bufferMinutes: 15,
          priceCents: 18_000,
          variantKind: 'regiao',
          variantKindPlural: 'regioes',
          professionalIds: [s.gi.id],
          roomRequirement: { mode: 'none' },
        },
        s.clock,
      )
      replaceServiceZonesOp(
        s.db,
        s.caller,
        dep.id,
        [
          { name: 'Axila', durationMinutes: 30, priceCents: 5_000, audience: 'ambos' },
          { name: 'Peitoral', durationMinutes: 30, priceCents: 7_000, audience: 'ambos' },
        ],
        s.clock,
      )
      s.say('outbound', 'Tenho amanhã (quinta, 29/10) às 14:00 e 15:00 para depilação. Qual prefere?')
      s.say('inbound', 'Pode ser às 14')
      const o = await s.run()
      expect(o.autoBook?.status).toBe('needs_info')
      expect(o.autoBook?.proposalId).toBeUndefined()
      expect(o.autoBook?.replyText).toMatch(/as regioes/i)
      expect(o.autoBook?.replyText).not.toMatch(/\ba regioes\b/i)
      expect(o.replyOutbox?.length).toBeGreaterThan(0)
      const sent = s.db.get<{ body: string }>(
        `SELECT body FROM messages WHERE tenant_id = ? AND conversation_id = ? AND direction = 'outbound' ORDER BY created_at DESC LIMIT 1`,
        s.tenantId,
        s.cnv.id,
      )
      expect(sent!.body).toMatch(/Axila/)
      expect(sent!.body).not.toMatch(/R\$|a partir de/i)
      noBooking(s)
    } finally {
      s.close()
    }
  })

  it('detectExplicitConfirmation: «?» após escolha de horário não é ambíguo', () => {
    const services = [
      {
        id: 's',
        tenantId: 't',
        name: 'Depilacao',
        active: true,
        durationMinutes: 60,
        bufferMinutes: 15,
        priceCents: 18_000,
        zones: [],
        variantKind: 'regiao',
        variantKindPlural: 'regioes',
        combos: [],
        requiresSignal: false,
        signalKind: null,
        signalFixedCents: null,
        signalPercent: null,
        professionalIds: [],
        roomRequirement: { mode: 'none' as const },
        equipmentResourceId: null,
        audiencia: 'qualquer' as const,
        clientExplanation: null,
        createdAt: 0,
        updatedAt: 0,
        tempoCeu: 'tanto_faz' as const,
        tempoTemperatura: 'tanto_faz' as const,
        tempoCelsius: null,
        durationAdjustable: false,
        durationMinMinutes: null,
        durationMaxMinutes: null,
        weeklyWindows: [],
        deletable: true,
      },
    ]
    const det = detectExplicitConfirmation({
      clientTexts: ['Tudo, pode ser às 14?'],
      previousClinicText: 'Tenho hoje às 14:00, 15:00 e 16:00 para depilação.',
      historyTexts: [],
      clientToday: '2026-10-30',
      clinicToday: '2026-10-30',
      services,
    })
    expect(det.ok).toBe(true)
    expect(det.time).toBe('14:00')
    expect(det.date).toBe('2026-10-30')
  })

  it('«as 13» com a zona já dita envia a proposta e não repete o preço', async () => {
    const s = seed()
    try {
      const dep = upsertServiceOp(
        s.db,
        s.caller,
        {
          name: 'Depilacao',
          durationMinutes: 60,
          bufferMinutes: 15,
          priceCents: 18_000,
          variantKind: 'Zona',
          variantKindPlural: 'Zonas',
          professionalIds: [s.gi.id],
          roomRequirement: { mode: 'none' },
        },
        s.clock,
      )
      replaceServiceZonesOp(
        s.db,
        s.caller,
        dep.id,
        [
          { name: 'Axila', durationMinutes: 30, priceCents: 5_000, audience: 'ambos' },
          { name: 'Peitoral', durationMinutes: 30, priceCents: 7_000, audience: 'ambos' },
          { name: 'Barriga', durationMinutes: 30, priceCents: 7_000, audience: 'ambos' },
        ],
        s.clock,
      )
      s.say('inbound', 'Quero agendar uma depilação')
      s.say('outbound', 'Quais zonas você quer depilar? Temos axila, peitoral e barriga.')
      s.openFunnel(dep.id)
      s.say('inbound', 'Axila')
      s.say(
        'outbound',
        'A depilação de axila custa R$ 50,00. Amanhã tenho 13:00, 14:00 ou 15:30. Qual fica melhor pra você?',
      )
      s.say('inbound', 'Amanha as 13')
      const o = await s.run()
      expect(o.autoBook?.status).toBe('requires_button')
      expect(o.autoBook?.proposalId).toBeTruthy()
      expect(o.suggestion!.suggestedText.trim()).toBe('')
      expect(o.replyOutbox ?? []).toHaveLength(0)
      const snaps = readZoneSnapshots(s.db, s.tenantId, 'proposal', o.autoBook!.proposalId!)
      expect(snaps.map((z) => z.name)).toEqual(['Axila'])
      noBooking(s)
    } finally {
      s.close()
    }
  })

  it('duas Axila do mesmo género não viram uma proposta só com o nome', async () => {
    const s = seed()
    try {
      const dep = upsertServiceOp(
        s.db,
        s.caller,
        {
          name: 'Depilacao',
          durationMinutes: 60,
          bufferMinutes: 15,
          priceCents: 18_000,
          variantKind: 'Zona',
          variantKindPlural: 'Zonas',
          professionalIds: [s.gi.id],
          roomRequirement: { mode: 'none' },
        },
        s.clock,
      )
      replaceServiceZonesOp(
        s.db,
        s.caller,
        dep.id,
        [
          { name: 'Axila', durationMinutes: 15, priceCents: 5_000, audience: 'masculino' },
          { name: 'Axila', durationMinutes: 30, priceCents: 8_000, audience: 'masculino' },
        ],
        s.clock,
      )
      s.say('outbound', 'Confirma depilacao na quinta 29/10 às 14:00?')
      s.say('inbound', 'Sim, axila')
      const o = await s.run()
      expect(o.autoBook?.proposalId).toBeUndefined()
      expect(o.autoBook?.status).toBe('needs_info')
      expect(o.autoBook?.replyText).toMatch(/Axila \(masculino, 15 min\)/)
      expect(o.autoBook?.replyText).toMatch(/Axila \(masculino, 30 min\)/)
      noBooking(s)
    } finally {
      s.close()
    }
  })

  it('zonas todas inativas avisam a cliente (não silencia o WhatsApp)', async () => {
    const s = seed()
    try {
      replaceServiceZonesOp(
        s.db,
        s.caller,
        s.svc.id,
        [{ name: 'Axila', durationMinutes: 30, priceCents: 5_000, active: false, audience: 'ambos' }],
        s.clock,
      )
      s.say('outbound', 'Confirma depilacao masculina na quinta 29/10 às 14:00?')
      s.say('inbound', 'Sim')
      const o = await s.run()
      expect(o.autoBook?.proposalId).toBeUndefined()
      expect(o.autoBook?.status).toBe('needs_info')
      expect(o.suggestion!.internalNotes).toMatch(/inativas|calcular/i)
      expect(o.autoBook?.replyText?.trim().length).toBeGreaterThan(0)
      expect(o.replyOutbox?.length).toBeGreaterThan(0)
      noBooking(s)
    } finally {
      s.close()
    }
  })

  it('texto da IA sai sem clique quando não há proposta', async () => {
    const s = seed()
    try {
      s.say('inbound', 'Oi, quanto custa a depilação masculina?')
      const o = await s.run()
      expect(o.autoBook?.proposalId).toBeUndefined()
      expect(o.replyOutbox?.length).toBeGreaterThan(0)
      expect(o.suggestion!.status).toBe('used')
      const sent = s.db.get<{ body: string }>(
        `SELECT body FROM messages WHERE tenant_id = ? AND conversation_id = ? AND direction = 'outbound' ORDER BY created_at DESC LIMIT 1`,
        s.tenantId,
        s.cnv.id,
      )
      expect(sent!.body.trim().length).toBeGreaterThan(0)
      noBooking(s)
    } finally {
      s.close()
    }
  })

  it('pausa da owner → aviso à cliente, sem proposta', async () => {
    const s = seed()
    try {
      s.say('outbound', PROPOSAL)
      s.say('inbound', 'Sim')
      const o = await s.run(true)
      expect(o.status).toBe('ready')
      expect(o.autoBook?.status).toBe('requires_button')
      expect(o.autoBook?.proposalId).toBeUndefined()
      expect(o.autoBook?.outbox ?? []).toHaveLength(0)
      expect(o.autoBook?.replyText).toMatch(/equipe confirma/i)
      expect(o.replyOutbox?.length).toBeGreaterThan(0)
      expect(o.suggestion!.internalNotes).toMatch(/Capacidade pausada|Agendar/)
      noBooking(s)
    } finally {
      s.close()
    }
  })

  it('horário pedido sem vaga → oferece alternativas em vez de silenciar', async () => {
    const s = seed()
    try {
      // Ocupa 14:00 com outro contato; deixa outros horários livres.
      const other = upsertContact(
        s.db,
        { tenantId: s.tenantId, waId: '5511900000099', displayName: 'Outra' },
        s.clock,
      )
      confirmAppointmentOp(
        s.db,
        s.caller,
        {
          contactId: other.id,
          serviceId: s.svc.id,
          professionalId: s.gi.id,
          startsAt: at(14),
          actorClerkUserId: s.caller.actorId!,
          clientRequestId: 'hold-14',
        },
        s.clock,
      )
      s.say('outbound', 'Confirma depilação masculina na quinta 29/10 às 14:00?')
      s.say('inbound', 'Sim')
      const o = await s.run()
      expect(o.autoBook?.proposalId).toBeUndefined()
      expect(o.autoBook?.replyText).toMatch(/já não tenho vaga|14/i)
      expect(o.replyOutbox?.length).toBeGreaterThan(0)
      expect(s.appts()).toHaveLength(0)
      expect(
        s.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM operational_audit WHERE action = 'appointment.ai_booked'`)!.n,
      ).toBe(0)
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
      const o = await s.run()
      expect(o.autoBook?.status).toBe('blocked')
      noBooking(s)
    } finally {
      s.close()
    }
  })
  it('pausa da resposta automática nega ação nova (DEC-083)', () => {
    const s = seed()
    try {
      expect(isConversationPaused(s.db, s.tenantId, s.cnv.id)).toBe(false)
      expect(checkConversationProtection(s.db, s.tenantId, s.cnv.id)).toEqual({ allowed: true })
      s.db.run(`UPDATE conversations SET ai_reply_paused_at = ? WHERE id = ?`, NOW, s.cnv.id)
      expect(isConversationPaused(s.db, s.tenantId, s.cnv.id)).toBe(true)
      expect(checkConversationProtection(s.db, s.tenantId, s.cnv.id)).toEqual({
        allowed: false,
        reason: 'conversation_paused',
      })
      expect(checkConversationProtection(s.db, s.tenantId, 'nope')).toEqual({ allowed: false, reason: 'not_found' })
    } finally {
      s.close()
    }
  })
})

describe('capacidade de proposta', () => {
  it('está sempre ligada; a pausa é da clínica', () => {
    expect(autoBookCapability()).toBe(true)
    expect(toAiAssistDeps({ mode: 'synthetic' }).autoBookPaused).toBe(false)
    expect(toAiAssistDeps({ mode: 'synthetic', autoBookPaused: true }).autoBookPaused).toBe(true)
  })
})

describe('detectExplicitConfirmation', () => {
  const services = [
    { id: 's1', name: 'Depilação masculina', active: true },
    { id: 's2', name: 'Depilação feminina', active: true },
  ] as never
  const base = { clientToday: '2026-10-28', clinicToday: '2026-10-28', services }
  it('«1530» é 15:30 e não lê o ano de uma data', () => {
    expect(extractTimes('1530')).toEqual(new Set(['15:30']))
    expect(extractTimes('Hoje as 13')).toEqual(new Set(['13:00']))
    expect(extractTimes('sexta 30/10/2026')).not.toContain('20:26')
  })
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

describe('pergunta das variantes usa o plural do tipo', () => {
  it('«as zonas», não «a Zona»', () => {
    const reply = askZonesReply('as zonas', ['Axila', 'Buço'], '14:00')
    expect(reply).toBe('Para fechar às 14:00, me diga as zonas: Axila, Buço. Pode ser mais de uma.')
  })

  it('lembra a variante e o horário e escreve o plural em minúsculas', async () => {
    const s = seed()
    try {
      const dep = upsertServiceOp(
        s.db,
        s.caller,
        {
          name: 'Bronzeamento',
          durationMinutes: 60,
          bufferMinutes: 15,
          priceCents: 15_000,
          variantKind: 'Região',
          variantKindPlural: 'Regiões',
          professionalIds: [s.gi.id],
          roomRequirement: { mode: 'none' },
        },
        s.clock,
      )
      replaceServiceZonesOp(
        s.db,
        s.caller,
        dep.id,
        [
          { name: 'Axila', durationMinutes: 30, priceCents: 5_000, audience: 'ambos' },
          { name: 'Perna', durationMinutes: 30, priceCents: 8_000, audience: 'ambos' },
        ],
        s.clock,
      )
      s.say('inbound', 'Quero bronzeamento amanhã às 14:00')
      const asked = await s.run()
      const question = asked.suggestion?.suggestedText ?? ''
      expect(question.toLocaleLowerCase('pt-BR')).toContain('as regiões')
      expect(question).not.toContain('as Regiões')

      insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: 'Só a axila',
          deliveryState: 'received',
          createdAt: s.clock.nowMs() + 1_000,
        },
        s.clock,
      )
      const booked = await s.run()
      expect(booked.autoBook?.status).toBe('requires_button')
      expect(booked.autoBook?.replyText ?? '').not.toMatch(/regiões/i)
      const session = getScheduleSession(s.db, s.tenantId, s.cnv.id)
      expect(session?.clockTime).toBe('14:00')
      expect(session?.variantIds?.length).toBe(1)
    } finally {
      s.close()
    }
  })
})

describe('DEC-090: não reperguntar linha/zonas após horário (Paulo 31/10/2026)', () => {
  it('«As 14» com Masculina + Todas já ditos envia proposta sem reperguntar', async () => {
    const s = seed()
    try {
      const dep = upsertServiceOp(
        s.db,
        s.caller,
        {
          name: 'Depilacao',
          durationMinutes: 60,
          bufferMinutes: 15,
          priceCents: 19_000,
          variantKind: 'Zona',
          variantKindPlural: 'Zonas',
          professionalIds: [s.gi.id],
          roomRequirement: { mode: 'none' },
        },
        s.clock,
      )
      replaceServiceZonesOp(
        s.db,
        s.caller,
        dep.id,
        [
          { name: 'Axila', durationMinutes: 15, priceCents: 5_000, audience: 'masculino' },
          { name: 'Pernas', durationMinutes: 30, priceCents: 14_000, audience: 'masculino' },
          { name: 'Axila', durationMinutes: 15, priceCents: 4_000, audience: 'feminino' },
          { name: 'Pernas', durationMinutes: 30, priceCents: 12_000, audience: 'feminino' },
        ],
        s.clock,
      )
      s.say('inbound', 'Quero agendar uma depilação')
      s.say('outbound', 'Claro! A depilação tem opções feminina e masculina. Qual você quer fazer?')
      s.openFunnel(dep.id)
      s.say('inbound', 'Masculina')
      s.openFunnel(dep.id, 'masculino')
      s.say('outbound', 'Perfeito! Na depilação masculina temos axila ou pernas. Qual zona você quer, ou as duas?')
      s.say('inbound', 'Todas')
      s.say(
        'outbound',
        'Tenho amanhã (quinta, 29/10) às 09:00, 10:00 ou 14:00 para a depilação de pernas e axila. Algum desses fica bom pra você?',
      )
      s.say('inbound', 'As 14')
      const o = await s.run()
      expect(o.autoBook?.status).toBe('requires_button')
      expect(o.autoBook?.proposalId).toBeTruthy()
      expect(o.autoBook?.time).toBe('14:00')
      expect(o.autoBook?.date).toBe('2026-10-29')
      expect(o.autoBook?.replyText ?? '').not.toMatch(/feminina ou masculina/i)
      expect(o.autoBook?.replyText ?? '').not.toMatch(/qual zona/i)
      expect(o.suggestion!.suggestedText.trim()).toBe('')
      const snaps = readZoneSnapshots(s.db, s.tenantId, 'proposal', o.autoBook!.proposalId!)
      expect(snaps.map((z) => z.name).sort()).toEqual(['Axila', 'Pernas'])
      expect(snaps.every((z) => z.audience === 'masculino')).toBe(true)
      const body = getProposal(s.db, s.tenantId, o.autoBook!.proposalId!)
      // Proposta (confirmação) pode ter preço; oferta de slots a meio do funil é que não.
      expect(body?.priceCents).toBe(19_000)
      noBooking(s)
    } finally {
      s.close()
    }
  })

  it('após limpar a sessão (DEC-086) não reusa Masculina/Todas do funil anterior', async () => {
    const s = seed()
    try {
      const dep = upsertServiceOp(
        s.db,
        s.caller,
        {
          name: 'Depilacao',
          durationMinutes: 60,
          bufferMinutes: 15,
          priceCents: 19_000,
          variantKind: 'Zona',
          variantKindPlural: 'Zonas',
          professionalIds: [s.gi.id],
          roomRequirement: { mode: 'none' },
        },
        s.clock,
      )
      replaceServiceZonesOp(
        s.db,
        s.caller,
        dep.id,
        [
          { name: 'Axila', durationMinutes: 15, priceCents: 5_000, audience: 'masculino' },
          { name: 'Pernas', durationMinutes: 30, priceCents: 14_000, audience: 'masculino' },
          { name: 'Axila', durationMinutes: 15, priceCents: 4_000, audience: 'feminino' },
          { name: 'Pernas', durationMinutes: 30, priceCents: 12_000, audience: 'feminino' },
        ],
        s.clock,
      )
      s.say('inbound', 'Masculina')
      s.say('outbound', 'Qual zona?')
      s.say('inbound', 'Todas')
      s.say('outbound', 'Agendado. Quer agendar outro serviço?')
      s.say('inbound', 'Quero agendar outro serviço')
      clearScheduleSession(s.db, s.tenantId, s.cnv.id)
      s.say(
        'outbound',
        'Tenho amanhã (quinta, 29/10) às 09:00, 10:00 ou 14:00 para a depilação. Qual fica melhor?',
      )
      s.say('inbound', 'As 14')
      const o = await s.run()
      expect(o.autoBook?.proposalId).toBeUndefined()
      expect(o.autoBook?.status).toBe('needs_info')
      expect(o.autoBook?.replyText).toMatch(/feminina ou masculina/i)
      noBooking(s)
    } finally {
      s.close()
    }
  })
})
