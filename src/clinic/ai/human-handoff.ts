/**
 * Pausa da IA e frase fixa quando a cliente pede uma pessoa ou sai do agendamento (DEC-083).
 * Não chama o modelo. Não marca horário. Uma mensagem já pausada não gera outra frase.
 *
 * DEC-155: timeout 30 min sem Assumir → devolver à IA + aviso curto;
 * fora do expediente: pedido registado, IA activa; botão «Falar com a equipe» nas interactivas (21/11/2026).
 */
import type { SendOutboundInteractiveInput } from '../inbox/types'
/** Limites da lista interativa da Meta (linhas e título da linha). */
const META_LIST_MAX_ROWS = 10
const META_LIST_ROW_TITLE_MAX = 24
import { AI_ACTOR_ID, AI_ACTOR_NAME } from '../ai-actor'
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
import { flagConversationForTeamHandoff } from '../inbox/review-flag'
import { openPendingCommunication } from '../proposals/pending-communication'
import { clinicCivilDateFromUtc, zonedCivilToUtc } from '../scheduling/timezone'
import { dayTextPt } from './slot-offer'
import type { ClinicDb } from '../store'
import {
  isCancelRequest,
  isGreetingOnly,
  isRescheduleRequest,
} from '../../clientweb/route-intent'
import {
  HEALTH_RE,
  OFF_TOPIC_RE,
  PIX_OFF_PURPOSE_RE,
  classifySensitive,
  hasAiTransparencyQuestion,
  hasPolicyQuestion,
  hasStopRequest,
  wantsHumanPause,
  wantsHumanText,
} from './nlu/sensitive'
import { MISUNDERSTANDING_ESCALATION_TEXT } from './misunderstanding-streak'
import { endBookingSession, getOpenBookingSession } from './booking-session'
import { sayAct } from './dialogue-acts'
import { formatOpeningHours } from './schedule-context'
import {
  recordAttendantMetricsForOpenSession,
  resolveAttendantRequestSource,
} from '../../conversation-metrics/attendant-metrics'
import type { AttendantRequestSource } from '../../conversation-metrics/types'
import { getBookingFrame } from './schedule-session'
import { isCatalogInfoAsk, isShortBookingAffirm } from './booking-intent-text'

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

const AI_ASSIGNEE = AI_ACTOR_ID

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

/** Copy única: expediente aberto (Paulo 16/11/2026, item 6). */
export const HUMAN_TEAM_ACCESS_IN_HOURS_COPY =
  'No horário da equipe, ao tocar em Falar com a equipe ou pedir por texto, a equipe assume daqui.'

/** Copy única: fora do expediente — pedido registado, IA continua (Paulo 16/11/2026, item 6). */
export const HUMAN_TEAM_ACCESS_AFTER_HOURS_COPY =
  'Fora do horário registo o pedido; a equipe responde na próxima abertura e continuo por aqui até lá. Para pedir de novo, toque em Falar com a equipe ou escreva.'

/** Título da secção extra (≤24) quando a lista já tem secções tituladas. */
export const HUMAN_TEAM_LIST_SECTION_TITLE = 'Atendimento'

function clipListTitle(title: string): string {
  const t = title.trim()
  if (t.length <= META_LIST_ROW_TITLE_MAX) return t
  return `${t.slice(0, Math.max(1, META_LIST_ROW_TITLE_MAX - 1)).trimEnd()}…`
}

/** Explica o que acontece ao pedir a equipe (expediente vs fora). */
export function humanTeamAccessExplanation(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
): string {
  if (isHumanTeamOfferAllowed(db, tenantId, clock)) {
    return HUMAN_TEAM_ACCESS_IN_HOURS_COPY
  }
  const opening = nextClinicOpening(db, tenantId, clock)
  if (opening) {
    return `Fora do horário registo o pedido; a equipe responde a partir de ${opening.dayLabel} às ${opening.time}, aqui mesmo, e continuo por aqui até lá. Para pedir de novo, toque em Falar com a equipe ou escreva.`
  }
  return HUMAN_TEAM_ACCESS_AFTER_HOURS_COPY
}

function interactiveHasHumanTeam(
  interactive: SendOutboundInteractiveInput | null | undefined,
): boolean {
  if (!interactive) return false
  if (interactive.buttons?.some((b) => b.id === HUMAN_HANDOFF_BUTTON_ID)) return true
  const rows = interactive.list?.sections.flatMap((s) => s.rows ?? []) ?? []
  return rows.some((r) => r.id === HUMAN_HANDOFF_BUTTON_ID)
}

/**
 * Garante botão/linha «Falar com a equipe» nas interactivas (≤3 botões / ≤10 linhas lista).
 * Paulo 16/11/2026 — item 6 / rsamp_f72ce5908371eff3a9757281.
 */
export function augmentOutboundWithHumanTeam(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
  input: { body: string; interactive?: SendOutboundInteractiveInput | null },
): { body: string; interactive?: SendOutboundInteractiveInput | null } {
  void db
  void tenantId
  void clock
  const body = input.body
  const interactive = input.interactive
  if (!interactive?.buttons?.length && !interactive?.list?.sections?.length) {
    return { body, interactive: interactive ?? null }
  }
  if (interactiveHasHumanTeam(interactive)) {
    return { body, interactive }
  }
  const human = { id: HUMAN_HANDOFF_BUTTON_ID, title: HUMAN_HANDOFF_BUTTON_TITLE }
  if (interactive.buttons?.length) {
    if (interactive.buttons.length >= 3) {
      return { body, interactive }
    }
    return { body, interactive: { ...interactive, buttons: [...interactive.buttons, human] } }
  }
  if (interactive.list) {
    const rows = interactive.list.sections.flatMap((s) => s.rows ?? [])
    if (rows.length >= META_LIST_MAX_ROWS) {
      return { body, interactive }
    }
    const humanRow = { id: HUMAN_HANDOFF_BUTTON_ID, title: clipListTitle(HUMAN_HANDOFF_BUTTON_TITLE) }
    const sections = [...interactive.list.sections]
    // Cloud API: com mais de uma secção, todas exigem `title` (senão 400/131009).
    // As listas de horários/serviços têm uma única secção sem título: a linha
    // humana entra nessa (última) secção em vez de abrir uma secção nova.
    const allTitled = sections.every((sec) => Boolean(sec.title?.trim()))
    if (allTitled) {
      sections.push({ title: HUMAN_TEAM_LIST_SECTION_TITLE, rows: [humanRow] })
    } else {
      const last = sections[sections.length - 1]!
      sections[sections.length - 1] = { ...last, rows: [...(last.rows ?? []), humanRow] }
    }
    return {
      body,
      interactive: {
        ...interactive,
        list: { ...interactive.list, sections },
      },
    }
  }
  return { body, interactive }
}

/** Registo + continuidade — baseline P3 (15/11/2026). */
export const AFTER_HOURS_HUMAN_REGISTERED_PREFIX = 'Deixei seu pedido para a equipe'

/** Linha curta de segurança — queixa de saúde antes do handoff (baseline P4 / 15/11/2026). */
export const HEALTH_SAFETY_LINE =
  'Se a dor for forte, súbita ou estiver piorando, procure um médico ou pronto-socorro.'

export const HANDOFF_PAUSED_ACK_TEXT =
  'Recebi sua mensagem. A equipe já foi avisada. Posso continuar te ajudando por aqui com o agendamento enquanto você espera.'

/** DEC-115 — transparência (neutra; persona com nome → ok Paulo). */
export const AI_TRANSPARENCY_TEXT =
  'Sou a assistente virtual da clínica. Se preferir, chamo a equipe.'

/** Origem do evento `conversation.ai_pause` — ganchos para alertas do painel (DEC-156). */
export type AiPauseEventSource = 'handoff' | 'timeout_resume' | 'manual_resume' | 'staff_takeover'

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
 * Evita import circular com `clientweb/hub`.
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

/** Botão reply «Falar com a equipe» (sempre disponível nas interactivas; click fora do expediente = DEC-155). */
export function humanTeamOfferButtons(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
): Array<{ id: string; title: string }> {
  void db
  void tenantId
  void clock
  return [{ id: HUMAN_HANDOFF_BUTTON_ID, title: HUMAN_HANDOFF_BUTTON_TITLE }]
}

/**
 * Pedido explícito de equipe fora do expediente (DEC-155): horário + IA activa.
 * Prefere a próxima abertura (como DEC-113); senão lista o expediente.
 */
/** Botões no pedido de equipe (inclui fora do expediente — registo sem pausar a IA). */
export function humanHelpRequestButtons(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
): Array<{ id: string; title: string }> {
  void db
  void tenantId
  void clock
  return [{ id: HUMAN_HANDOFF_BUTTON_ID, title: HUMAN_HANDOFF_BUTTON_TITLE }]
}

export function registerHumanHelpRequest(
  db: ClinicDb,
  tenantId: string,
  input: {
    conversationId: string
    detailText: string
    messageId?: string | null
  },
  clock: Clock,
): OutboxRow[] {
  const conv = db.get<{ contact_id: string }>(
    `SELECT contact_id FROM conversations WHERE tenant_id = ? AND id = ?`,
    tenantId,
    input.conversationId,
  )
  if (!conv) return []
  const now = clock.nowMs()
  const open = db.get<{ id: string }>(
    `SELECT id FROM pending_communications
     WHERE tenant_id = ? AND conversation_id = ? AND kind = 'alter_awaiting_team' AND status != 'resolved'
     LIMIT 1`,
    tenantId,
    input.conversationId,
  )
  if (!open) {
    const detail = withUnderstoodFrame(db, tenantId, input.conversationId, input.detailText)
    openPendingCommunication(
      db,
      {
        tenantId,
        conversationId: input.conversationId,
        contactId: conv.contact_id,
        proposalId: null,
        kind: 'alter_awaiting_team',
        detailText: detail,
        messageId: input.messageId ?? null,
      },
      clock,
    )
  } else {
    db.run(
      `UPDATE pending_communications
       SET status = 'alerted', alerted_at = COALESCE(alerted_at, ?), updated_at = ?,
           message_id = COALESCE(message_id, ?)
       WHERE tenant_id = ? AND id = ?`,
      now,
      now,
      input.messageId ?? null,
      tenantId,
      open.id,
    )
  }
  const flagged = flagConversationForTeamHandoff(
    db,
    tenantId,
    input.conversationId,
    clock,
    input.detailText.slice(0, 200),
  )
  return flagged.outbox
}

export function afterHoursHumanRequestBody(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
  conversationId = '',
): string {
  const opening = nextClinicOpening(db, tenantId, clock)
  if (opening) {
    return `${AFTER_HOURS_HUMAN_REGISTERED_PREFIX}; a equipe responde a partir de ${opening.dayLabel} às ${opening.time}, aqui mesmo, e continuo por aqui até lá.`
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
  return `${withHours}\n\n${humanTeamAccessExplanation(db, tenantId, clock)}`
}

/**
 * Responde ao pedido de equipe fora do expediente sem pausar (DEC-155).
 * Usado por texto, botão genérico e botão da proposta.
 */
export function replyAfterHoursHumanRequest(
  db: ClinicDb,
  tenantId: string,
  input: { conversationId: string; clientRequestId: string; messageId?: string | null },
  clock: Clock,
): { outbox: OutboxRow[] } {
  const outbox: OutboxRow[] = [
    ...registerHumanHelpRequest(
      db,
      tenantId,
      {
        conversationId: input.conversationId,
        detailText: 'A cliente pediu atendimento humano.',
        messageId: input.messageId ?? null,
      },
      clock,
    ),
  ]
  const buttons = humanHelpRequestButtons(db, tenantId, clock)
  try {
    const result = sendOutboundMessageOp(
      db,
      workerCaller(tenantId, AI_ASSIGNEE),
      {
        conversationId: input.conversationId,
        body: afterHoursHumanRequestBody(db, tenantId, clock, input.conversationId),
        interactive: buttons.length > 0 ? { buttons } : undefined,
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

const BOOKING_PROGRESS_WHILE_PAUSED_RE =
  /\b(quero|queria|gostaria|marcar|agendar|remarcar|botox|hor[aá]rio|vaga|axila|pernas?|depila|massagem|drenagem|feminin|masculin|zonas?)\b/i

const SERVICE_AVAILABILITY_WHILE_PAUSED_RE =
  /\b(?:tem|fazem|faz|voc[eê]s\s+t[eê]m|vcs\s+t[eê]m)\b[^.?\n]{0,48}\b(?:massagem|drenagem|depila|botox|servi[cç]o)/i

const DAY_TIME_WHILE_PAUSED_RE =
  /\b(amanh[aã]|hoje|segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo|manh[aã]|tarde|noite)\b/i

const CLOCK_WHILE_PAUSED_RE =
  /(?:^|[^a-z0-9])(?:[aà]s\s+\d{1,2}(?:h(?:rs|s)?(?:\d{2})?)?|\d{1,2}[:h]\d{2}|\d{3,4})\b/i

/** Cliente insiste só em humano, sem seguir o agendamento (lab S03a / regressão 16/11). */
export const HUMAN_ONLY_ESCALATION_RE =
  /\b(?:s[oó]|somente|apenas)\s+(?:quero|queria|gostaria|preciso)(?:\s+de)?\s+(?:falar\s+(?:com\s+)?)?(?:uma\s+)?(?:pessoa|humano|humana|atendente|algu[eé]m|equipe)\b/i

export function wantsHumanOnlyEscalation(text: string): boolean {
  const body = text.trim()
  if (!body) return false
  return HUMAN_ONLY_ESCALATION_RE.test(body) || HUMAN_ONLY_ESCALATION_RE.test(foldEscalation(body))
}

function foldEscalation(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function hasBookingFrameProgress(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
): boolean {
  const frame = getBookingFrame(db, tenantId, conversationId)
  return Boolean(frame?.serviceId || frame?.line || frame?.variantIds?.length || frame?.date || frame?.time)
}

/** Pausas automáticas que podem retomar com intenção clara de marcar (baseline P4). */
export function inboundWarrantsHandoffResume(
  text: string,
  reason: AiReplyPauseReason,
): boolean {
  const body = text.trim()
  if (!body) return false
  if (reason === 'staff_active') return false
  if (reason === 'customer_requested' || reason === 'human_only') return false
  if (reason !== 'off_purpose') return false
  return BOOKING_PROGRESS_WHILE_PAUSED_RE.test(body)
}

/**
 * Em horário de equipe: manter alerta/pausa DEC-083 mas continuar automação
 * de agendamento ou catálogo (regressão S03a / S08a, staging 16/11).
 */
export function inboundWarrantsParallelHandoffAutomation(
  text: string,
  reason: AiReplyPauseReason,
  opts: {
    db: ClinicDb
    tenantId: string
    conversationId: string
    fromInteractive?: boolean
  },
): boolean {
  const body = text.trim()
  if (!body) return false
  if (reason === 'staff_active') return false
  if (wantsHumanOnlyEscalation(body)) return false
  if (opts.fromInteractive) return true
  const frameProgress = hasBookingFrameProgress(opts.db, opts.tenantId, opts.conversationId)
  const openSession = getOpenBookingSession(opts.db, opts.tenantId, opts.conversationId) != null

  if (reason === 'customer_requested') {
    if (wantsHumanText(body) && !BOOKING_PROGRESS_WHILE_PAUSED_RE.test(body) && !isShortBookingAffirm(body)) {
      return false
    }
    if (openSession || frameProgress) return true
    if (isShortBookingAffirm(body) || isCatalogInfoAsk(body)) return true
    if (
      BOOKING_PROGRESS_WHILE_PAUSED_RE.test(body) ||
      DAY_TIME_WHILE_PAUSED_RE.test(body) ||
      CLOCK_WHILE_PAUSED_RE.test(body)
    ) {
      return true
    }
    return false
  }

  if (reason === 'off_purpose') {
    if (inboundWarrantsHandoffResume(body, reason)) return true
    if (isCatalogInfoAsk(body) || SERVICE_AVAILABILITY_WHILE_PAUSED_RE.test(body)) return true
    return false
  }

  return false
}

const PARALLEL_HANDOFF_AUTOMATION_REASONS = new Set<AiReplyPauseReason>([
  'customer_requested',
  'off_purpose',
])

/** Autobook/confirmação automática com alerta de equipe aberto (só expediente). */
export function parallelHandoffAllowsAutomation(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  clock: Clock,
  reason: AiReplyPauseReason,
): boolean {
  if (!PARALLEL_HANDOFF_AUTOMATION_REASONS.has(reason)) return false
  if (!isHumanTeamOfferAllowed(db, tenantId, clock)) return false
  if (reason === 'customer_requested') return true
  return (
    getOpenBookingSession(db, tenantId, conversationId) != null ||
    hasBookingFrameProgress(db, tenantId, conversationId)
  )
}

/** Evita silêncio após handoff quando a cliente escreve de novo. */
export function shouldAcknowledgeWhileHandoffPaused(reason: AiReplyPauseReason): boolean {
  if (reason === 'staff_active') return false
  return reason === 'off_purpose' || reason === 'customer_requested'
}

export function replyMisunderstandingEscalation(
  db: ClinicDb,
  tenantId: string,
  input: { conversationId: string; clientRequestId: string; messageId?: string | null },
  clock: Clock,
): { outbox: OutboxRow[] } {
  const outbox: OutboxRow[] = [
    ...registerHumanHelpRequest(
      db,
      tenantId,
      {
        conversationId: input.conversationId,
        detailText: 'A IA não entendeu a cliente duas vezes seguidas. Pedido de equipe registrado.',
        messageId: input.messageId ?? null,
      },
      clock,
    ),
  ]
  const misunderstandingSource = resolveAttendantRequestSource(undefined, input.clientRequestId)
  if (misunderstandingSource === 'offered_misunderstanding_rule') {
    recordAttendantMetricsForOpenSession(db, tenantId, input.conversationId, {
      source: misunderstandingSource,
      recognized: true,
      registered: true,
    })
  }
  const buttons = humanHelpRequestButtons(db, tenantId, clock)
  try {
    const sent = sendOutboundMessageOp(
      db,
      workerCaller(tenantId, AI_ASSIGNEE),
      {
        conversationId: input.conversationId,
        body: MISUNDERSTANDING_ESCALATION_TEXT,
        interactive: buttons.length > 0 ? { buttons } : undefined,
        clientRequestId: input.clientRequestId,
        authorClerkUserId: AI_ASSIGNEE,
        authorDisplayName: 'IA',
      },
      clock,
    )
    outbox.push(...sent.outbox)
  } catch (err) {
    if (!(err instanceof ClinicError)) throw err
  }
  return { outbox }
}

export function replyWhileHandoffPaused(
  db: ClinicDb,
  tenantId: string,
  input: { conversationId: string; clientRequestId: string },
  clock: Clock,
): { outbox: OutboxRow[] } {
  const outbox: OutboxRow[] = []
  try {
    const sent = sendOutboundMessageOp(
      db,
      workerCaller(tenantId, AI_ASSIGNEE),
      {
        conversationId: input.conversationId,
        body: HANDOFF_PAUSED_ACK_TEXT,
        interactive: (() => {
          const buttons = humanTeamOfferButtons(db, tenantId, clock)
          return buttons.length > 0 ? { buttons } : humanHelpRequestButtons(db, tenantId, clock).length
            ? { buttons: humanHelpRequestButtons(db, tenantId, clock) }
            : undefined
        })(),
        clientRequestId: input.clientRequestId,
        authorClerkUserId: AI_ASSIGNEE,
        authorDisplayName: 'IA',
      },
      clock,
    )
    outbox.push(...sent.outbox)
  } catch (err) {
    if (!(err instanceof ClinicError)) throw err
  }
  return { outbox }
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
 * Assumir / Devolver à IA / Terminar limpam `ai_handoff_timeout_at` (e o alerta) antes;
 * se alguém Assumiu ou a cliente terminou, não chega aqui.
 *
 * Exige `alter_awaiting_team` ainda aberto/alertado: o Terminar resolve o alerta via
 * `resumeAiReply`. Se o alarme do DO disparar com estado parcial (pausa/timeout
 * órfãos após cancelamento), não envia «A equipe não conseguiu…».
 */
export function sweepDueHandoffTimeouts(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
): Array<{ conversationId: string; outbox: OutboxRow[] }> {
  const now = clock.nowMs()
  const due = db.all<{ id: string }>(
    `SELECT c.id AS id FROM conversations c
     WHERE c.tenant_id = ? AND c.ai_handoff_timeout_at IS NOT NULL AND c.ai_handoff_timeout_at <= ?
       AND c.ai_reply_paused_at IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM pending_communications pc
         WHERE pc.tenant_id = c.tenant_id
           AND pc.conversation_id = c.id
           AND pc.kind = 'alter_awaiting_team'
           AND pc.status != 'resolved'
       )
     ORDER BY c.ai_handoff_timeout_at ASC
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
  /** Equipe humana assumiu / enviou — a IA não responde à cliente até Devolver à IA. */
  | 'staff_active'

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
        dayLabel: dayTextPt(date, today),
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

/**
 * Congela respostas automáticas da IA enquanto um humano é responsável (Assumir / envio manual).
 * Não envia WhatsApp; cancela jobs de autodraft pendentes.
 */
export function pauseAiForStaffTakeover(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  clock: Clock,
): OutboxRow[] {
  const now = clock.nowMs()
  db.run(
    `UPDATE conversations
     SET ai_reply_paused_at = ?, ai_reply_pause_reason = ?,
         ai_handoff_timeout_at = NULL, updated_at = ?
     WHERE tenant_id = ? AND id = ?`,
    now,
    'staff_active',
    now,
    tenantId,
    conversationId,
  )
  db.run(
    `DELETE FROM ai_autodraft_jobs WHERE tenant_id = ? AND conversation_id = ?`,
    tenantId,
    conversationId,
  )
  return [
    pauseEvent(db, tenantId, conversationId, true, clock, {
      source: 'staff_takeover',
      handoffTimeoutAt: null,
    }),
  ]
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
    assigneeDisplayName: AI_ACTOR_NAME,
    updatedAt: now,
  })
  syncOpenOpportunityAssignee(db, {
    tenantId,
    conversationId,
    assigneeClerkUserId: AI_ASSIGNEE,
    assigneeDisplayName: AI_ACTOR_NAME,
    updatedAt: now,
  })
  return [
    pauseEvent(db, tenantId, conversationId, false, clock, {
      assigneeClerkUserId: AI_ASSIGNEE,
      assigneeDisplayName: AI_ACTOR_NAME,
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
  // DEC-202: abertura e pedidos de remarcar/cancelar próprios seguem no autodraft, não pausam aqui.
  if (isGreetingOnly(body)) return null
  if (isCancelRequest(body) || isRescheduleRequest(body)) return null
  const hits = classifySensitive(body)
  // CF-04: pergunta condicional sobre política não pausa (responde a política no autodraft).
  if (hasPolicyQuestion(hits)) return null
  // DEC-115: transparência — autodraft responde sem pausar.
  if (hasAiTransparencyQuestion(hits)) return null
  // DEC-114: stop — autodraft pausa em silêncio (sem frase).
  if (hasStopRequest(hits)) return 'customer_requested'
  if (!wantsHumanPause(hits) && !OFF_TOPIC_RE.test(body) && !PIX_OFF_PURPOSE_RE.test(body)) {
    if (professionalOutsideService(db, tenantId, body, clock, turn)) return 'human_only'
    // DEC-202: remarcar e cancelar não passam à equipe; o autodraft envia o link «Abrir agenda».
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
  // DEC-202: cancelar tem o link «Abrir agenda»; só passa à equipe se o link não puder sair.
  if (hits.some((h) => h.label === 'cancelar') && isCancelRequest(body)) return null
  if (hits.some((h) => h.label === 'terceiro') || professionalOutsideService(db, tenantId, body, clock)) {
    return 'human_only'
  }
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
    /** Última mensagem da cliente (linha de segurança em queixa de saúde). */
    inboundText?: string | null
    /**
     * Integração métricas: `offered_misunderstanding_rule` quando a regra de
     * 2 incompreensões oferecer atendente (PR paralelo). Default: spontaneous.
     */
    attendantSource?: AttendantRequestSource
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
  const openSession = getOpenBookingSession(db, tenantId, input.conversationId)
  const attendantSource = resolveAttendantRequestSource(
    input.attendantSource,
    input.clientRequestId,
  )
  if (input.reason === 'customer_requested' || attendantSource === 'offered_misunderstanding_rule') {
    recordAttendantMetricsForOpenSession(db, tenantId, input.conversationId, {
      source: attendantSource,
      recognized: !input.silent,
      registered: Boolean(
        db.get<{ id: string }>(
          `SELECT id FROM pending_communications
           WHERE tenant_id = ? AND conversation_id = ? AND kind = 'alter_awaiting_team'
             AND status != 'resolved' LIMIT 1`,
          tenantId,
          input.conversationId,
        ),
      ),
    })
  }
  // DEC-148 / T1: handoff (DEC-083) fecha a sessão de marcação com outcome handoff.
  const frame = getBookingFrame(db, tenantId, input.conversationId)
  // Pedido explícito de equipe: mantém o quadro para retomar o passo (baseline P3).
  const sessionEnd =
    input.reason === 'customer_requested'
      ? { outbox: undefined as OutboxRow | undefined }
      : endBookingSession(
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
  if (!open) {
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
    if (
      openSession &&
      (input.reason === 'customer_requested' || attendantSource === 'offered_misunderstanding_rule')
    ) {
      try {
        db.run(
          `UPDATE booking_sessions SET attendant_registered = attendant_registered + 1
           WHERE session_id = ?`,
          openSession.sessionId,
        )
      } catch {
        /* migração 0072 ausente em harness legado */
      }
    }
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
  const panelFlag = flagConversationForTeamHandoff(
    db,
    tenantId,
    input.conversationId,
    clock,
    baseDetail.slice(0, 200),
  )
  const outbox: OutboxRow[] = [...panelFlag.outbox]
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
  let handoffBody = humanHandoffBody(db, tenantId, clock)
  const inbound = (input.inboundText ?? '').trim()
  if (input.reason === 'off_purpose' && inbound && HEALTH_RE.test(inbound)) {
    handoffBody = `${HEALTH_SAFETY_LINE}\n\n${handoffBody}`
  }
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
