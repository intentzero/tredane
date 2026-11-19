/**
 * #490 / M6b-2 — corpo real ao gateway no extrator e no redator (DEC-109, DEC-118, DEC-120).
 * Espelha CF-27 (`context-minimization.test.ts`): adaptador real + fetch simulado.
 * Paulo 03/11/2026: pergunta pendente do extrator pode levar rótulos HH:MM; freeSlots /
 * upcoming continuam barrados no redator e no wire.
 * Dados fictícios apenas.
 */
import { describe, expect, it } from 'vitest'
import {
  AiGatewayAnthropicAdapter,
  EXCEPTION_STABLE_SYSTEM,
  buildExceptionUserContent,
} from '../../ai'
import { createControllableClock } from '../../db/clock'
import { setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import { ensureClinicSettings, setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { workerCaller } from '../envelopes'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { ensureOpenOpportunity } from '../pipeline/operations'
import { confirmAppointmentOp, zonedCivilToUtc } from '../scheduling'
import { bootClinicDb } from '../test-db'
import { assertContextMinimized, buildAiContextPayload } from './context'
import { generateExceptionReply } from './exception-reply'

const TZ = 'America/Sao_Paulo'
/** Terça 27/10/2026 10:00 SP — janelas 09–18 geram >10 livres nos próximos 7 dias. */
const NOW = Date.UTC(2026, 9, 27, 13, 0)
const COLLOQUIAL = 'queria relaxar as costas amanhã'

type CapturedBody = {
  model?: string
  system?: unknown
  messages?: Array<{ role?: string; content?: string }>
  tools?: unknown
  max_tokens?: number
  context?: unknown
}

function systemText(system: unknown): string {
  if (typeof system === 'string') return system
  if (Array.isArray(system)) {
    return system
      .map((b) =>
        b && typeof b === 'object' && typeof (b as { text?: unknown }).text === 'string'
          ? (b as { text: string }).text
          : '',
      )
      .join('\n')
  }
  return String(system ?? '')
}

function seedClinicWithAgenda() {
  const clock = createControllableClock(NOW)
  const { db, close } = bootClinicDb({ clock })
  const tenantId = 'clinic-demo-a'
  const caller = workerCaller(tenantId, 'user_m6b2_gw')

  const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala 1', category: 'Sala' }, clock)
  const pro = upsertResourceOp(
    db,
    caller,
    { kind: 'professional', name: 'Ana Demo', homeRoomId: room.id },
    clock,
  )
  const svc = upsertServiceOp(
    db,
    caller,
    {
      name: 'Limpeza de pele',
      durationMinutes: 60,
      bufferMinutes: 0,
      priceCents: 18000,
      professionalIds: [pro.id],
      roomRequirement: { mode: 'none' },
    },
    clock,
  )
  const week = [1, 2, 3, 4, 5, 6].map((d) => ({
    dayOfWeek: d,
    startMinute: 9 * 60,
    endMinute: 18 * 60,
  }))
  setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: week }, clock)
  setWeeklyWindowsOp(db, caller, { resourceId: room.id, windows: week }, clock)
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  ensureClinicSettings(db, tenantId, clock)
  db.run(
    `UPDATE clinic_settings SET google_business_url = ?, updated_at = ? WHERE id = 1 AND tenant_id = ?`,
    'https://maps.app.goo.gl/clinica-teste',
    clock.nowMs(),
    tenantId,
  )

  // Outra cliente — nome/waId não podem ir ao wire da Carla.
  upsertContact(
    db,
    { tenantId, waId: '5511977776666', displayName: 'Bia OutraCliente' },
    clock,
  )

  const contact = upsertContact(
    db,
    { tenantId, waId: '5511988887777', displayName: 'Carla Demo' },
    clock,
  )
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  ensureOpenOpportunity(
    db,
    { tenantId, contactId: contact.id, conversationId: cnv.id },
    clock,
  )

  const upcomingStarts = zonedCivilToUtc(TZ, 2026, 10, 30, 15, 0)
  confirmAppointmentOp(
    db,
    caller,
    {
      clientRequestId: 'm6b2-upcoming',
      serviceId: svc.id,
      professionalId: pro.id,
      roomResourceId: null,
      startsAt: upcomingStarts,
      contactId: contact.id,
      conversationId: cnv.id,
      actorClerkUserId: caller.actorId!,
    },
    clock,
  )

  const msg = insertMessage(
    db,
    {
      tenantId,
      conversationId: cnv.id,
      direction: 'inbound',
      body: COLLOQUIAL,
      deliveryState: 'received',
      createdAt: NOW - 60_000,
    },
    clock,
  )

  return {
    db,
    close,
    clock,
    tenantId,
    caller,
    svc,
    contact,
    cnv,
    msg,
    otherPhone: '5511977776666',
    otherName: 'Bia OutraCliente',
    contactPhone: '5511988887777',
  }
}

async function assertAgendaSeeded(
  db: ReturnType<typeof bootClinicDb>['db'],
  tenantId: string,
  conversationId: string,
  clock: ReturnType<typeof createControllableClock>,
) {
  const built = await buildAiContextPayload(db, tenantId, conversationId, { clock })
  assertContextMinimized(built.payload)
  const payloadJson = JSON.stringify(built.payload)
  expect(payloadJson).not.toMatch(/"freeSlots"/)
  expect(payloadJson).not.toMatch(/"upcomingAppointments"/)
  expect(built.agendaFacts).not.toBeNull()
  const freeCount = built.agendaFacts!.freeSlots.reduce((n, d) => n + d.times.length, 0)
  expect(freeCount).toBeGreaterThan(10)
  expect(built.agendaFacts!.upcomingAppointments).toHaveLength(1)
  const upcomingWhen = built.agendaFacts!.upcomingAppointments[0]!.when
  expect(upcomingWhen).toMatch(/\d{1,2}:\d{2}/)
  expect(upcomingWhen).toMatch(/\d{2}\/\d{2}/)
  const leakedSlotTimes = built.agendaFacts!.freeSlots.flatMap((d) => d.times)
  expect(leakedSlotTimes.length).toBeGreaterThan(10)
  return { built, upcomingWhen, leakedSlotTimes }
}


function makeExceptionCapturingAdapter(bodies: CapturedBody[]) {
  return new AiGatewayAnthropicAdapter({
    accountId: 'acc',
    gatewayId: 'gw',
    gatewayToken: 'test-token',
    fetchImpl: (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)) as CapturedBody)
      return new Response(
        JSON.stringify({
          content: [{ type: 'text', text: '{"mensagem":"Combinado, a equipe confirma.","notas":""}' }],
          usage: { input_tokens: 80, output_tokens: 20 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof fetch,
  })
}

describe('M6b-2 gateway body (#490 / DEC-109 · 118 · 120)', () => {
  it('redator: freeSlots/upcoming semeados não vão ao wire; sem HH:MM fora de Agora/expediente; context ignorado', async () => {
    const seeded = seedClinicWithAgenda()
    const { db, close, clock, tenantId, caller, cnv, otherPhone, otherName, contactPhone } = seeded
    const clinicName = 'Clínica Gateway M6b2'
    try {
      const { upcomingWhen, leakedSlotTimes } = await assertAgendaSeeded(
        db,
        tenantId,
        cnv.id,
        clock,
      )
      // Mesmo clinicName que o redator usa em deps (senão o expected diverge).
      const built = await buildAiContextPayload(db, tenantId, cnv.id, {
        clock,
        clinicName,
      })

      const bodies: CapturedBody[] = []
      const adapter = makeExceptionCapturingAdapter(bodies)
      const result = await generateExceptionReply(db, caller, clock, {
        mode: 'gateway',
        adapter,
        clinicName,
      }, {
        conversationId: cnv.id,
        question: COLLOQUIAL,
      })
      expect(result.modelCalled).toBe(true)
      expect(bodies).toHaveLength(1)

      const body = bodies[0]!
      const wireJson = JSON.stringify(body)
      expect(body).not.toHaveProperty('context')
      expect(wireJson).not.toMatch(/"freeSlots"/)
      expect(wireJson).not.toMatch(/"upcomingAppointments"/)
      expect(wireJson).not.toContain(contactPhone)
      expect(wireJson).not.toContain(otherPhone)
      expect(wireJson).not.toContain(otherName)

      const sys = systemText(body.system)
      expect(sys).toBe(EXCEPTION_STABLE_SYSTEM)
      expect(sys).not.toContain('Formato de saída OBRIGATÓRIO')
      expect(sys).not.toContain('Você é a assistente de atendimento')

      const user = body.messages?.[0]?.content ?? ''
      const expectedUser = buildExceptionUserContent({
        context: built.payload,
        question: COLLOQUIAL,
      })
      expect(user).toBe(expectedUser)

      const scrubbed = `${sys}\n${user}`
        .split('\n')
        .filter((line) => !line.includes('Agora:') && !line.includes('Expediente:'))
        .join('\n')
      expect(scrubbed).not.toMatch(/\b\d{1,2}:\d{2}\b/)
      expect(scrubbed).not.toContain(upcomingWhen)
      expect(scrubbed).not.toMatch(/\b30\/10\b/)
      for (const t of leakedSlotTimes) {
        expect(scrubbed).not.toContain(t)
      }
    } finally {
      close()
    }
  })
})
