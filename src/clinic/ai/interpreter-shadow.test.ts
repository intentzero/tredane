/**
 * Sombra do interpretador LLM: mede sem alterar o atendimento e sem texto no log.
 * Dados fictícios.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  SimulatedAiAdapter,
  type AiGenerateInput,
  type AiGenerateResult,
} from '../../ai'
import { createControllableClock } from '../../db/clock'
import { setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import { listServices } from '../config/services'
import { setClinicAiAssistEnabled } from '../config/settings'
import type { ServiceRow } from '../config/types'
import { upsertContact } from '../contacts'
import { workerCaller } from '../envelopes'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { enqueueAutoDraft, runDueAutoDrafts } from './autodraft'
import { rpcDepsFromEnv } from './deps'
import {
  compareInterpretations,
  interpreterShadowEnabled,
  resolveShadowSlots,
  runInterpreterShadow,
  type InterpreterShadowEvent,
} from './interpreter-shadow'
import type { ExtractorRaw } from './llm-extractor'
import { interpretTurn } from './nlu/interpret'
import { getAiDailyUsage } from './usage'

const NOW = Date.UTC(2026, 10, 5, 15, 0)
const TODAY = '2026-11-05'

/** Extrator de teste: devolve a saída configurada e conta as chamadas. */
class FixedExtractAdapter extends SimulatedAiAdapter {
  extractCalls = 0
  constructor(private readonly reply: (catalog: string) => ExtractorRaw | 'fail' | 'garbage') {
    super()
  }
  override async generate(input: AiGenerateInput): Promise<AiGenerateResult> {
    if (input.profile === 'extract' || (input.tools && input.tools.length > 0)) {
      this.extractCalls += 1
      const out = this.reply(input.userContentOverride ?? '')
      if (out === 'fail') {
        return {
          ok: false,
          code: 'timeout',
          message: 'synthetic timeout',
          retryable: true,
          latencyMs: 8000,
          provider: this.providerId,
          model: 'test-extract',
        }
      }
      return {
        ok: true,
        text: out === 'garbage' ? 'isto não é json' : JSON.stringify(out),
        provider: this.providerId,
        model: 'test-extract',
        latencyMs: 9,
        inputTokens: 50,
        outputTokens: 14,
        toolName: 'extract_turn_slots',
      }
    }
    return super.generate(input)
  }
}

function seed() {
  const tenantId = 'clinic-demo-a'
  const clock = createControllableClock(NOW)
  const boot = bootClinicDb({ clock })
  const db = boot.db
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'bind_sh',
      phoneNumberId: 'pn_sh',
      wabaId: 'waba_sh',
      displayPhone: '+5511900000777',
      displayName: 'Clínica Sombra',
      action: 'channel_connected',
    },
    clock,
  )
  const gi = upsertResourceOp(db, caller, { kind: 'professional', name: 'Gi' }, clock)
  upsertServiceOp(
    db,
    caller,
    {
      name: 'Massagem',
      durationMinutes: 50,
      bufferMinutes: 0,
      priceCents: 15000,
      professionalIds: [gi.id],
      roomRequirement: { mode: 'none' },
    },
    clock,
  )
  setWeeklyWindowsOp(
    db,
    caller,
    {
      resourceId: gi.id,
      windows: [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, startMinute: 540, endMinute: 1080 })),
    },
    clock,
  )
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(
    db,
    { tenantId, waId: '5511900000777', displayName: 'Carla Ficticia' },
    clock,
  )
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  const services = listServices(db, tenantId)
  return { db, caller, tenantId, clock, cnv, contact, services, proId: gi.id, close: boot.close }
}

function task(services: ServiceRow[], proId: string, turnText: string) {
  return {
    tenantId: 'clinic-demo-a',
    conversationId: 'cnv_ficticio',
    messageId: 'msg_ficticio',
    turnText,
    today: TODAY,
    services,
    professionals: [{ id: proId, name: 'Gi' }],
    pending: null,
    mainModelCalled: false,
  }
}

describe('interpreterShadowEnabled / env', () => {
  it('desligada por omissão; liga com on', () => {
    expect(interpreterShadowEnabled(undefined)).toBe(false)
    expect(interpreterShadowEnabled('off')).toBe(false)
    expect(interpreterShadowEnabled('on')).toBe(true)
    expect(rpcDepsFromEnv({}).interpreterShadow).toBeUndefined()
    expect(rpcDepsFromEnv({ AI_INTERPRETER_SHADOW: 'on' }).interpreterShadow).toBe(true)
  })
})

describe('resolveShadowSlots (validação relaxada)', () => {
  it('aceita id do catálogo sem citação literal e recusa id inexistente', () => {
    const s = seed()
    try {
      const svc = s.services[0]!
      const opts = { today: TODAY, services: s.services, professionals: [], pending: null }
      const ok = resolveShadowSlots(
        { acts: ['marcar'], serviceId: svc.id, dateLiteral: 'amanhã', period: 'tarde' },
        opts,
      )
      expect(ok.slots).toEqual({ service: svc.id, date: '2026-11-06', period: 'tarde' })
      expect(ok.rejected).toEqual([])

      const bad = resolveShadowSlots(
        { serviceId: 'svc_inventado', dateLiteral: 'um dia destes', timeLiteral: 'cedo' },
        opts,
      )
      expect(bad.slots).toEqual({})
      expect(bad.rejected.sort()).toEqual(['date', 'service', 'time'])
    } finally {
      s.close()
    }
  })
})

describe('compareInterpretations', () => {
  it('classifica cada campo', () => {
    const s = seed()
    try {
      const svc = s.services[0]!
      const base = interpretTurn({
        turnText: 'quero massagem amanhã',
        messageId: 'm',
        today: TODAY,
        services: s.services,
      })
      const cmp = compareInterpretations(base, {
        service: svc.id,
        date: '2026-11-07',
        period: 'tarde',
      })
      expect(cmp.fields.service).toBe('agree')
      expect(cmp.fields.date).toBe('differ')
      expect(cmp.fields.period).toBe('llm_only')
      expect(cmp.fields.time).toBe('none')
      expect(cmp.diverged).toBe(true)
      expect(cmp.llmOnly).toEqual(['period'])
      expect(cmp.differ).toEqual(['date'])
    } finally {
      s.close()
    }
  })
})

describe('runInterpreterShadow', () => {
  it('regista o ganho que a citação literal recusa, sem texto da conversa', async () => {
    const s = seed()
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    try {
      const svc = s.services[0]!
      // «relaxar as costas» não cita Massagem: o léxico não lê e o validador de hoje recusa.
      const adapter = new FixedExtractAdapter(() => ({
        acts: ['marcar'],
        serviceId: svc.id,
        dateLiteral: 'amanhã',
      }))
      const ev = await runInterpreterShadow(
        { mode: 'synthetic', adapter },
        task(s.services, s.proId, 'queria relaxar as costas amanhã'),
      )
      expect(adapter.extractCalls).toBe(1)
      expect(ev.status).toBe('ok')
      expect(ev.fields?.service).toBe('llm_only')
      expect(ev.fields?.date).toBe('agree')
      expect(ev.llmOnly).toEqual(['service'])
      expect(ev.strictDiscarded).toContain('serviceId')
      expect(ev.relaxedRejected).toEqual([])

      const line = String(spy.mock.calls.at(-1)![0])
      expect(JSON.parse(line).event).toBe('ai.interpreter_shadow')
      expect(line).not.toMatch(/relaxar|costas|amanh|Massagem|Gi\b/i)
      expect(line).not.toContain(svc.id)
    } finally {
      spy.mockRestore()
      s.close()
    }
  })

  it('reutiliza a saída do caminho real em vez de chamar outra vez', async () => {
    const s = seed()
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    try {
      const adapter = new FixedExtractAdapter(() => ({ acts: ['marcar'] }))
      const ev = await runInterpreterShadow(
        { mode: 'synthetic', adapter },
        {
          ...task(s.services, s.proId, 'fazem pacote pra noivas?'),
          mainRaw: { acts: ['explicar'] },
          mainModelCalled: true,
        },
      )
      expect(adapter.extractCalls).toBe(0)
      expect(ev.reusedMainCall).toBe(true)
      expect(ev.llmActs).toEqual(['explicar'])
    } finally {
      spy.mockRestore()
      s.close()
    }
  })

  it('falha do provedor ou saída inválida não lança', async () => {
    const s = seed()
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    try {
      const t = task(s.services, s.proId, 'quero massagem')
      const failed = await runInterpreterShadow(
        { mode: 'synthetic', adapter: new FixedExtractAdapter(() => 'fail') },
        t,
      )
      expect(failed.status).toBe('provider')
      expect(failed.fields).toBeUndefined()
      const garbage = await runInterpreterShadow(
        { mode: 'synthetic', adapter: new FixedExtractAdapter(() => 'garbage') },
        t,
      )
      expect(garbage.status).toBe('parse')
    } finally {
      spy.mockRestore()
      s.close()
    }
  })
})

describe('sombra no turno real (runDueAutoDrafts)', () => {
  async function runTurn(shadow: boolean) {
    const s = seed()
    const events: InterpreterShadowEvent[] = []
    const spy = vi.spyOn(console, 'info').mockImplementation((line: unknown) => {
      try {
        const parsed = JSON.parse(String(line)) as InterpreterShadowEvent
        if (parsed.event === 'ai.interpreter_shadow') events.push(parsed)
      } catch {
        // outras linhas de log
      }
    })
    const svc = s.services[0]!
    // O modelo «leria» também o período; o léxico já lê serviço e dia.
    const adapter = new FixedExtractAdapter(() => ({
      acts: ['marcar'],
      serviceId: svc.id,
      dateLiteral: 'amanhã',
      period: 'tarde',
    }))
    try {
      const msg = insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: 'quero massagem amanhã depois do almoço',
          deliveryState: 'received',
          createdAt: s.clock.nowMs(),
        },
        s.clock,
      )
      enqueueAutoDraft(s.db, s.tenantId, { conversationId: s.cnv.id, messageId: msg.id }, s.clock)
      s.clock.advance(7_000)
      const out = await runDueAutoDrafts(s.db, s.caller, s.clock, {
        mode: 'synthetic',
        adapter,
        ...(shadow ? { interpreterShadow: true } : {}),
      })
      const outbound = s.db.all<{ body: string }>(
        `SELECT body FROM messages WHERE tenant_id = ? AND direction = 'outbound' ORDER BY created_at`,
        s.tenantId,
      )
      const frame = s.db.all<Record<string, unknown>>(
        // O id do serviço é aleatório por execução: compara-se só se existe.
        `SELECT service_id IS NOT NULL AS has_service, date, period, time, phase
         FROM schedule_sessions WHERE tenant_id = ?`,
        s.tenantId,
      )
      return {
        status: out.map((o) => o.status),
        replies: out.map((o) => o.autoBook?.replyText ?? null),
        outbound: outbound.map((o) => o.body),
        frame,
        usage: getAiDailyUsage(s.db, s.tenantId, s.clock).drafts,
        extractCalls: adapter.extractCalls,
        events,
      }
    } finally {
      spy.mockRestore()
      s.close()
    }
  }

  it('desligada: nenhuma chamada extra e nenhum evento', async () => {
    const off = await runTurn(false)
    expect(off.extractCalls).toBe(0)
    expect(off.events).toEqual([])
  })

  it('ligada: mede o turno, não muda resposta nem quadro e não conta no teto', async () => {
    const off = await runTurn(false)
    const on = await runTurn(true)
    expect(on.extractCalls).toBe(1)
    expect(on.events).toHaveLength(1)
    const ev = on.events[0]!
    expect(ev.mainModelCalled).toBe(false)
    expect(ev.fields?.service).toBe('agree')
    expect(ev.fields?.period).toBe('llm_only')

    expect(on.status).toEqual(off.status)
    expect(on.replies).toEqual(off.replies)
    expect(on.outbound).toEqual(off.outbound)
    expect(on.frame).toEqual(off.frame)
    expect(on.usage).toBe(off.usage)
  })
})
