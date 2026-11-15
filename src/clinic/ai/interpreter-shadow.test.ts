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
import { setDialogueVariantForTests } from './dialogue-acts'
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

  it('recusa line inventada sem género na frase (DEC-079 / Lab Bloco D FAQ)', () => {
    const s = seed()
    try {
      const opts = {
        today: TODAY,
        services: s.services,
        professionals: [],
        pending: null,
        turnText: 'vocês têm estacionamento perto da clínica?',
      }
      const invented = resolveShadowSlots({ acts: ['desconhecido'], line: 'feminino' }, opts)
      expect(invented.slots.line).toBeUndefined()
      expect(invented.rejected).toContain('line')

      const evidenced = resolveShadowSlots(
        { acts: ['marcar'], line: 'feminino' },
        { ...opts, turnText: 'quero depilação feminina' },
      )
      expect(evidenced.slots.line).toBe('feminino')
      expect(evidenced.rejected).not.toContain('line')
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

describe('interpreterShadowSink (destino do evento)', () => {
  it('recebe o evento depois do log e um sink que falha não afeta nada', async () => {
    const s = seed()
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    try {
      const svc = s.services[0]!
      const adapter = new FixedExtractAdapter(() => ({ acts: ['marcar'], serviceId: svc.id }))
      const seen: InterpreterShadowEvent[] = []
      const ev = await runInterpreterShadow(
        { mode: 'synthetic', adapter, interpreterShadowSink: (e) => void seen.push(e) },
        task(s.services, s.proId, 'quero massagem'),
      )
      expect(seen).toEqual([ev])

      const boom = await runInterpreterShadow(
        {
          mode: 'synthetic',
          adapter,
          interpreterShadowSink: () => {
            throw new Error('d1 em baixo')
          },
        },
        task(s.services, s.proId, 'quero massagem'),
      )
      expect(boom.status).toBe('ok')
    } finally {
      spy.mockRestore()
      s.close()
    }
  })

  it('não espera o sink assíncrono (fire-and-forget no orçamento do alarme)', async () => {
    const s = seed()
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    try {
      const svc = s.services[0]!
      const adapter = new FixedExtractAdapter(() => ({ acts: ['marcar'], serviceId: svc.id }))
      let resolveSink!: () => void
      const sinkDone = new Promise<void>((r) => {
        resolveSink = r
      })
      let started = false
      const startedAt = Date.now()
      const ev = await runInterpreterShadow(
        {
          mode: 'synthetic',
          adapter,
          interpreterShadowSink: () => {
            started = true
            return sinkDone
          },
        },
        task(s.services, s.proId, 'quero massagem'),
      )
      // Devolve sem esperar o D1; o sink já arrancou.
      expect(started).toBe(true)
      expect(Date.now() - startedAt).toBeLessThan(200)
      expect(ev.status).toBe('ok')
      resolveSink()
      await sinkDone
    } finally {
      spy.mockRestore()
      s.close()
    }
  })
})

describe('sombra no turno real (runDueAutoDrafts)', () => {
  async function runTurn(shadow: boolean, text = 'quero massagem amanhã depois do almoço') {
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
          body: text,
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

  it('mede também os turnos que o funil responde antes do extrator (preço do catálogo)', async () => {
    // «Quanto custa…» é respondido por um ramo determinístico (catálogo) que faz `continue`
    // antes do bloco do extrator: a sombra tem de o ver na mesma e não mudar a resposta.
    const text = 'quanto custa a massagem?'
    // A redação das frases aprovadas depende de um hash da conversa (id aleatório por corrida).
    setDialogueVariantForTests(0)
    let off: Awaited<ReturnType<typeof runTurn>>
    let on: Awaited<ReturnType<typeof runTurn>>
    try {
      off = await runTurn(false, text)
      on = await runTurn(true, text)
    } finally {
      setDialogueVariantForTests(null)
    }
    expect(on.events).toHaveLength(1)
    expect(on.events[0]!.status).toBe('ok')
    expect(on.events[0]!.mainModelCalled).toBe(false)
    expect(on.extractCalls).toBe(1)
    expect(on.replies).toEqual(off.replies)
    expect(on.outbound).toEqual(off.outbound)
    expect(on.usage).toBe(off.usage)
  })

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
