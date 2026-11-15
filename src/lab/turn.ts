/**
 * Turno e estado do laboratório (DEC-186). Corre dentro do DO da clínica demo; as
 * ações com efeitos (ingerir, correr a IA, tocar, marcar envio) entram por `LabHooks`,
 * para o módulo ser testável sem o Durable Object.
 *
 * Nada aqui chama a Meta: o consumer da fila ignora o tenant demo e o resultado do
 * envio é marcado como entregue de forma sintética, só para a proposta avançar.
 */
import type { ClinicDb } from '../clinic/store'

export type LabTap = { buttonId: string; title: string; kind: 'button' | 'list' }

export type LabTurnInput = {
  waId: string
  displayName?: string
  text?: string
  tap?: LabTap
}

export type LabOutboundOptions = {
  buttons: unknown
  list: unknown
}

export type LabMessage = {
  id: string
  direction: string
  body: string
  deliveryState: string
  createdAt: number
  /** Só nas mensagens enviadas pelo sistema com botões ou lista: o que a cliente podia tocar. */
  options?: LabOutboundOptions
}

export type LabTurnResult = {
  conversationId: string | null
  /** Mensagens novas deste turno, em ordem. */
  messages: LabMessage[]
  /** O que a cliente pode tocar agora (último envio com botões ou lista), se houver. */
  tappable: LabOutboundOptions | null
  aiOutcomes: Array<{ status: string; conversationId: string; reason?: string }>
  click?: unknown
  turnsUsedToday: number
  turnsCapToday: number
  /** Início do turno (ms) — Lab usa para recolher mensagens após wait LLM (DEC-188). */
  startedAt: number
}

export type LabHooks = {
  nowMs: () => number
  ingest: (input: {
    providerEventKey: string
    waId: string
    displayName?: string
    body: string
    quiet: boolean
  }) => Promise<{ conversationId: string | null; contactId: string | null }>
  click: (input: {
    conversationId: string
    contactId: string
    buttonId: string
    buttonTitle: string
    providerEventKey: string
  }) => Promise<unknown>
  /**
   * Só a conversa deste turno (DEC-188 / Lab): não drenar a fila global de
   * `ai_autodraft_jobs` vencidos — isso reentrou em espiral de CPU no DO demo
   * após Bloco D (vários jobs `queued` de waIds paralelos).
   */
  runAutoDrafts: (opts: {
    conversationId: string
    limit?: number
  }) => Promise<Array<{ status: string; conversationId: string; reason?: string }>>
  settleOutbound: (row: {
    outboxEventId: string
    idempotencyKey: string
    outboundId: string
  }) => Promise<void>
  newId: () => string
}

export class LabBudgetError extends Error {
  readonly code = 'lab_budget_exhausted'
}

type OutboxSql = { id: string; idempotency_key: string; payload_json: string }
type MsgSql = {
  id: string
  direction: string
  body: string
  delivery_state: string
  created_at: number
}

function parse(json: string): Record<string, unknown> {
  try {
    const v = JSON.parse(json) as unknown
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export function labDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10)
}

export async function runLabTurn(
  db: ClinicDb,
  tenantId: string,
  input: LabTurnInput,
  hooks: LabHooks,
  budget: { used: number; cap: number; commit: (used: number) => Promise<void> },
): Promise<LabTurnResult> {
  if (budget.used >= budget.cap) {
    throw new LabBudgetError(`Teto diário do laboratório atingido (${budget.cap} turnos).`)
  }
  const hasText = typeof input.text === 'string' && input.text.trim().length > 0
  if (hasText === Boolean(input.tap)) {
    throw new Error('Indicar exatamente um de: text, tap.')
  }
  await budget.commit(budget.used + 1)

  const startMs = hooks.nowMs()
  const key = `lab:${hooks.newId()}`
  let conversationId: string | null = null
  let click: unknown
  let aiOutcomes: Array<{ status: string; conversationId: string; reason?: string }> = []

  if (hasText) {
    const ingested = await hooks.ingest({
      providerEventKey: key,
      waId: input.waId,
      displayName: input.displayName,
      body: input.text!.trim(),
      quiet: false,
    })
    conversationId = ingested.conversationId
    if (conversationId) {
      // Sem esperar o debounce: a IA responde já a este turno.
      db.run(
        `UPDATE ai_autodraft_jobs SET due_at = ? WHERE tenant_id = ? AND conversation_id = ? AND state = 'queued'`,
        startMs,
        tenantId,
        conversationId,
      )
      aiOutcomes = await hooks.runAutoDrafts({ conversationId, limit: 1 })
    }
  } else {
    const tap = input.tap!
    const ingested = await hooks.ingest({
      providerEventKey: key,
      waId: input.waId,
      displayName: input.displayName,
      body: `${tap.kind === 'list' ? '[Lista]' : '[Botão]'} ${tap.title}`,
      quiet: true,
    })
    conversationId = ingested.conversationId
    if (conversationId) {
      click = await hooks.click({
        conversationId,
        contactId: ingested.contactId ?? '',
        buttonId: tap.buttonId,
        buttonTitle: tap.title,
        providerEventKey: key,
      })
    }
  }

  // Marca os envios deste turno como entregues (sintético) e recolhe as opções tocáveis.
  const sends = db.all<OutboxSql>(
    `SELECT id, idempotency_key, payload_json FROM outbox_events
     WHERE tenant_id = ? AND type = 'whatsapp.send' AND occurred_at >= ?
     ORDER BY occurred_at, id`,
    tenantId,
    startMs,
  )
  const optionsByMessage = new Map<string, LabOutboundOptions>()
  let tappable: LabOutboundOptions | null = null
  for (const row of sends) {
    const payload = parse(row.payload_json)
    const outboundId = typeof payload.outboundId === 'string' ? payload.outboundId : ''
    const messageId = typeof payload.messageId === 'string' ? payload.messageId : ''
    const buttons = payload.interactiveButtons ?? null
    const list = payload.interactiveList ?? null
    if (buttons || list) {
      const opts = { buttons, list }
      if (messageId) optionsByMessage.set(messageId, opts)
      tappable = opts
    }
    if (outboundId) {
      try {
        await hooks.settleOutbound({
          outboxEventId: row.id,
          idempotencyKey: row.idempotency_key,
          outboundId,
        })
      } catch {
        /* já resolvido ou sem estado a avançar: o laboratório só observa */
      }
    }
  }

  const messages: LabMessage[] = conversationId
    ? db
        .all<MsgSql>(
          `SELECT id, direction, body, delivery_state, created_at FROM messages
           WHERE tenant_id = ? AND conversation_id = ? AND created_at >= ?
           ORDER BY created_at, id`,
          tenantId,
          conversationId,
          startMs,
        )
        .map((m) => ({
          id: m.id,
          direction: m.direction,
          body: m.body,
          deliveryState: m.delivery_state,
          createdAt: m.created_at,
          ...(optionsByMessage.has(m.id) ? { options: optionsByMessage.get(m.id)! } : {}),
        }))
    : []

  return {
    conversationId,
    messages,
    tappable,
    aiOutcomes,
    ...(click !== undefined ? { click } : {}),
    turnsUsedToday: budget.used + 1,
    turnsCapToday: budget.cap,
    startedAt: startMs,
  }
}

/**
 * Depois do wait LLM no Worker: marca envios como entregues e devolve mensagens do turno.
 */
export async function collectLabTurnAfterLlm(
  db: ClinicDb,
  tenantId: string,
  input: { conversationId: string; sinceMs: number },
  hooks: Pick<LabHooks, 'settleOutbound' | 'nowMs'>,
  budget: { used: number; cap: number },
): Promise<LabTurnResult> {
  const sends = db.all<OutboxSql>(
    `SELECT id, idempotency_key, payload_json FROM outbox_events
     WHERE tenant_id = ? AND type = 'whatsapp.send' AND occurred_at >= ?
     ORDER BY occurred_at, id`,
    tenantId,
    input.sinceMs,
  )
  const optionsByMessage = new Map<string, LabOutboundOptions>()
  let tappable: LabOutboundOptions | null = null
  for (const row of sends) {
    const payload = parse(row.payload_json)
    const outboundId = typeof payload.outboundId === 'string' ? payload.outboundId : ''
    const messageId = typeof payload.messageId === 'string' ? payload.messageId : ''
    const buttons = payload.interactiveButtons ?? null
    const list = payload.interactiveList ?? null
    if (buttons || list) {
      const opts = { buttons, list }
      if (messageId) optionsByMessage.set(messageId, opts)
      tappable = opts
    }
    if (outboundId) {
      try {
        await hooks.settleOutbound({
          outboxEventId: row.id,
          idempotencyKey: row.idempotency_key,
          outboundId,
        })
      } catch {
        /* já resolvido */
      }
    }
  }
  const messages: LabMessage[] = db
    .all<MsgSql>(
      `SELECT id, direction, body, delivery_state, created_at FROM messages
       WHERE tenant_id = ? AND conversation_id = ? AND created_at >= ?
       ORDER BY created_at, id`,
      tenantId,
      input.conversationId,
      input.sinceMs,
    )
    .map((m) => ({
      id: m.id,
      direction: m.direction,
      body: m.body,
      deliveryState: m.delivery_state,
      createdAt: m.created_at,
      ...(optionsByMessage.has(m.id) ? { options: optionsByMessage.get(m.id)! } : {}),
    }))
  return {
    conversationId: input.conversationId,
    messages,
    tappable,
    aiOutcomes: [],
    turnsUsedToday: budget.used,
    turnsCapToday: budget.cap,
    startedAt: input.sinceMs,
  }
}

export type LabStateResult = {
  tenantId: string
  contact: Record<string, unknown> | null
  conversations: Array<Record<string, unknown>>
  messages: LabMessage[]
  proposals: Array<Record<string, unknown>>
  autodraftJobs: Array<Record<string, unknown>>
  appointments: Array<Record<string, unknown>>
  turnsUsedToday: number
  turnsCapToday: number
}

export function readLabState(
  db: ClinicDb,
  tenantId: string,
  input: { waId: string; messageLimit?: number },
  budget: { used: number; cap: number },
): LabStateResult {
  const limit = Math.min(Math.max(input.messageLimit ?? 40, 1), 100)
  const contact =
    db.get<Record<string, unknown>>(
      `SELECT * FROM contacts WHERE tenant_id = ? AND wa_id = ?`,
      tenantId,
      input.waId,
    ) ?? null
  const contactId = contact ? String(contact.id) : null
  const conversations = contactId
    ? db.all<Record<string, unknown>>(
        `SELECT * FROM conversations WHERE tenant_id = ? AND contact_id = ? ORDER BY updated_at DESC LIMIT 5`,
        tenantId,
        contactId,
      )
    : []
  const convId = conversations[0] ? String(conversations[0].id) : null
  const messages = convId
    ? db
        .all<MsgSql>(
          `SELECT id, direction, body, delivery_state, created_at FROM messages
           WHERE tenant_id = ? AND conversation_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
          tenantId,
          convId,
          limit,
        )
        .reverse()
        .map((m) => ({
          id: m.id,
          direction: m.direction,
          body: m.body,
          deliveryState: m.delivery_state,
          createdAt: m.created_at,
        }))
    : []
  const proposals = convId
    ? db.all<Record<string, unknown>>(
        `SELECT * FROM appointment_proposals WHERE tenant_id = ? AND conversation_id = ? ORDER BY created_at DESC LIMIT 5`,
        tenantId,
        convId,
      )
    : []
  const autodraftJobs = db.all<Record<string, unknown>>(
    `SELECT * FROM ai_autodraft_jobs WHERE tenant_id = ?`,
    tenantId,
  )
  const appointments = db.all<Record<string, unknown>>(
    `SELECT * FROM appointments WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 20`,
    tenantId,
  )
  return {
    tenantId,
    contact,
    conversations,
    messages,
    proposals,
    autodraftJobs,
    appointments,
    turnsUsedToday: budget.used,
    turnsCapToday: budget.cap,
  }
}
