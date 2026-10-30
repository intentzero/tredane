/**
 * Agendamento pela IA após confirmação explícita da própria cliente
 * (decidido por Paulo, 28/10/2026 — ver DEC-006 / DEC-056 em docs/product/decisions.md).
 *
 * Regra: o backend envia a proposta quando dia, horário e procedimento ficam determinados
 * sem ambiguidade. Cada elemento vem da vez atual da cliente ou, se ela não o repetir,
 * da mensagem mais recente que cite um único valor (não só a bolha imediatamente anterior).
 * «1530» conta como 15:30. Faltou ou ficou ambíguo → não envia proposta. Detecção
 * determinística, sem o modelo.
 *
 * S2 (#173, épico #171): esta leitura de texto livre NUNCA marca — só produz nota para a atendente.
 * Com a capacidade ligada (sempre, salvo pausa da owner), o backend monta e envia a proposta
 * versionada com botão WhatsApp (S3–S4). A marcação/Pix fica no clique autenticado (S5 #176 /
 * DEC-061: `executeProposalConfirmOp`). Serviço com sinal: Pix sem hold (DEC-047); horário só
 * após pagamento (#39).
 */
import type { Clock } from '../../db/clock'
import { AI_AUTOBOOK_ACTOR } from '../constants'
import { getContact } from '../contacts'
import { listServices } from '../config/services'
import { quoteVisit, zonesNamedInText } from '../config/zones'
import { ensureClinicSettings } from '../config/settings'
import type { ServiceRow } from '../config/types'
import type { ClinicCaller } from '../envelopes'
import { getConversation } from '../inbox/conversations'
import type { OutboxRow } from '../outbox'
import { createProposal } from '../proposals/proposals'
import { sendProposalToWhatsAppOp } from '../proposals/send'
import { queryAvailability } from '../scheduling/query'
import { clinicCivilDateFromUtc } from '../scheduling/timezone'
import type { ClinicDb } from '../store'
import type { AbuseLimits } from './abuse-limits'
import { checkConversationProtection } from './protection'

export const AI_AUTOBOOK_ACTOR_ID = AI_AUTOBOOK_ACTOR
export const AI_AUTOBOOK_ACTOR_NAME = 'IA (agendamento automático)'

export type AutoBookStatus =
  | 'booked'
  | 'needs_info'
  | 'ambiguous'
  | 'not_confirmed'
  | 'unavailable'
  | 'requires_button'
  | 'blocked'
  | 'needs_signal'
  | 'disabled'

export type AutoBookOutcome = {
  status: AutoBookStatus
  /** Elementos em falta ou ambíguos (para a nota interna). */
  missing: Array<'dia' | 'horario' | 'procedimento'>
  confirmationMessageId: string | null
  serviceId?: string
  date?: string
  time?: string
  appointmentId?: string
  /** Proposta criada/enviada quando a capacidade está ligada (S3–S4). */
  proposalId?: string
  proposalVersion?: number
  /** Texto determinístico para o rascunho (substitui o do modelo), quando aplicável. */
  replyText?: string
  notes?: string
  outbox: OutboxRow[]
}

const WEEKDAY_NAMES: Array<[RegExp, number]> = [
  [/\bsegunda\b/, 1],
  [/\bterca\b/, 2],
  [/\bquarta\b/, 3],
  [/\bquinta\b/, 4],
  [/\bsexta\b/, 5],
  [/\bsabado\b/, 6],
  [/\bdomingo\b/, 7],
]
const WEEKDAY_LABEL = ['', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo']

export function norm(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return js === 0 ? 7 : js
}

/** Datas civis (YYYY-MM-DD) citadas no texto, relativas a `today`. */
export function extractDates(text: string, today: string): Set<string> {
  const t = norm(text)
  const out = new Set<string>()
  const [ty, tm] = today.split('-').map(Number) as [number, number, number]
  for (const m of t.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g)) {
    const d = Number(m[1])
    const mo = Number(m[2])
    if (d < 1 || d > 31 || mo < 1 || mo > 12) continue
    let y = m[3] ? Number(m[3]) : ty
    if (y < 100) y += 2000
    let iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    if (!m[3] && iso < today) iso = `${y + 1}${iso.slice(4)}`
    out.add(iso)
  }
  for (const m of t.matchAll(/\bdia\s+(\d{1,2})\b(?!\s*\/)/g)) {
    const d = Number(m[1])
    if (d < 1 || d > 31) continue
    let iso = `${ty}-${String(tm).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    if (iso < today) {
      const ny = tm === 12 ? ty + 1 : ty
      const nm = tm === 12 ? 1 : tm + 1
      iso = `${ny}-${String(nm).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    }
    out.add(iso)
  }
  if (/\bdepois de amanha\b/.test(t)) out.add(addDays(today, 2))
  else if (/\bamanha\b/.test(t)) out.add(addDays(today, 1))
  if (/\bhoje\b/.test(t)) out.add(today)
  for (const [re, dow] of WEEKDAY_NAMES) {
    if (!re.test(t)) continue
    let diff = (dow - weekdayOf(today) + 7) % 7
    // «quinta» dito numa quinta = próxima semana só se não houver outra pista; usa hoje.
    if (diff < 0) diff += 7
    out.add(addDays(today, diff))
  }
  return out
}

/** Horários HH:MM citados («15h», «15:00», «15h30», «às 15»). */
export function extractTimes(text: string): Set<string> {
  const t = norm(text)
  const out = new Set<string>()
  const add = (h: number, m: number) => {
    if (h > 23 || m > 59) return
    out.add(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
  }
  for (const m of t.matchAll(
    /\b([01]?\d|2[0-3])(?::([0-5]\d)|\s?h(?:rs|s)?(?:\s?([0-5]\d))?)(?![\d/a-z])/g,
  )) {
    add(Number(m[1]), Number(m[2] ?? m[3] ?? 0))
  }
  for (const m of t.matchAll(/\bas\s+([01]?\d|2[0-3])\b(?![:h\d/])/g)) add(Number(m[1]), 0)
  // «1530» = 15:30. Não casa o ano em «30/10/2026» nem um valor depois de «r$».
  for (const m of t.matchAll(/(?<![\d/])(?<!r\$\s*)\b([01]\d|2[0-3])([0-5]\d)\b(?![\d/,])/g)) {
    add(Number(m[1]), Number(m[2]))
  }
  return out
}

function significantWords(name: string): string[] {
  return norm(name)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3)
}

/**
 * Serviços activos cujo nome inteiro (todas as palavras) aparece no texto.
 * Sem filtro de audiência aqui: «masculina»/«feminina» no nome do serviço
 * (ex.: «Depilação masculina amanhã…») não é pedido de linha da cliente.
 * O filtro de audiência fica no catálogo da IA (`buildAiContextPayload`).
 */
export function extractServices(text: string, services: ServiceRow[]): ServiceRow[] {
  const words = new Set(norm(text).split(/[^a-z0-9]+/).filter(Boolean))
  const hits = services.filter((s) => {
    const sw = significantWords(s.name)
    return sw.length > 0 && sw.every((w) => words.has(w))
  })
  // «depilação masculina» citado ⇒ «depilação» (subconjunto) não conta como alternativa.
  return hits.filter(
    (s) =>
      !hits.some(
        (o) =>
          o.id !== s.id
          && significantWords(o.name).length > significantWords(s.name).length
          && significantWords(s.name).every((w) => significantWords(o.name).includes(w)),
      ),
  )
}

const AFFIRMATIVE =
  /\b(sim|pode ser|pode marcar|pode agendar|pode|confirmo|confirmado|confirma|fechado|combinado|quero|isso|ok|okay|perfeito|beleza|blz|otimo|bora|marca|marcar|agenda|agendar|serve|fica bom|esta otimo|ta bom|ta otimo|certo)\b/
const NEGATIVE_OR_HESITANT =
  /\b(nao|talvez|acho|sera|depois|ver|vou ver|pensar|outro|outra|mais tarde|ou)\b|\?/
const RESCHEDULE = /\b(remarc\w*|desmarc\w*|cancel\w*|mudar|trocar|adiar)\b/

type Msg = { id: string; direction: string; body: string; created_at: number }

export function detectExplicitConfirmation(input: {
  clientTexts: string[]
  previousClinicText: string | null
  /** Mensagens mais antigas, da mais recente para a mais antiga, fora da vez atual. */
  historyTexts?: string[]
  clientToday: string
  clinicToday: string
  services: ServiceRow[]
}): {
  ok: boolean
  status: AutoBookStatus
  missing: Array<'dia' | 'horario' | 'procedimento'>
  date?: string
  time?: string
  service?: ServiceRow
} {
  const client = input.clientTexts.join('\n')
  const c = norm(client)
  const prev = input.previousClinicText ?? ''
  if (RESCHEDULE.test(c)) return { ok: false, status: 'not_confirmed', missing: [] }
  if (NEGATIVE_OR_HESITANT.test(c.replace(/\bdepois de amanha\b/g, 'amanha'))) return { ok: false, status: 'ambiguous', missing: [] }

  const cDates = extractDates(client, input.clientToday)
  const cTimes = extractTimes(client)
  const cServices = extractServices(client, input.services)
  const pDates = extractDates(prev, input.clinicToday)
  const pTimes = extractTimes(prev)
  const pServices = extractServices(prev, input.services)

  const affirmative = AFFIRMATIVE.test(c)
  // «sim/pode ser…» OU a cliente escolhe o horário («15h», «1530»).
  if (!affirmative && cTimes.size === 0) return { ok: false, status: 'not_confirmed', missing: [] }

  const missing: Array<'dia' | 'horario' | 'procedimento'> = []
  let ambiguous = false
  const history = input.historyTexts ?? []
  const resolve = <T,>(
    own: T[],
    prior: T[],
    label: 'dia' | 'horario' | 'procedimento',
    fromText: (text: string) => T[],
  ): T | undefined => {
    if (own.length === 1) return own[0]
    if (own.length > 1) { ambiguous = true; missing.push(label); return undefined }
    if (prior.length === 1) return prior[0]
    if (prior.length > 1) { ambiguous = true; missing.push(label); return undefined }
    for (const text of history) {
      const found = fromText(text)
      if (found.length === 1) return found[0]
      if (found.length > 1) { ambiguous = true; missing.push(label); return undefined }
    }
    missing.push(label)
    return undefined
  }
  const date = resolve([...cDates], [...pDates], 'dia', (text) => [...extractDates(text, input.clinicToday)])
  const time = resolve([...cTimes], [...pTimes], 'horario', (text) => [...extractTimes(text)])
  const service = resolve(cServices, pServices, 'procedimento', (text) => extractServices(text, input.services))
  if (missing.length > 0) {
    return { ok: false, status: ambiguous ? 'ambiguous' : 'needs_info', missing }
  }
  return { ok: true, status: 'booked', missing: [], date, time, service }
}

function firstName(label: string | null | undefined): string | null {
  const f = label?.trim().split(/\s+/)[0]
  return f ? f : null
}

function dayText(date: string): string {
  const [, m, d] = date.split('-')
  return `${WEEKDAY_LABEL[weekdayOf(date)]} ${d}/${m}`
}

function localHHMM(tz: string, ms: number): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(ms))
}

function signalAmountCents(svc: ServiceRow, priceCents: number | null = svc.priceCents): number | null {
  if (!svc.requiresSignal) return null
  if (svc.signalKind === 'fixed' && svc.signalFixedCents != null) return svc.signalFixedCents
  if (svc.signalKind === 'percent' && svc.signalPercent != null && priceCents != null) {
    return Math.trunc((priceCents * svc.signalPercent) / 100)
  }
  return null
}

function brl(cents: number): string {
  const v = (cents / 100).toFixed(2).split('.')
  return `R$ ${v[0]!.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${v[1]}`
}

/**
 * Tenta marcar pela IA para a conversa. Não lança: devolve o resultado.
 * Idempotente por mensagem de confirmação (clientRequestId = ai-autobook:<messageId>).
 */
export function tryAiAutoBook(
  db: ClinicDb,
  caller: ClinicCaller,
  clock: Clock,
  input: {
    conversationId: string
    suggestionId?: string | null
    enabled?: boolean
    /**
     * Capacidade efetiva (ligada, salvo pausa da owner).
     * Texto livre nunca marca; com capacidade ligada o backend envia a proposta/botão.
     */
    capability?: boolean
    /** Limites S7 ao criar proposta (opcional). */
    abuseLimits?: AbuseLimits
  },
): AutoBookOutcome {
  const tenantId = caller.tenantId
  const none = (status: AutoBookStatus, extra: Partial<AutoBookOutcome> = {}): AutoBookOutcome => ({
    status,
    missing: [],
    confirmationMessageId: null,
    outbox: [],
    ...extra,
  })
  if (input.enabled === false) return none('disabled')
  // Proteção (#182): contato bloqueado ou conversa em pausa → nenhuma ação nova.
  const guard = checkConversationProtection(db, tenantId, input.conversationId)
  if (!guard.allowed) return none('blocked', { notes: `Ação automática negada (${guard.reason}).` })
  const conv = getConversation(db, tenantId, input.conversationId)
  if (!conv) return none('not_confirmed')
  const settings = ensureClinicSettings(db, tenantId, clock)
  const tz = settings.timezone || 'America/Sao_Paulo'

  const recent = db
    .all<Msg>(
      `SELECT id, direction, body, created_at FROM messages
       WHERE tenant_id = ? AND conversation_id = ? AND direction IN ('inbound', 'outbound')
       ORDER BY created_at DESC, id DESC LIMIT 20`,
      tenantId,
      input.conversationId,
    )
  const clientTurn: Msg[] = []
  let prevClinic: Msg | null = null
  const older: Msg[] = []
  for (const m of recent) {
    if (!prevClinic) {
      if (m.direction === 'inbound') {
        clientTurn.push(m)
      } else if (clientTurn.length > 0) {
        prevClinic = m
      } else {
        return none('not_confirmed') // a clínica falou por último
      }
    } else {
      older.push(m)
    }
  }
  if (clientTurn.length === 0) return none('not_confirmed')
  clientTurn.reverse()
  const confirmation = clientTurn[clientTurn.length - 1]!

  const services = listServices(db, tenantId).filter((s) => s.active)
  const det = detectExplicitConfirmation({
    clientTexts: clientTurn.map((m) => m.body),
    previousClinicText: prevClinic?.body ?? null,
    historyTexts: older.map((m) => m.body),
    clientToday: clinicCivilDateFromUtc(tz, confirmation.created_at),
    clinicToday: clinicCivilDateFromUtc(tz, prevClinic?.created_at ?? confirmation.created_at),
    services,
  })
  const base = { confirmationMessageId: confirmation.id, missing: det.missing }
  const contact = getContact(db, tenantId, conv.contactId)
  const name = firstName(contact?.displayName)
  const hi = name ? `, ${name}` : ''
  if (!det.ok || !det.service || !det.date || !det.time) {
    const faltam = det.missing.length ? det.missing.join(', ') : 'confirmação clara'
    return {
      ...none(det.status, base),
      notes:
        det.status === 'needs_info' || det.status === 'ambiguous'
          ? `Agendamento pela IA não feito: falta/ambíguo (${faltam}). Confirme com a cliente dia, horário e procedimento.`
          : undefined,
    }
  }
  const svc = det.service
  const date = det.date
  const time = det.time
  const activeZones = svc.zones.filter((z) => z.active)
  const namedZones = zonesNamedInText(clientTurn.map((m) => m.body).join('\n'), activeZones)
  if (activeZones.length > 0 && namedZones.length === 0) {
    return {
      ...none('needs_info', { ...base, serviceId: svc.id, date, time }),
      notes:
        `A cliente falou em ${svc.name} sem escolher zonas (${activeZones.map((z) => z.name).join(', ')}). ` +
        'Pergunte as zonas. Não informe valor nem «a partir de».',
    }
  }
  const quote = quoteVisit(
    db,
    tenantId,
    svc,
    namedZones.map((z) => z.id),
  )
  const label = `${svc.name} · ${dayText(date)} às ${time}`
  const found = { ...base, serviceId: svc.id, date, time }

  // S2 / DEC-061: texto livre NUNCA marca. Com capacidade ligada, monta+envia proposta versionada
  // (botão WhatsApp); o clique (S5) é que marca ou inicia Pix. Sem capacidade → só nota à atendente.
  const avail = queryAvailability(
    db,
    tenantId,
    {
      serviceId: svc.id,
      date,
      ...(quote.zones.length > 0 ? { durationMinutesOverride: quote.durationMinutes } : {}),
    },
    clock,
  )
  const slot = avail.slots.find((s) => localHHMM(tz, s.startsAt) === time)

  if (!slot) {
    return {
      ...none(svc.requiresSignal ? 'needs_signal' : 'requires_button', found),
      notes:
        `A cliente parece confirmar ${label} (horário não livre na agenda). ` +
        'Texto livre não marca automaticamente: confirme pelo Agendar (fluxo normal).',
    }
  }

  if (!input.capability) {
    if (svc.requiresSignal) {
      const amount = signalAmountCents(svc, quote.priceCents)
      return {
        ...none('needs_signal', found),
        replyText:
          `Perfeito${hi}! Para garantir ${svc.name} na ${dayText(date)} às ${time}, a clínica pede um sinal` +
          `${amount != null ? ` de ${brl(amount)}` : ''} por Pix. O horário fica reservado depois do pagamento; o Pix chega aqui na conversa.`,
        notes:
          `A cliente confirmou ${label}. Serviço exige sinal: a IA NÃO marcou. ` +
          'Envie a cobrança Pix pelo Agendar (fluxo normal); o compromisso é criado após o pagamento.',
      }
    }
    return {
      ...none('requires_button', found),
      notes:
        `A cliente parece confirmar ${label}. ` +
        'Texto livre não marca automaticamente: confirme pelo Agendar (fluxo normal).',
    }
  }

  try {
    const proposal = createProposal(
      db,
      tenantId,
      {
        contactId: conv.contactId,
        conversationId: conv.id,
        serviceId: svc.id,
        professionalId: slot.professionalId,
        startsAt: slot.startsAt,
        endsAt: slot.startsAt + quote.durationMinutes * 60_000,
        durationMinutes: quote.durationMinutes,
        zoneIds: quote.zones.map((z) => z.zoneId).filter((id): id is string => Boolean(id)),
      },
      clock,
      input.abuseLimits ? { abuseLimits: input.abuseLimits } : {},
    )
    const sent = sendProposalToWhatsAppOp(db, caller, { proposalId: proposal.id }, clock)
    const status: AutoBookStatus = svc.requiresSignal ? 'needs_signal' : 'requires_button'
    const sendNote =
      sent.status === 'queued' || sent.status === 'already_sent'
        ? `Proposta ${proposal.id} v${proposal.version} enfileirada/enviada com botão Confirmar. ` +
          'Aguarda o clique da cliente; texto livre («sim») não marca.'
        : `Proposta ${proposal.id} v${proposal.version} preparada, mas envio entregue à equipe ` +
          `(${sent.status}). Texto livre não marca.`
    return {
      ...none(status, found),
      proposalId: proposal.id,
      proposalVersion: proposal.version,
      // Não afirmar «agendado»: o botão ainda não foi tocado. Rascunho vazio → atendente vê só notas.
      replyText: '',
      notes: `A cliente parece confirmar ${label}. ${sendNote}`,
      outbox: sent.outbox,
    }
  } catch (err) {
    return {
      ...none(svc.requiresSignal ? 'needs_signal' : 'requires_button', found),
      notes:
        `A cliente parece confirmar ${label}. Falha ao montar/enviar a proposta: ` +
        `${err instanceof Error ? err.message.slice(0, 180) : 'erro'}. ` +
        'Texto livre não marca — confirme pelo Agendar.',
    }
  }
}
