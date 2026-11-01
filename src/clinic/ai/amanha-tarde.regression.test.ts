/**
 * Regressão — caso real de staging (Paulo, 27/10/2026):
 * cliente pediu depilação masculina e depois «Amanhã na parte da tarde, tem algum horário?».
 * A sugestão ignorou a agenda («vou verificar»), perguntou de novo a faixa de horário e
 * veio com markdown («**Sugestão de resposta:**») e «Observações para a atendente» no texto.
 *
 * Exercita o caminho real: buildAiContextPayload → runGenerate → AiGatewayAnthropicAdapter
 * (fetch capturado) → parse da saída estruturada.
 */
import { describe, expect, it } from 'vitest'
import { AiGatewayAnthropicAdapter, SimulatedAiAdapter } from '../../ai'
import { createControllableClock } from '../../db/clock'
import { setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import { setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { confirmAppointmentOp, queryAvailability, zonedCivilToUtc } from '../scheduling'
import { bootClinicDb } from '../test-db'
import { enqueueAutoDraft, runDueAutoDrafts, suggestReplyOp } from './index'

const TZ = 'America/Sao_Paulo'
// Terça 27/10/2026 17:33 em São Paulo (UTC-3)
const NOW = Date.UTC(2026, 9, 27, 20, 33)

const BAD_OUTPUT = `**Sugestão de resposta:**

Oi, Paulo! 😊

Obrigada pelo retorno! Vou verificar a disponibilidade da agenda para amanhã à tarde e já te passo as opções de horário. Só um instante, por favor.

**Observações para a atendente:**
- Esta sugestão não consulta a agenda nem reserva nada.
- A depilação masculina dura 60 minutos.`

function seed() {
  const clock = createControllableClock(NOW)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-a'
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala 1', category: 'Sala' }, clock)
  const pro = upsertResourceOp(
    db,
    caller,
    { kind: 'professional', name: 'Ana', homeRoomId: room.id },
    clock,
  )
  const mk = (name: string) =>
    upsertServiceOp(
      db,
      caller,
      {
        name,
        durationMinutes: 60,
        bufferMinutes: 0,
        priceCents: 12000,
        professionalIds: [pro.id],
        roomRequirement: { mode: 'none' },
      },
      clock,
    )
  mk('Limpeza de pele')
  mk('Depilação feminina')
  const svc = mk('Depilação masculina')
  setWeeklyWindowsOp(
    db,
    caller,
    {
      resourceId: pro.id,
      windows: [1, 2, 3, 4, 5, 6].map((d) => ({
        dayOfWeek: d,
        startMinute: 9 * 60,
        endMinute: 18 * 60,
      })),
    },
    clock,
  )
  setWeeklyWindowsOp(
    db,
    caller,
    {
      resourceId: room.id,
      windows: [1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startMinute: 9 * 60, endMinute: 18 * 60 })),
    },
    clock,
  )
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  // Ocupa amanhã 14:00 — não pode ser oferecido.
  confirmAppointmentOp(
    db,
    caller,
    {
      clientRequestId: 'busy-1',
      serviceId: svc.id,
      professionalId: pro.id,
      roomResourceId: null,
      startsAt: zonedCivilToUtc(TZ, 2026, 10, 28, 14, 0),
      contactLabel: 'Outra cliente',
      actorClerkUserId: 'user_synth_owner_a',
    },
    clock,
  )
  const contact = upsertContact(db, { tenantId, waId: '5511900000001', displayName: 'Paulo Teste' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  const hist: Array<['inbound' | 'outbound', string]> = [
    ['inbound', 'Oi, quero agendar depilação masculina'],
    ['outbound', 'Oi, Paulo! Claro 😊 Qual dia fica melhor pra você?'],
    ['inbound', 'Amanhã na parte da tarde, tem algum horário?'],
  ]
  let t = NOW - 5 * 60_000
  for (const [direction, body] of hist) {
    insertMessage(
      db,
      {
        tenantId,
        conversationId: cnv.id,
        direction,
        body,
        deliveryState: direction === 'inbound' ? 'received' : 'delivered',
        createdAt: t,
      },
      clock,
    )
    t += 60_000
  }
  // Disponibilidade real de amanhã à tarde (fonte de verdade).
  const avail = queryAvailability(db, tenantId, { serviceId: svc.id, date: '2026-10-28' }, clock)
  const fmt = (ms: number) =>
    new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(ms)
  const freeAfternoon = new Set(
    avail.slots
      .map((s) => fmt(s.startsAt))
      .filter((h) => h >= '12:00' && h < '18:00'),
  )
  return { ...boot, clock, caller, cnv, freeAfternoon }
}

function captureGateway(reply: string) {
  const bodies: Array<{ system: string; messages: Array<{ content: string }>; model: string; temperature?: number }> = []
  const adapter = new AiGatewayAnthropicAdapter({
    accountId: 'acc',
    gatewayId: 'gw',
    gatewayToken: 'test-token',
    fetchImpl: (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)))
      return new Response(
        JSON.stringify({
          content: [{ type: 'text', text: reply }],
          usage: { input_tokens: 1500, output_tokens: 80 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof fetch,
  })
  return { adapter, bodies }
}

const input = (conversationId: string, id: string) => ({
  conversationId,
  clientRequestId: id,
  actorClerkUserId: 'user_synth_owner_a',
  actorDisplayName: 'Ana',
})

describe('regressão «Amanhã na parte da tarde» (staging 27/10/2026)', () => {
  it('DEC-118: pedido ao modelo leva histórico e clínica, SEM freeSlots/upcoming', async () => {
    const { db, clock, caller, cnv, close } = seed()
    try {
      const { adapter, bodies } = captureGateway('{"mensagem":"ok","notas":""}')
      const result = await suggestReplyOp(db, caller, input(cnv.id, 'r1'), clock, {
        mode: 'gateway',
        adapter,
      })
      expect(bodies).toHaveLength(1)
      const user = bodies[0]!.messages[0]!.content
      const system = bodies[0]!.system
      // Histórico completo, na ordem, com rótulos claros
      expect(user).toContain('[cliente] Oi, quero agendar depilação masculina')
      expect(user).toContain('[clínica] Oi, Paulo! Claro')
      expect(user).toContain('[cliente] Amanhã na parte da tarde, tem algum horário?')
      expect(user.indexOf('depilação masculina')).toBeLessThan(user.indexOf('Amanhã na parte'))
      expect(user).toMatch(/27\/10/)
      expect(user).toMatch(/Depilação masculina/)
      // DEC-118: sem lista de horários livres nem compromissos no pedido
      expect(user).not.toMatch(/Horários livres/)
      expect(user).not.toMatch(/amanhã, quarta-feira 28\/10/)
      expect(user).not.toMatch(/Próximos agendamentos/)
      expect(JSON.stringify(bodies[0])).not.toMatch(/"freeSlots"|"upcomingAppointments"/)
      expect(JSON.stringify(result.contextInspection.payload)).not.toMatch(
        /"freeSlots"|"upcomingAppointments"/,
      )
      expect(result.contextInspection.agendaFacts).not.toBeNull()
      // Regras: não inventar HH:MM; saída JSON; sem markdown
      expect(system).toMatch(/NUNCA ofereça|Nunca invente nem ofereça HH:MM|não recebe lista de horários/i)
      expect(system).toMatch(/"mensagem"/)
      expect(system).toMatch(/sem markdown/)
      expect(user).toMatch(/clínica JÁ enviou/)
      expect(user).toMatch(/NÃO comece com «Oi»/)
      expect(bodies[0]!.model).toBe('claude-haiku-5-5')
      expect(bodies[0]!.temperature).toBeUndefined()
    } finally {
      close()
    }
  })

  it('saída com markdown e «Observações para a atendente» → texto limpo + notas separadas', async () => {
    const { db, clock, caller, cnv, close } = seed()
    try {
      const { adapter } = captureGateway(BAD_OUTPUT)
      const r = await suggestReplyOp(db, caller, input(cnv.id, 'r2'), clock, { mode: 'gateway', adapter })
      expect(r.suggestion.suggestedText).not.toMatch(/\*\*|Sugestão de resposta|Observaç/)
      // Já houve outbound («Oi, Paulo! Claro…») → continuidade corta o re-cumprimento.
      expect(r.suggestion.suggestedText.startsWith('Oi')).toBe(false)
      expect(r.suggestion.suggestedText).toMatch(/Obrigada pelo retorno|disponibilidade|tarde/i)
      expect(r.suggestion.internalNotes).toMatch(/60 minutos/)
    } finally {
      close()
    }
  })

  it('saída estruturada JSON → mensagem a enviar e notas em campos separados', async () => {
    const { db, clock, caller, cnv, close } = seed()
    try {
      const { adapter } = captureGateway(
        '{"mensagem": "Claro, Paulo! Já verifico os horários da tarde pra você.", "notas": "Sistema oferece a lista."}',
      )
      const r = await suggestReplyOp(db, caller, input(cnv.id, 'r3'), clock, { mode: 'gateway', adapter })
      expect(r.suggestion.suggestedText).toBe(
        'Claro, Paulo! Já verifico os horários da tarde pra você.',
      )
      expect(r.suggestion.internalNotes).toBe('Sistema oferece a lista.')
    } finally {
      close()
    }
  })

  it('DEC-118: HH:MM inventada (23:00) é recusada pelo validador com factos locais', async () => {
    const { db, clock, caller, cnv, close } = seed()
    try {
      const { adapter } = captureGateway(
        '{"mensagem": "Amanhã à tarde tenho 23:00. Qual fica melhor?", "notas": ""}',
      )
      const r = await suggestReplyOp(db, caller, input(cnv.id, 'r3b'), clock, { mode: 'gateway', adapter })
      expect(r.suggestion.status).toBe('failed')
      expect(r.suggestion.suggestedText).toBe('')
      expect(r.suggestion.warningCodes).toContain('output_rejected')
    } finally {
      close()
    }
  })

  it('simulado DEC-118: o modelo/sintético não inventa HH:MM no rascunho manual', async () => {
    const { db, clock, caller, cnv, close } = seed()
    try {
      const r = await suggestReplyOp(db, caller, input(cnv.id, 'r4'), clock, {
        mode: 'synthetic',
        adapter: new SimulatedAiAdapter(),
      })
      const text = r.suggestion.suggestedText
      // Oferta de horários reais fica no caminho determinístico (autobook / L1 A-02);
      // aqui o adaptador sintético e o prompt já não listam freeSlots.
      expect(text).not.toMatch(/\b\d{1,2}:\d{2}\b/)
      expect(text).not.toMatch(/\*\*|vou verificar a disponibilidade da agenda/i)
      const insp = JSON.stringify(r.gatewayInspection)
      expect(insp).not.toMatch(/"freeSlots"|"upcomingAppointments"|Horários livres/)
    } finally {
      close()
    }
  })

  it('auto-rascunho: espera o debounce adaptativo, gera 1 rascunho e respeita o limite diário', async () => {
    const { db, clock, close, caller, cnv } = seed()
    try {
      const last = db.get<{ id: string }>(
        `SELECT id FROM messages WHERE conversation_id = ? AND direction = 'inbound' ORDER BY created_at DESC LIMIT 1`,
        cnv.id,
      )!
      const deps = { mode: 'synthetic' as const, adapter: new SimulatedAiAdapter() }
      const job = enqueueAutoDraft(db, caller.tenantId, { conversationId: cnv.id, messageId: last.id }, clock)
      expect(job).not.toBeNull()
      // Pedido com dia+período → DEC-111 usa 2,5 s (não 7 s).
      expect(job!.dueAt - job!.createdAt).toBe(2_500)
      expect(await runDueAutoDrafts(db, caller, clock, deps)).toHaveLength(0)
      clock.advance(2_500)
      const out = await runDueAutoDrafts(db, caller, clock, deps)
      expect(out.map((o) => o.status)).toEqual(['ready'])
      expect(out[0]!.suggestion!.origin).toBe('auto')
      expect(out[0]!.suggestion!.suggestedText).not.toMatch(/\*\*/)

      // Limite: 300/dia por clínica → não gera mais.
      // Com CA-03 o 1.º turno pode ser só determinístico (sem linha em ai_daily_usage).
      db.run(
        `INSERT INTO ai_daily_usage (tenant_id, day, drafts) VALUES (?, '2026-10-27', 300)
         ON CONFLICT (tenant_id, day) DO UPDATE SET drafts = 300`,
        caller.tenantId,
      )
      enqueueAutoDraft(db, caller.tenantId, { conversationId: cnv.id, messageId: last.id }, clock)
      clock.advance(2_500)
      const capped = await runDueAutoDrafts(db, caller, clock, deps)
      expect(capped.map((o) => o.status)).toEqual(['cap_reached'])
    } finally {
      close()
    }
  })
})
