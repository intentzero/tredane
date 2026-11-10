/**
 * Pausa da IA e frase fixa quando a cliente pede uma pessoa ou sai do agendamento (DEC-083).
 * Não chama o modelo. Não marca horário. Uma mensagem já pausada não gera outra frase.
 *
 * DEC-155: timeout 30 min sem Assumir → devolver à IA + aviso curto;
 * fora do expediente → sem oferta/dica de equipe; pedido explícito → horário, IA activa.
 */
import type { Clock } from '../../db/clock'
import { HANDOFF_TIMEOUT_MS } from '../constants'
import { workerCaller } from '../envelopes'
import { ClinicError } from '../errors'
import { listEffectiveWeeklyWindows } from '../config/availability'
import { listBlocks } from '../config/blocks'
import { listResources } from '../config/resources'
import { listServices } from '../config/services'
import { ensureClinicSettings } from '../config/settings'
import { CLINIC_SCOPE_ID } from '../config/types'
import { setConversationAssignee } from '../inbox/conversations'
import { sendOutboundMessageOp } from '../inbox/operations'
import { insertOutboxEvent, type OutboxRow } from '../outbox'
import { syncOpenOpportunityAssignee } from '../pipeline/appointment-stage'
import { openPendingCommunication } from '../proposals/pending-communication'
import { clinicCivilDateFromUtc, zonedCivilToUtc } from '../scheduling/timezone'
import type { ClinicDb } from '../store'
import {
  OFF_TOPIC_RE,
  PIX_OFF_PURPOSE_RE,
  RESCHEDULE_RE,
  classifySensitive,
  hasAiTransparencyQuestion,
  hasPolicyQuestion,
  hasStopRequest,
  wantsHumanPause,
} from './nlu/sensitive'
import { endBookingSession } from './booking-session'
import { sayAct } from './dialogue-acts'
import { formatOpeningHours } from './schedule-context'
import { getBookingFrame } from './schedule-session'

const PERIOD_LABEL: Record<string, string> = {
  manha: 'manhã',
  tarde: 'tarde',
  noite: 'noite',
}

/**
 * Resumo do quadro entendido para o alerta da equipe (prática 10 / #512).
 * Só campos já gravados; não vai ao modelo. Texto interno (não é copy à cliente).
 */
export function understoodBookingFrameDetail(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
): string | null {
  const frame = getBookingFrame(db, tenantId, conversationId)
  if (!frame?.serviceId) return null
  const services = listServices(db, tenantId)
  const svc = services.find((s) => s.id === frame.serviceId)
  if (!svc) return null
  const parts: string[] = [`serviço ${svc.name}`]
  const line = frame.line ?? null
  if (line === 'feminino') parts.push('feminina')
  else if (line === 'masculino') parts.push('masculina')
  if (frame.variantIds?.length) {
    const names = svc.zones
      .filter((z) => frame.variantIds!.includes(z.id))
      .map((z) => z.name.trim())
      .filter(Boolean)
    if (names.length > 0) parts.push(`zonas ${names.join(', ')}`)
  }
  if (frame.date) parts.push(`dia ${frame.date}`)
  if (frame.time) parts.push(`hora ${frame.time}`)
  else if (frame.period) parts.push(`período ${PERIOD_LABEL[frame.period] ?? frame.period}`)
  return `Quadro entendido: ${parts.join('; ')}.`
}

function withUnderstoodFrame(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  detail: string,
): string {
  const frame = understoodBookingFrameDetail(db, tenantId, conversationId)
  return frame ? `${detail} ${frame}` : detail
}

const AI_ASSIGNEE = 'system:ai-autodraft'

export const HUMAN_HANDOFF_TEXT = 'Vou pedir para a equipe continuar daqui.'
/** Prefixo comum DEC-083 / DEC-113 — «já dito» aceita as duas variantes. */
export const HUMAN_HANDOFF_PREFIX = 'Vou pedir para a equipe continuar daqui.'
export const HUMAN_HANDOFF_BUTTON_ID = 'handoff:human'
export const HUMAN_HANDOFF_BUTTON_TITLE = 'Falar com a equipe'

/** DEC-155 — aviso ao cliente quando o timeout devolve a conversa à IA. */
export const HANDOFF_TIMEOUT_RESUME_TEXT =
  'A equipe não conseguiu assumir agora. Continuo te atendendo por aqui.'

/** DEC-155 — fallback se não houver próxima abertura calculável. */
export const AFTER_HOURS_HUMAN_KEEP_AI_FALLBACK =
  'Fora do horário da equipe agora. Posso continuar te ajudando por aqui.'

/** DEC-115 — transparência (neutra; persona com nome → ok Paulo). */
export const AI_TRANSPARENCY_TEXT =
  'Sou a assistente virtual da clínica. Se preferir, chamo a equipe.'

/** Origem do evento `conversation.ai_pause` — ganchos para alertas do painel (DEC-156). */
export type AiPauseEventSource = 'handoff' | 'timeout_resume' | 'manual_resume'

/** Minuto civil no fuso da clínica (0–1439). */
function clinicMinuteOfDay(tz: string, nowMs: number): number {
  const label = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(nowMs))
  const [hh, mm] = label.split(':').map(Number) as [number, number]
  return hh * 60 + mm
}

/**
 * Clínica aberta agora pelo expediente efectivo (mesma base que DEC-113 / hub).
 * Evita import circular com `whatsapp/flow/hub-opening`.
 */
export function isClinicOpenForHandoff(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
): boolean {
  const settings = ensureClinicSettings(db, tenantId, clock)
  const tz = settings.timezone || 'America/Sao_Paulo'
  const now = clock.nowMs()
  const windows = listEffectiveWeeklyWindows(db, tenantId)
  if (windows.length === 0) return false
  const today = clinicCivilDateFromUtc(tz, now)
  const dow = weekdayOf(today)
  const minute = clinicMinuteOfDay(tz, now)
  return windows.some(
    (w) => w.dayOfWeek === dow && w.startMinute <= minute && minute < w.endMinute,
  )
}

/** Expediente aberto → pode oferecer botão/dica «Falar com a equipe» (DEC-155). */
export function isHumanTeamOfferAllowed(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
): boolean {
  return isClinicOpenForHandoff(db, tenantId, clock)
}

/** Botão reply «Falar com a equipe» só dentro do expediente (DEC-155). */
export function humanTeamOfferButtons(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
): Array<{ id: string; title: string }> {
  if (!isHumanTeamOfferAllowed(db, tenantId, clock)) return []
  return [{ id: HUMAN_HANDOFF_BUTTON_ID, title: HUMAN_HANDOFF_BUTTON_TITLE }]
}

/**
 * Pedido explícito de equipe fora do expediente (DEC-155): horário + IA activa.
 * Prefere a próxima abertura (como DEC-113); senão lista o expediente.
 */
export function afterHoursHumanRequestBody(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
  conversationId = '',
): string {
  const opening = nextClinicOpening(db, tenantId, clock)
  if (opening) {
    return `A equipe atende a partir de ${opening.dayLabel} às ${opening.time}. Posso continuar te ajudando por aqui.`
  }
  const resources = listResources(db, tenantId, clock)
  const pros = new Set(resources.filter((r) => r.kind === 'professional').map((r) => r.id))
  const lines = formatOpeningHours(
    listEffectiveWeeklyWindows(db, tenantId)
      .filter((w) => pros.has(w.resourceId))
      .map((w) => ({
        dayOfWeek: w.dayOfWeek,
        startMinute: w.startMinute,
        endMinute: w.endMinute,
      })),
  )
  if (lines.length === 0) return AFTER_HOURS_HUMAN_KEEP_AI_FALLBACK
  const lista = lines.join('\n')
  const withHours = sayAct(
    'informar_expediente',
    conversationId,
    { lista },
    `Funcionamos assim:\n${lista}`,
  )
  return `${withHours}\n\nPosso continuar te ajudando por aqui.`
}

/**
 * Responde ao pedido de equipe fora do expediente sem pausar (DEC-155).
 * Usado por texto, botão genérico e botão da proposta.
 */
export function replyAfterHoursHumanRequest(
  db: ClinicDb,
  tenantId: string,
  input: { conversationId: string; clientRequestId: string },
  clock: Clock,
): { outbox: OutboxRow[] } {
  const outbox: OutboxRow[] = []
  try {
    const result = sendOutboundMessageOp(
      db,
      workerCaller(tenantId, AI_ASSIGNEE),
      {
        conversationId: input.conversationId,
        body: afterHoursHumanRequestBody(db, tenantId, clock, input.conversationId),
        clientRequestId: input.clientRequestId,
        authorClerkUserId: AI_ASSIGNEE,
        authorDisplayName: 'IA',
      },
      clock,
    )
    outbox.push(...result.outbox)
  } catch (err) {
    if (!(err instanceof ClinicError)) throw err
  }
  return { outbox }
}

export function clearHandoffTimeout(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  updatedAt: number,
): void {
  db.run(
    `UPDATE conversations SET ai_handoff_timeout_at = NULL, updated_at = ?
     WHERE tenant_id = ? AND id = ?`,
    updatedAt,
    tenantId,
    conversationId,
  )
}

export function readHandoffTimeoutAt(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
): number | null {
  const row = db.get<{ at: number | null }>(
    `SELECT ai_handoff_timeout_at AS at FROM conversations WHERE tenant_id = ? AND id = ?`,
    tenantId,
    conversationId,
  )
  return row?.at ?? null
}

export function nextHandoffTimeoutAt(db: ClinicDb, tenantId: string): number | null {
  const row = db.get<{ t: number | null }>(
    `SELECT MIN(ai_handoff_timeout_at) AS t FROM conversations
     WHERE tenant_id = ? AND ai_handoff_timeout_at IS NOT NULL`,
    tenantId,
  )
  return row?.t ?? null
}

/**
 * DEC-155 — conversas com timeout vencido e IA ainda pausada: aviso + devolver à IA.
 * Assumir / Devolver à IA limpam `ai_handoff_timeout_at` antes; se alguém Assumiu, não chega aqui.
 */
export function sweepDueHandoffTimeouts(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
): Array<{ conversationId: string; outbox: OutboxRow[] }> {
  const now = clock.nowMs()
  const due = db.all<{ id: string }>(
    `SELECT id FROM conversations
     WHERE tenant_id = ? AND ai_handoff_timeout_at IS NOT NULL AND ai_handoff_timeout_at <= ?
       AND ai_reply_paused_at IS NOT NULL
     ORDER BY ai_handoff_timeout_at ASC
     LIMIT 50`,
    tenantId,
    now,
  )
  const results: Array<{ conversationId: string; outbox: OutboxRow[] }> = []
  for (const row of due) {
    const conversationId = row.id
    const outbox = resumeAiReply(db, tenantId, conversationId, clock, {
      source: 'timeout_resume',
    })
    try {
      const sent = sendOutboundMessageOp(
        db,
        workerCaller(tenantId, AI_ASSIGNEE),
        {
          conversationId,
          body: HANDOFF_TIMEOUT_RESUME_TEXT,
          clientRequestId: `handoff.timeout:${conversationId}:${now}`,
          authorClerkUserId: AI_ASSIGNEE,
          authorDisplayName: 'IA',
        },
        clock,
      )
      outbox.push(...sent.outbox)
    } catch (err) {
      if (!(err instanceof ClinicError)) throw err
    }
    results.push({ conversationId, outbox })
  }
  return results
}

export type AiReplyPauseReason =
  | 'customer_requested'
  | 'off_purpose'
  | 'human_only'
  /** Comprovativo de pagamento (DEC-119 / #475). */
  | 'payment_proof'
  /** Segunda mídia após pedido de texto (DEC-119 / #475). */
  | 'media_after_ask'

const WEEKDAYS = ['', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo']

function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return js === 0 ? 7 : js
}

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const dt = new Date(Date.UTC(y, m - 1, d + n))
  return dt.toISOString().slice(0, 10)
}

/** Próxima abertura do expediente efectivo (DEC-113). */
export function nextClinicOpening(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
): { dayLabel: string; time: string } | null {
  const settings = ensureClinicSettings(db, tenantId, clock)
  const tz = settings.timezone || 'America/Sao_Paulo'
  const now = clock.nowMs()
  const windows = listEffectiveWeeklyWindows(db, tenantId)
  if (windows.length === 0) return null
  const clinicBlocks = listBlocks(db, tenantId, CLINIC_SCOPE_ID)
  const today = clinicCivilDateFromUtc(tz, now)
  for (let offset = 0; offset < 14; offset++) {
    const date = addDays(today, offset)
    const dow = weekdayOf(date)
    const dayWindows = windows
      .filter((w) => w.dayOfWeek === dow)
      .sort((a, b) => a.startMinute - b.startMinute)
    for (const w of dayWindows) {
      const hh = Math.floor(w.startMinute / 60)
      const mm = w.startMinute % 60
      const [y, mo, d] = date.split('-').map(Number) as [number, number, number]
      const startsAt = zonedCivilToUtc(tz, y, mo, d, hh, mm)
      if (startsAt <= now) continue
      const blocked = clinicBlocks.some((b) => b.startsAt <= startsAt && startsAt < b.endsAt)
      if (blocked) continue
      return {
        dayLabel: WEEKDAYS[dow]!,
        time: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
      }
    }
  }
  return null
}

/**
 * Frase DEC-083 ou DEC-113 (fora do expediente) para pausas que ainda pausam a IA
 * (off_purpose, human_only, etc.). Pedido explícito de equipe fora do expediente
 * não passa por aqui — DEC-155 usa `afterHoursHumanRequestBody` sem pausa.
 */
export function humanHandoffBody(db: ClinicDb, tenantId: string, clock: Clock): string {
  const opening = nextClinicOpening(db, tenantId, clock)
  if (!opening) return HUMAN_HANDOFF_TEXT
  if (isClinicOpenForHandoff(db, tenantId, clock)) return HUMAN_HANDOFF_TEXT
  return `${HUMAN_HANDOFF_TEXT} A equipe responde a partir de ${opening.dayLabel} às ${opening.time}.`
}

export function readAiReplyPause(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
): { at: number; reason: string } | null {
  const row = db.get<{ at: number | null; reason: string | null }>(
    `SELECT ai_reply_paused_at AS at, ai_reply_pause_reason AS reason
     FROM conversations WHERE tenant_id = ? AND id = ?`,
    tenantId,
    conversationId,
  )
  if (!row?.at) return null
  return { at: row.at, reason: row.reason ?? 'off_purpose' }
}

export function resumeAiReply(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  clock: Clock,
  opts?: { source?: Exclude<AiPauseEventSource, 'handoff'> },
): OutboxRow[] {
  const now = clock.nowMs()
  const source = opts?.source ?? 'manual_resume'
  db.run(
    `UPDATE conversations
     SET ai_reply_paused_at = NULL, ai_reply_pause_reason = NULL,
         ai_handoff_timeout_at = NULL, updated_at = ?
     WHERE tenant_id = ? AND id = ?`,
    now,
    tenantId,
    conversationId,
  )
  db.run(
    `UPDATE pending_communications
     SET status = 'resolved', resolved_at = ?, updated_at = ?
     WHERE tenant_id = ? AND conversation_id = ? AND kind = 'alter_awaiting_team' AND status != 'resolved'`,
    now,
    now,
    tenantId,
    conversationId,
  )
  // Devolver à IA: a pessoa largou o cartão. A IA volta a ser a responsável (DEC-093).
  setConversationAssignee(db, {
    tenantId,
    conversationId,
    assigneeClerkUserId: AI_ASSIGNEE,
    assigneeDisplayName: 'IA',
    updatedAt: now,
  })
  syncOpenOpportunityAssignee(db, {
    tenantId,
    conversationId,
    assigneeClerkUserId: AI_ASSIGNEE,
    assigneeDisplayName: 'IA',
    updatedAt: now,
  })
  return [
    pauseEvent(db, tenantId, conversationId, false, clock, {
      assigneeClerkUserId: AI_ASSIGNEE,
      assigneeDisplayName: 'IA',
      source,
      handoffTimeoutAt: null,
    }),
  ]
}

function pauseEvent(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  paused: boolean,
  clock: Clock,
  extra?: {
    assigneeClerkUserId?: string | null
    assigneeDisplayName?: string | null
    source?: AiPauseEventSource
    handoffTimeoutAt?: number | null
  },
): OutboxRow {
  return insertOutboxEvent(
    db,
    {
      tenantId,
      type: 'conversation.ai_pause',
      aggregateType: 'conversation',
      aggregateId: conversationId,
      idempotencyKey: `conversation.ai_pause:${conversationId}:${clock.nowMs()}:${paused ? 'on' : 'off'}`,
      payload: { conversationId, aiReplyPaused: paused, ...extra },
    },
    clock,
  )
}

/** A frase automática não deixa a conversa «com a IA» enquanto a equipe deve assumir. */
function clearAiAssignee(db: ClinicDb, tenantId: string, conversationId: string, clock: Clock): void {
  const row = db.get<{ assignee: string | null }>(
    `SELECT assignee_clerk_user_id AS assignee FROM conversations WHERE tenant_id = ? AND id = ?`,
    tenantId,
    conversationId,
  )
  if (row?.assignee !== AI_ASSIGNEE) return
  const now = clock.nowMs()
  setConversationAssignee(db, {
    tenantId,
    conversationId,
    assigneeClerkUserId: null,
    assigneeDisplayName: null,
    updatedAt: now,
  })
  syncOpenOpportunityAssignee(db, {
    tenantId,
    conversationId,
    assigneeClerkUserId: null,
    assigneeDisplayName: null,
    updatedAt: now,
  })
}

function professionalOutsideService(
  db: ClinicDb,
  tenantId: string,
  text: string,
  clock: Clock,
  turn?: { catalog: { services: import('../config/types').ServiceRow[]; resources: import('../config/types').ResourceRow[] } },
): boolean {
  const pros = (turn?.catalog.resources ?? listResources(db, tenantId, clock)).filter(
    (r) => r.kind === 'professional' && r.name.trim().length >= 2,
  )
  const mentioned = pros.filter((p) => new RegExp(`\\b${p.name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text))
  if (mentioned.length === 0) return false
  const services = (turn?.catalog.services ?? listServices(db, tenantId).filter((s) => s.active))
  const named = services.filter((s) => text.toLowerCase().includes(s.name.trim().toLowerCase()))
  const pool = named.length > 0 ? named : services
  return mentioned.some((p) => !pool.some((s) => s.professionalIds.includes(p.id)))
}

/** Motivo da pausa, ou null se a mensagem ainda é um pedido de agendamento. */
export function handoffReason(
  db: ClinicDb,
  tenantId: string,
  text: string,
  clock: Clock,
  turn?: { catalog: { services: import('../config/types').ServiceRow[]; resources: import('../config/types').ResourceRow[] } },
): AiReplyPauseReason | null {
  const body = text.trim()
  if (!body) return null
  const hits = classifySensitive(body)
  // CF-04: pergunta condicional sobre política não pausa (responde a política no autodraft).
  if (hasPolicyQuestion(hits)) return null
  // DEC-115: transparência — autodraft responde sem pausar.
  if (hasAiTransparencyQuestion(hits)) return null
  // DEC-114: stop — autodraft pausa em silêncio (sem frase).
  if (hasStopRequest(hits)) return 'customer_requested'
  if (!wantsHumanPause(hits) && !OFF_TOPIC_RE.test(body) && !PIX_OFF_PURPOSE_RE.test(body)) {
    if (professionalOutsideService(db, tenantId, body, clock, turn)) return 'human_only'
    // Remarcação: o autodraft tenta DEC-091 antes; sem compromisso futuro → human_only lá.
    if (RESCHEDULE_RE.test(body) && !hits.some((h) => h.label === 'pedir_pessoa')) return 'human_only'
    return null
  }
  if (hits.some((h) => h.label === 'pedir_pessoa' || h.label === 'pedir_parar')) return 'customer_requested'
  if (
    hits.some((h) => h.label === 'injecao' && h.injectionStrength === 'forte') ||
    hits.some((h) => h.label === 'saude' || h.label === 'ofensa') ||
    OFF_TOPIC_RE.test(body) ||
    PIX_OFF_PURPOSE_RE.test(body)
  ) {
    return 'off_purpose'
  }
  if (
    hits.some((h) => h.label === 'cancelar' || h.label === 'terceiro') ||
    professionalOutsideService(db, tenantId, body, clock)
  ) {
    return 'human_only'
  }
  if (RESCHEDULE_RE.test(body)) return 'human_only'
  return null
}

/**
 * Pausa e abre o alerta da equipe. A frase no WhatsApp sai uma vez enquanto o alerta
 * seguir aberto. Falha de WhatsApp não desfaz a pausa.
 */
export function notifyHumanHandoff(
  db: ClinicDb,
  tenantId: string,
  input: {
    conversationId: string
    reason: AiReplyPauseReason
    clientRequestId: string
    /** DEC-114: pausa + alerta sem mensagem automática. */
    silent?: boolean
  },
  clock: Clock,
): { already: boolean; sent: boolean; outbox: OutboxRow[] } {
  const existing = readAiReplyPause(db, tenantId, input.conversationId)
  if (existing) return { already: true, sent: false, outbox: [] }
  const now = clock.nowMs()
  const handoffTimeoutAt = now + HANDOFF_TIMEOUT_MS
  db.run(
    `UPDATE conversations
     SET ai_reply_paused_at = ?, ai_reply_pause_reason = ?,
         ai_handoff_timeout_at = ?, updated_at = ?
     WHERE tenant_id = ? AND id = ?`,
    now,
    input.reason,
    handoffTimeoutAt,
    now,
    tenantId,
    input.conversationId,
  )
  // DEC-148 / T1: handoff (DEC-083) fecha a sessão de marcação com outcome handoff.
  const frame = getBookingFrame(db, tenantId, input.conversationId)
  const sessionEnd = endBookingSession(
    db,
    tenantId,
    input.conversationId,
    { outcome: 'handoff', frame },
    clock,
  )
  // Pausa: cancela rascunho em curso para o spinner da lista sumir no refetch.
  // SQL directo (evita import circular com autodraft.ts).
  db.run(
    `DELETE FROM ai_autodraft_jobs WHERE tenant_id = ? AND conversation_id = ?`,
    tenantId,
    input.conversationId,
  )
  // DEC-087: humano activo — cancela idle automático.
  db.run(
    `UPDATE conversations
     SET idle_due_at = NULL, idle_phase = NULL, idle_prompt_sent_at = NULL
     WHERE tenant_id = ? AND id = ?`,
    tenantId,
    input.conversationId,
  )
  const conv = db.get<{ contact_id: string }>(
    `SELECT contact_id FROM conversations WHERE tenant_id = ? AND id = ?`,
    tenantId,
    input.conversationId,
  )
  if (!conv) {
    const early: OutboxRow[] = []
    if (sessionEnd.outbox) early.push(sessionEnd.outbox)
    early.push(
      pauseEvent(db, tenantId, input.conversationId, true, clock, {
        source: 'handoff',
        handoffTimeoutAt,
      }),
    )
    return { already: false, sent: false, outbox: early }
  }
  const open = db.get<{ id: string; started_at: number }>(
    `SELECT id, started_at FROM pending_communications
     WHERE tenant_id = ? AND conversation_id = ? AND kind = 'alter_awaiting_team' AND status != 'resolved'
     LIMIT 1`,
    tenantId,
    input.conversationId,
  )
  if (!open) {
    const baseDetail = input.silent
      ? 'A cliente pediu para parar as mensagens automáticas. Sem resposta automática.'
      : input.reason === 'customer_requested'
        ? 'A cliente pediu atendimento humano.'
        : input.reason === 'human_only'
          ? 'Pedido que a IA não cumpre (cancelar, terceiro ou profissional fora do serviço). A equipe continua.'
          : input.reason === 'payment_proof'
            ? 'Possível comprovativo de pagamento (imagem ou documento). A equipe confirma.'
            : input.reason === 'media_after_ask'
              ? 'A cliente enviou outra mídia depois do pedido para escrever. A equipe continua.'
              : 'A mensagem saiu do agendamento. A IA ficou pausada.'
    // Prática 10 / #512: o alerta leva o quadro (serviço, zonas, hora) já entendido.
    const detail = withUnderstoodFrame(db, tenantId, input.conversationId, baseDetail)
    openPendingCommunication(
      db,
      {
        tenantId,
        conversationId: input.conversationId,
        contactId: conv.contact_id,
        proposalId: null,
        kind: 'alter_awaiting_team',
        detailText: detail,
      },
      clock,
    )
  } else {
    db.run(
      `UPDATE pending_communications
       SET status = 'alerted', alerted_at = COALESCE(alerted_at, ?), updated_at = ?
       WHERE tenant_id = ? AND id = ?`,
      now,
      now,
      tenantId,
      open.id,
    )
  }
  const outbox: OutboxRow[] = []
  if (sessionEnd.outbox) outbox.push(sessionEnd.outbox)
  const pausePayload = {
    source: 'handoff' as const,
    handoffTimeoutAt,
  }
  if (input.silent) {
    clearAiAssignee(db, tenantId, input.conversationId, clock)
    outbox.push(pauseEvent(db, tenantId, input.conversationId, true, clock, pausePayload))
    return { already: false, sent: false, outbox }
  }
  const handoffBody = humanHandoffBody(db, tenantId, clock)
  const alreadySaid = open
    ? db.get<{ id: string }>(
        `SELECT id FROM messages
         WHERE tenant_id = ? AND conversation_id = ? AND direction = 'outbound'
           AND body LIKE ? AND created_at >= ?
         LIMIT 1`,
        tenantId,
        input.conversationId,
        `${HUMAN_HANDOFF_PREFIX}%`,
        open.started_at,
      )
    : undefined
  let sent = false
  if (alreadySaid) {
    clearAiAssignee(db, tenantId, input.conversationId, clock)
    outbox.push(pauseEvent(db, tenantId, input.conversationId, true, clock, pausePayload))
    return { already: false, sent: false, outbox }
  }
  try {
    const result = sendOutboundMessageOp(
      db,
      workerCaller(tenantId, AI_ASSIGNEE),
      {
        conversationId: input.conversationId,
        body: handoffBody,
        clientRequestId: input.clientRequestId,
        authorClerkUserId: AI_ASSIGNEE,
        authorDisplayName: 'IA',
      },
      clock,
    )
    sent = true
    outbox.push(...result.outbox)
  } catch (err) {
    if (!(err instanceof ClinicError)) throw err
  }
  clearAiAssignee(db, tenantId, input.conversationId, clock)
  outbox.push(pauseEvent(db, tenantId, input.conversationId, true, clock, pausePayload))
  return { already: false, sent, outbox }
}
