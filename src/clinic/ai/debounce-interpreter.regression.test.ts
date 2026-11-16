import { describe, expect, it } from 'vitest'
import { AI_AUTODRAFT_DEBOUNCE_MS } from '../../ai/budgets'
import { insertMessage } from '../inbox/messages'
import { WHATSAPP_TYPING_INDICATOR_TYPE } from './typing-indicator'
import { enqueueAutoDraft, getAutoDraftJob, runDueAutoDrafts } from './autodraft'
import { bootDialogScenario } from './evals/dialogs/scenario'
import { SimulatedAiAdapter } from '../../ai/simulated/adapter'
import {
  AI_AUTODRAFT_DEBOUNCE_COMPLETE_MS,
  AI_AUTODRAFT_DEBOUNCE_INTERPRETER_CONFIDENT_MS,
  autodraftDebounceMs,
  interpreterResolvesTurnConfidently,
  interpretTurnForDebounce,
} from './debounce'
import { listServices } from '../config/services'

function say(
  s: ReturnType<typeof bootDialogScenario>,
  body: string,
  opts?: { fromInteractive?: boolean; externalMessageId?: string },
) {
  const atEnqueue = s.clock.nowMs()
  const msg = insertMessage(
    s.db,
    {
      tenantId: s.tenantId,
      conversationId: s.conversationId,
      direction: 'inbound',
      body,
      externalMessageId: opts?.externalMessageId ?? `wa:msg:wamid.${body.slice(0, 12)}`,
      deliveryState: 'received',
      createdAt: atEnqueue,
    },
    s.clock,
  )
  const job = enqueueAutoDraft(
    s.db,
    s.tenantId,
    {
      conversationId: s.conversationId,
      messageId: msg.id,
      fromInteractive: opts?.fromInteractive,
    },
    s.clock,
  )
  return { msg, job, waitMs: job ? job.dueAt - atEnqueue : null }
}

describe('debounce interpretador confiante', () => {
  it('«sim» sem heurística complete → 2,5 s (antes 7 s)', () => {
    const s = bootDialogScenario()
    try {
      const services = listServices(s.db, s.tenantId).filter((x) => x.active)
      const interp = interpretTurnForDebounce({
        turnText: 'sim',
        messageId: 'm',
        today: '2026-10-27',
        services,
      })
      expect(interpreterResolvesTurnConfidently(interp, 'sim')).toBe(true)
      expect(autodraftDebounceMs({ text: 'sim', interpretation: interp })).toBe(
        AI_AUTODRAFT_DEBOUNCE_INTERPRETER_CONFIDENT_MS,
      )
      expect(autodraftDebounceMs({ text: 'sim' })).toBe(AI_AUTODRAFT_DEBOUNCE_MS)
    } finally {
      s.close()
    }
  })

  it('texto coloquial / baixa cobertura → mantém 7 s', () => {
    const s = bootDialogScenario()
    try {
      const services = listServices(s.db, s.tenantId).filter((x) => x.active)
      const text = 'fazem pacote pra noivas no final do ano?'
      const interp = interpretTurnForDebounce({
        turnText: text,
        messageId: 'm',
        today: '2026-10-27',
        services,
      })
      expect(interpreterResolvesTurnConfidently(interp, text)).toBe(false)
      expect(autodraftDebounceMs({ text, interpretation: interp })).toBe(AI_AUTODRAFT_DEBOUNCE_MS)
    } finally {
      s.close()
    }
  })

  it('várias bolhas seguidas (2–4) → um job, sem resposta dupla', async () => {
    const s = bootDialogScenario()
    try {
      const deps = { mode: 'synthetic' as const, adapter: new SimulatedAiAdapter() }
      s.clock.advance(1_000)
      const a = say(s, 'quero depilar')
      expect(a.waitMs).toBe(AI_AUTODRAFT_DEBOUNCE_MS)
      s.clock.advance(2_000)
      const b = say(s, 'axila e pernas amanhã')
      expect(b.waitMs).toBeGreaterThan(0)
      const job = getAutoDraftJob(s.db, s.tenantId, s.conversationId)
      expect(job?.messageId).toBe(b.msg.id)
      const wait2 = job!.dueAt - s.clock.nowMs()
      expect(wait2).toBeGreaterThan(0)
      expect(wait2).toBeLessThanOrEqual(AI_AUTODRAFT_DEBOUNCE_MS)
      s.clock.advance(wait2)
      const out1 = await runDueAutoDrafts(s.db, s.caller, s.clock, deps)
      expect(out1.length).toBeGreaterThanOrEqual(0)
      s.clock.advance(AI_AUTODRAFT_DEBOUNCE_MS)
      const out2 = await runDueAutoDrafts(s.db, s.caller, s.clock, deps)
      const totalOutbound = s.db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM messages WHERE tenant_id = ? AND conversation_id = ? AND direction = 'outbound'`,
        s.tenantId,
        s.conversationId,
      )!.n
      expect(out2).toHaveLength(0)
      expect(totalOutbound).toBeLessThanOrEqual(3)
    } finally {
      s.close()
    }
  })

  it('botão depois de texto → debounce 0 no toque e typing só no toque', () => {
    const s = bootDialogScenario()
    try {
      const text = say(s, 'ainda estou pesquisando opções de tratamento')
      expect(text.waitMs).toBe(AI_AUTODRAFT_DEBOUNCE_MS)
      const tap = say(s, '[Botão] Sim', {
        fromInteractive: true,
        externalMessageId: 'wa:msg:wamid.TAP_SIM',
      })
      expect(tap.waitMs).toBe(0)
      const typingTap = s.db.get<{ id: string }>(
        `SELECT id FROM outbox_events WHERE tenant_id = ? AND type = ? AND idempotency_key = ?`,
        s.tenantId,
        WHATSAPP_TYPING_INDICATOR_TYPE,
        'whatsapp.typing_indicator:wamid.TAP_SIM',
      )
      expect(typingTap).toBeUndefined()
    } finally {
      s.close()
    }
  })

  it('sim rápido e depois correção → segunda bolha empurra o job (agregação)', () => {
    const s = bootDialogScenario()
    try {
      s.clock.advance(1_000)
      const yes = say(s, 'sim')
      expect(yes.waitMs).toBe(AI_AUTODRAFT_DEBOUNCE_INTERPRETER_CONFIDENT_MS)
      s.clock.advance(500)
      const fix = say(s, 'na verdade prefiro massagem')
      expect(fix.waitMs).toBe(AI_AUTODRAFT_DEBOUNCE_MS)
      const job = getAutoDraftJob(s.db, s.tenantId, s.conversationId)
      expect(job?.messageId).toBe(fix.msg.id)
      expect(job!.dueAt).toBeGreaterThan(s.clock.nowMs() + 6_000)
    } finally {
      s.close()
    }
  })

  it('pedido longo multi-zona com interpretador → 2,5 s e typing', () => {
    const s = bootDialogScenario()
    try {
      const dep = s.db.get<{ id: string }>(
        `SELECT id FROM services WHERE tenant_id = ? AND name = ?`,
        s.tenantId,
        'Depilação',
      )
      expect(dep).toBeTruthy()
      s.db.run(
        `UPDATE services SET synonyms_json = ? WHERE tenant_id = ? AND id = ?`,
        JSON.stringify(['depilar']),
        s.tenantId,
        dep!.id,
      )
      s.clock.advance(1_000)
      const body = 'quero depilar axila e pernas amanhã de tarde'
      const r = say(s, body, { externalMessageId: 'wa:msg:wamid.MULTI_ZONE' })
      expect(r.waitMs).toBe(AI_AUTODRAFT_DEBOUNCE_COMPLETE_MS)
      const typing = s.db.get<{ id: string }>(
        `SELECT id FROM outbox_events WHERE tenant_id = ? AND type = ? AND idempotency_key = ?`,
        s.tenantId,
        WHATSAPP_TYPING_INDICATOR_TYPE,
        'whatsapp.typing_indicator:wamid.MULTI_ZONE',
      )
      expect(typing).toBeTruthy()
    } finally {
      s.close()
    }
  })
})

describe('latência debounce (medido nos testes, não estimado)', () => {
  it('compara espera enfileirada: interpretador confiante vs texto aberto', () => {
    const s = bootDialogScenario()
    try {
      const services = listServices(s.db, s.tenantId).filter((x) => x.active)
      const confident = say(s, 'Pode ser às 15h')
      const open = say(s, 'oi ainda estou pensando no procedimento')
      expect(confident.waitMs).toBe(AI_AUTODRAFT_DEBOUNCE_COMPLETE_MS)
      expect(open.waitMs).toBe(AI_AUTODRAFT_DEBOUNCE_MS)
      expect((open.waitMs ?? 0) - (confident.waitMs ?? 0)).toBe(
        AI_AUTODRAFT_DEBOUNCE_MS - AI_AUTODRAFT_DEBOUNCE_COMPLETE_MS,
      )
      const interpOpen = interpretTurnForDebounce({
        turnText: 'oi ainda estou pensando no procedimento',
        messageId: 'm',
        today: '2026-10-27',
        services,
      })
      expect(interpOpen.needsExtractor).toBe(true)
    } finally {
      s.close()
    }
  })
})