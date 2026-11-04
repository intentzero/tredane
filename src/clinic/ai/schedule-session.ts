/**
 * BookingFrame — estado persistente da conversa (ADR-0015 / DEC-127 / #412 M2).
 * Tabela SQL: `schedule_sessions` (nome mantido). Tipo/acessores: BookingFrame / getBookingFrame.
 * ScheduleSession permanece como vista de compatibilidade até ao cutover completo.
 */
import type { Clock } from '../../db/clock'
import type { ClinicDb } from '../store'
import { insertOutboxEvent, type OutboxRow } from '../outbox'

export type ScheduleAudienceLine = 'feminino' | 'masculino'

export type ScheduleDayLabel =
  | 'hoje'
  | 'amanhã'
  | 'depois de amanhã'
  | 'segunda'
  | 'terça'
  | 'quarta'
  | 'quinta'
  | 'sexta'
  | 'sábado'
  | 'domingo'

export type SchedulePeriod = 'manha' | 'tarde' | 'noite'

export type BookingFramePhase =
  | 'idle'
  | 'coletando'
  | 'ofertado'
  | 'proposto'
  | 'pix_pendente'
  | 'remarcando'
  | 'pausado'

export type BookingFramePending = {
  slot: string
  options: Array<{ key: string; label: string }>
  messageId: string
}

export type BookingFrameLastOffer = {
  slots: Array<{ startsAt: number; professionalId: string }>
  messageId: string
}

export type BookingFrameProposal = { id: string; version: number }

/**
 * Origem do campo no quadro.
 * `'flow'` = fecho nfm_reply do WhatsApp Flow (#514 / ADR-0016).
 * Não mapear Flow para `'botao'` (toque M5).
 */
export type BookingFrameProvenanceSource = 'regra' | 'botao' | 'llm' | 'flow'

export type BookingFrameProvenance = Record<
  string,
  { messageId: string; source: BookingFrameProvenanceSource }
>

/** Contrato ADR-0015 / núcleo §3.3. */
export type BookingFrame = {
  phase: BookingFramePhase
  serviceId: string | null
  line: ScheduleAudienceLine | null
  variantIds: string[] | null
  professionalPref: string | null
  /** Data civil absoluta no fuso da clínica (YYYY-MM-DD). */
  date: string | null
  period: SchedulePeriod | null
  /** HH:MM no fuso da clínica. */
  time: string | null
  pending: BookingFramePending | null
  lastOffer: BookingFrameLastOffer | null
  proposal: BookingFrameProposal | null
  rescheduleAppointmentId: string | null
  catalogVersion: string
  provenance: BookingFrameProvenance
  updatedAt: number
}

/**
 * Vista legada. `dayLabel` lê a coluna órfã (não é gravada após #472 cutover;
 * sem DROP COLUMN — ADR-0015).
 */
export type ScheduleSession = {
  serviceId: string
  audienceLine: ScheduleAudienceLine | null
  dayLabel: ScheduleDayLabel | null
  period: SchedulePeriod | null
  variantIds: string[] | null
  clockTime: string | null
  updatedAt: number
}

/** Campo omitido mantém o valor já gravado. `null` limpa. Trocar o serviço limpa linha/variantes/hora/pending/lastOffer. */
export type BookingFramePatch = {
  serviceId?: string | null
  phase?: BookingFramePhase
  line?: ScheduleAudienceLine | null
  variantIds?: string[] | null
  professionalPref?: string | null
  date?: string | null
  period?: SchedulePeriod | null
  time?: string | null
  pending?: BookingFramePending | null
  lastOffer?: BookingFrameLastOffer | null
  proposal?: BookingFrameProposal | null
  rescheduleAppointmentId?: string | null
  catalogVersion?: string
  provenance?: BookingFrameProvenance
  /**
   * Ignorado na gravação (#472): a coluna `day_label` fica órfã (NULL).
   * Mantido no tipo para não quebrar callers que ainda passam o campo.
   */
  dayLabel?: ScheduleDayLabel | null
  /** Origem da mutação (proveniência por campo). */
  sourceMessageId?: string
  source?: BookingFrameProvenanceSource
}

/** Compat com callers antigos. */
export type ScheduleSessionPatch = {
  serviceId: string
  audienceLine?: ScheduleAudienceLine | null
  dayLabel?: ScheduleDayLabel | null
  period?: SchedulePeriod | null
  variantIds?: string[] | null
  clockTime?: string | null
  /** Extensão M2 — data absoluta (CF-21). */
  date?: string | null
  pending?: BookingFramePending | null
  lastOffer?: BookingFrameLastOffer | null
  phase?: BookingFramePhase
  proposal?: BookingFrameProposal | null
  professionalPref?: string | null
  catalogVersion?: string
}

type FrameSql = {
  service_id: string | null
  audience_line: string | null
  day_label: string | null
  period: string | null
  variant_ids: string | null
  clock_time: string | null
  updated_at: number
  phase: string | null
  line: string | null
  professional_pref: string | null
  date: string | null
  time: string | null
  pending_json: string | null
  last_offer_json: string | null
  proposal_json: string | null
  reschedule_appointment_id: string | null
  catalog_version: string | null
  provenance_json: string | null
}

const DAY_LABELS = new Set<ScheduleDayLabel>([
  'hoje',
  'amanhã',
  'depois de amanhã',
  'segunda',
  'terça',
  'quarta',
  'quinta',
  'sexta',
  'sábado',
  'domingo',
])

const PHASES = new Set<BookingFramePhase>([
  'idle',
  'coletando',
  'ofertado',
  'proposto',
  'pix_pendente',
  'remarcando',
  'pausado',
])

function fold(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

function asLine(value: string | null): ScheduleAudienceLine | null {
  return value === 'feminino' || value === 'masculino' ? value : null
}

function asDay(value: string | null): ScheduleDayLabel | null {
  return value != null && DAY_LABELS.has(value as ScheduleDayLabel) ? (value as ScheduleDayLabel) : null
}

function asPeriod(value: string | null): SchedulePeriod | null {
  return value === 'manha' || value === 'tarde' || value === 'noite' ? value : null
}

function asPhase(value: string | null): BookingFramePhase {
  return value != null && PHASES.has(value as BookingFramePhase)
    ? (value as BookingFramePhase)
    : 'coletando'
}

function asVariantIds(raw: string | null): string[] | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return null
    const ids = parsed.filter((id): id is string => typeof id === 'string' && id.length > 0)
    return ids.length > 0 ? ids : null
  } catch {
    return null
  }
}

function asClock(value: string | null): string | null {
  return value != null && /^\d{2}:\d{2}$/.test(value) ? value : null
}

function asDate(value: string | null): string | null {
  return value != null && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function asPending(raw: string | null): BookingFramePending | null {
  const parsed = parseJson<BookingFramePending | null>(raw, null)
  if (!parsed || typeof parsed !== 'object') return null
  if (typeof parsed.slot !== 'string' || typeof parsed.messageId !== 'string') return null
  if (!Array.isArray(parsed.options)) return null
  return parsed
}

function asLastOffer(raw: string | null): BookingFrameLastOffer | null {
  const parsed = parseJson<BookingFrameLastOffer | null>(raw, null)
  if (!parsed || typeof parsed !== 'object') return null
  if (typeof parsed.messageId !== 'string' || !Array.isArray(parsed.slots)) return null
  return parsed
}

function asProposal(raw: string | null): BookingFrameProposal | null {
  const parsed = parseJson<BookingFrameProposal | null>(raw, null)
  if (!parsed || typeof parsed.id !== 'string' || typeof parsed.version !== 'number') return null
  return parsed
}

function asProvenance(raw: string | null): BookingFrameProvenance {
  const parsed = parseJson<BookingFrameProvenance>(raw, {})
  return parsed && typeof parsed === 'object' ? parsed : {}
}

/**
 * Dia e período ditos numa frase. Dois dias ou dois períodos ficam de fora.
 * «mais tarde» não é o período da tarde.
 */
export function scheduleFactsFromText(text: string): {
  dayLabel?: ScheduleDayLabel
  period?: SchedulePeriod
} {
  let scan = fold(text)
  const days: ScheduleDayLabel[] = []
  if (/\bdepois de amanha\b/.test(scan)) {
    days.push('depois de amanhã')
    scan = scan.replace(/\bdepois de amanha\b/g, ' ')
  }
  const dayRules: Array<[RegExp, ScheduleDayLabel]> = [
    [/\bamanha\b/, 'amanhã'],
    [/\bhoje\b/, 'hoje'],
    [/\bsegunda\b/, 'segunda'],
    [/\bterca\b/, 'terça'],
    [/\bquarta\b/, 'quarta'],
    [/\bquinta\b/, 'quinta'],
    [/\bsexta\b/, 'sexta'],
    [/\bsabado\b/, 'sábado'],
    [/\bdomingo\b/, 'domingo'],
  ]
  for (const [re, label] of dayRules) {
    if (re.test(scan)) days.push(label)
  }
  const forPeriod = fold(text).replace(/\bmais tarde\b/g, ' ')
  const periods: SchedulePeriod[] = []
  if (/\bmanha\b/.test(forPeriod)) periods.push('manha')
  if (/\btarde\b/.test(forPeriod)) periods.push('tarde')
  if (/\bnoite\b/.test(forPeriod)) periods.push('noite')
  const out: { dayLabel?: ScheduleDayLabel; period?: SchedulePeriod } = {}
  if (days.length === 1) out.dayLabel = days[0]
  if (periods.length === 1) out.period = periods[0]
  return out
}

function rowToFrame(row: FrameSql): BookingFrame {
  const line = asLine(row.line) ?? asLine(row.audience_line)
  const time = asClock(row.time) ?? asClock(row.clock_time)
  return {
    phase: asPhase(row.phase),
    serviceId: row.service_id,
    line,
    variantIds: asVariantIds(row.variant_ids),
    professionalPref: row.professional_pref,
    date: asDate(row.date),
    period: asPeriod(row.period),
    time,
    pending: asPending(row.pending_json),
    lastOffer: asLastOffer(row.last_offer_json),
    proposal: asProposal(row.proposal_json),
    rescheduleAppointmentId: row.reschedule_appointment_id,
    catalogVersion: row.catalog_version ?? '',
    provenance: asProvenance(row.provenance_json),
    updatedAt: row.updated_at,
  }
}

function frameToSession(frame: BookingFrame, dayLabel: ScheduleDayLabel | null): ScheduleSession | null {
  if (!frame.serviceId) return null
  return {
    serviceId: frame.serviceId,
    audienceLine: frame.line,
    dayLabel,
    period: frame.period,
    variantIds: frame.variantIds,
    clockTime: frame.time,
    updatedAt: frame.updatedAt,
  }
}

const FRAME_SELECT = `SELECT service_id, audience_line, day_label, period, variant_ids, clock_time, updated_at,
       phase, line, professional_pref, date, time, pending_json, last_offer_json,
       proposal_json, reschedule_appointment_id, catalog_version, provenance_json
     FROM schedule_sessions
     WHERE tenant_id = ? AND conversation_id = ?`

export function getBookingFrame(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
): BookingFrame | null {
  const row = db.get<FrameSql>(FRAME_SELECT, tenantId, conversationId)
  if (!row) return null
  return rowToFrame(row)
}

export function getScheduleSession(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
): ScheduleSession | null {
  const row = db.get<FrameSql>(FRAME_SELECT, tenantId, conversationId)
  if (!row || !row.service_id) return null
  return frameToSession(rowToFrame(row), asDay(row.day_label))
}

function filledSlots(frame: BookingFrame): string[] {
  const out: string[] = []
  if (frame.serviceId) out.push('serviceId')
  if (frame.line) out.push('line')
  if (frame.variantIds?.length) out.push('variantIds')
  if (frame.date) out.push('date')
  if (frame.period) out.push('period')
  if (frame.time) out.push('time')
  if (frame.professionalPref) out.push('professionalPref')
  return out
}

/** Property: nenhuma pergunta sobre slot já preenchido. */
export function wouldAskFilledSlot(frame: BookingFrame, askSlot: string): boolean {
  return filledSlots(frame).includes(askSlot)
}

/**
 * Grava o frame. Troca de serviço limpa linha, variantes, hora, pending, lastOffer,
 * proposal e professionalPref (ADR-0015). Emite `booking_frame.updated` se mudou.
 */
export function saveBookingFrame(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  patch: BookingFramePatch,
  clock: Clock,
  opts?: { emitOutbox?: boolean },
): { frame: BookingFrame; outbox: OutboxRow | null } {
  const existing = getBookingFrame(db, tenantId, conversationId)

  const nextServiceId =
    patch.serviceId !== undefined ? patch.serviceId : (existing?.serviceId ?? null)
  if (!nextServiceId) {
    clearBookingFrame(db, tenantId, conversationId, clock, opts)
    return {
      frame: {
        phase: 'idle',
        serviceId: null,
        line: null,
        variantIds: null,
        professionalPref: null,
        date: null,
        period: null,
        time: null,
        pending: null,
        lastOffer: null,
        proposal: null,
        rescheduleAppointmentId: null,
        catalogVersion: '',
        provenance: {},
        updatedAt: clock.nowMs(),
      },
      outbox: null,
    }
  }

  const serviceChanged = existing != null && existing.serviceId !== nextServiceId
  const line = serviceChanged
    ? (patch.line !== undefined ? patch.line : null)
    : patch.line !== undefined
      ? patch.line
      : (existing?.line ?? null)
  const variantIds = serviceChanged
    ? (patch.variantIds !== undefined ? patch.variantIds : null)
    : patch.variantIds !== undefined
      ? patch.variantIds
      : (existing?.variantIds ?? null)
  const time = serviceChanged
    ? (patch.time !== undefined ? patch.time : null)
    : patch.time !== undefined
      ? patch.time
      : (existing?.time ?? null)
  const date = patch.date !== undefined ? patch.date : (existing?.date ?? null)
  const period = patch.period !== undefined ? patch.period : (existing?.period ?? null)
  // #472 cutover: deixa de gravar day_label (coluna órfã → sempre NULL).
  const dayLabel = null
  const professionalPref = serviceChanged
    ? (patch.professionalPref !== undefined ? patch.professionalPref : null)
    : patch.professionalPref !== undefined
      ? patch.professionalPref
      : (existing?.professionalPref ?? null)
  const pending = serviceChanged
    ? (patch.pending !== undefined ? patch.pending : null)
    : patch.pending !== undefined
      ? patch.pending
      : (existing?.pending ?? null)
  const lastOffer = serviceChanged
    ? (patch.lastOffer !== undefined ? patch.lastOffer : null)
    : patch.lastOffer !== undefined
      ? patch.lastOffer
      : (existing?.lastOffer ?? null)
  const proposal = serviceChanged
    ? (patch.proposal !== undefined ? patch.proposal : null)
    : patch.proposal !== undefined
      ? patch.proposal
      : (existing?.proposal ?? null)
  const rescheduleAppointmentId =
    patch.rescheduleAppointmentId !== undefined
      ? patch.rescheduleAppointmentId
      : (existing?.rescheduleAppointmentId ?? null)
  const catalogVersion =
    patch.catalogVersion !== undefined
      ? patch.catalogVersion
      : (existing?.catalogVersion ?? '')
  let provenance = patch.provenance ?? existing?.provenance ?? {}
  if (patch.sourceMessageId && patch.source) {
    const fields = ['serviceId', 'line', 'variantIds', 'date', 'period', 'time', 'pending', 'lastOffer'] as const
    const nextProv = { ...provenance }
    for (const f of fields) {
      if (patch[f] !== undefined) {
        nextProv[f] = { messageId: patch.sourceMessageId, source: patch.source }
      }
    }
    provenance = nextProv
  }
  const phase =
    patch.phase ??
    (pending || lastOffer
      ? 'ofertado'
      : proposal
        ? 'proposto'
        : existing?.phase && existing.phase !== 'idle'
          ? existing.phase
          : 'coletando')

  const now = clock.nowMs()
  const funnelStart = serviceChanged || !existing ? now : existing.updatedAt

  db.run(
    `INSERT INTO schedule_sessions (
       tenant_id, conversation_id, service_id, audience_line, day_label, period,
       variant_ids, clock_time, updated_at,
       phase, line, professional_pref, date, time,
       pending_json, last_offer_json, proposal_json,
       reschedule_appointment_id, catalog_version, provenance_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (tenant_id, conversation_id) DO UPDATE SET
       service_id = excluded.service_id,
       audience_line = excluded.audience_line,
       day_label = excluded.day_label,
       period = excluded.period,
       variant_ids = excluded.variant_ids,
       clock_time = excluded.clock_time,
       phase = excluded.phase,
       line = excluded.line,
       professional_pref = excluded.professional_pref,
       date = excluded.date,
       time = excluded.time,
       pending_json = excluded.pending_json,
       last_offer_json = excluded.last_offer_json,
       proposal_json = excluded.proposal_json,
       reschedule_appointment_id = excluded.reschedule_appointment_id,
       catalog_version = excluded.catalog_version,
       provenance_json = excluded.provenance_json,
       updated_at = CASE
         WHEN schedule_sessions.service_id != excluded.service_id THEN excluded.updated_at
         ELSE schedule_sessions.updated_at
       END`,
    tenantId,
    conversationId,
    nextServiceId,
    line,
    dayLabel,
    period,
    variantIds && variantIds.length > 0 ? JSON.stringify(variantIds) : null,
    time,
    funnelStart,
    phase,
    line,
    professionalPref,
    date,
    time,
    pending ? JSON.stringify(pending) : null,
    lastOffer ? JSON.stringify(lastOffer) : null,
    proposal ? JSON.stringify(proposal) : null,
    rescheduleAppointmentId,
    catalogVersion,
    JSON.stringify(provenance),
  )

  const frame = getBookingFrame(db, tenantId, conversationId)!
  let outbox: OutboxRow | null = null
  if (opts?.emitOutbox !== false) {
    const changed =
      !existing ||
      existing.serviceId !== frame.serviceId ||
      existing.line !== frame.line ||
      existing.date !== frame.date ||
      existing.time !== frame.time ||
      existing.period !== frame.period ||
      JSON.stringify(existing.variantIds) !== JSON.stringify(frame.variantIds) ||
      JSON.stringify(existing.pending) !== JSON.stringify(frame.pending) ||
      JSON.stringify(existing.lastOffer) !== JSON.stringify(frame.lastOffer) ||
      JSON.stringify(existing.proposal) !== JSON.stringify(frame.proposal) ||
      existing.phase !== frame.phase
    if (changed) {
      outbox = insertOutboxEvent(
        db,
        {
          tenantId,
          type: 'booking_frame.updated',
          aggregateType: 'conversation',
          aggregateId: conversationId,
          payload: {
            conversationId,
            phase: frame.phase,
            serviceId: frame.serviceId,
            date: frame.date,
            time: frame.time,
          },
          idempotencyKey: `booking_frame.updated:${conversationId}:${now}`,
        },
        clock,
      )
    }
  }
  return { frame, outbox }
}

/** Compat: grava via BookingFrame (dual-write audience_line/line, clock_time/time). */
export function saveScheduleSession(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  patch: ScheduleSessionPatch,
  clock: Clock,
): void {
  saveBookingFrame(
    db,
    tenantId,
    conversationId,
    {
      serviceId: patch.serviceId,
      line: patch.audienceLine,
      dayLabel: patch.dayLabel,
      period: patch.period,
      variantIds: patch.variantIds,
      time: patch.clockTime,
      date: patch.date,
      pending: patch.pending,
      lastOffer: patch.lastOffer,
      phase: patch.phase,
      proposal: patch.proposal,
      professionalPref: patch.professionalPref,
      catalogVersion: patch.catalogVersion,
      source: 'regra',
    },
    clock,
  )
}

export function clearBookingFrame(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  clock?: Clock,
  opts?: { emitOutbox?: boolean },
): OutboxRow | null {
  const existing = getBookingFrame(db, tenantId, conversationId)
  db.run(
    `DELETE FROM schedule_sessions WHERE tenant_id = ? AND conversation_id = ?`,
    tenantId,
    conversationId,
  )
  if (!existing || !clock || opts?.emitOutbox === false) return null
  return insertOutboxEvent(
    db,
    {
      tenantId,
      type: 'booking_frame.updated',
      aggregateType: 'conversation',
      aggregateId: conversationId,
      payload: { conversationId, phase: 'idle', serviceId: null },
      idempotencyKey: `booking_frame.updated:${conversationId}:${clock.nowMs()}:clear`,
    },
    clock,
  )
}

/** Apaga a sessão de agendamento da conversa (nova intenção de serviço — DEC-086). */
export function clearScheduleSession(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
): void {
  clearBookingFrame(db, tenantId, conversationId)
}

/** Grava a linha explícita, ou null enquanto a pergunta ainda não foi respondida. Mantém dia e período. */
export function saveScheduleLine(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  serviceId: string,
  audienceLine: ScheduleAudienceLine | null,
  clock: Clock,
): void {
  saveScheduleSession(db, tenantId, conversationId, { serviceId, audienceLine }, clock)
}

/**
 * Revalida ids contra o catálogo actual (ADR-0015). Sem inventar substituto:
 * ids inválidos são limpos; o funil pergunta de novo o que faltar.
 * `nextCatalogVersion` é a versão a gravar após a revalidação (DEC-127.4 / #472).
 */
export function revalidateFrameCatalogIds(
  frame: BookingFrame,
  valid: {
    serviceIds: ReadonlySet<string>
    variantIds: ReadonlySet<string>
    professionalIds?: ReadonlySet<string>
  },
  nextCatalogVersion: string,
): BookingFramePatch {
  const patch: BookingFramePatch = { catalogVersion: nextCatalogVersion }
  if (frame.serviceId && !valid.serviceIds.has(frame.serviceId)) {
    patch.serviceId = null
    return patch
  }
  if (frame.variantIds) {
    const ok = frame.variantIds.filter((id) => valid.variantIds.has(id))
    if (ok.length !== frame.variantIds.length) {
      patch.variantIds = ok.length > 0 ? ok : null
    }
  }
  if (
    frame.professionalPref &&
    valid.professionalIds &&
    !valid.professionalIds.has(frame.professionalPref)
  ) {
    patch.professionalPref = null
  }
  return patch
}

/**
 * Se `catalogVersion` diverge do catálogo compilado (inclui `''` pós-0049),
 * revalida ids e grava a versão actual. Dados ainda válidos permanecem (DEC-127.4).
 */
export function syncBookingFrameWithCatalog(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  catalog: {
    version: string
    serviceIds: ReadonlySet<string>
    variantIds: ReadonlySet<string>
    professionalIds: ReadonlySet<string>
  },
  clock: Clock,
  opts?: { emitOutbox?: boolean },
): { frame: BookingFrame | null; outbox: OutboxRow | null; revalidated: boolean } {
  const existing = getBookingFrame(db, tenantId, conversationId)
  if (!existing) return { frame: null, outbox: null, revalidated: false }
  if (existing.catalogVersion === catalog.version) {
    return { frame: existing, outbox: null, revalidated: false }
  }
  const patch = revalidateFrameCatalogIds(
    existing,
    {
      serviceIds: catalog.serviceIds,
      variantIds: catalog.variantIds,
      professionalIds: catalog.professionalIds,
    },
    catalog.version,
  )
  const { frame, outbox } = saveBookingFrame(
    db,
    tenantId,
    conversationId,
    patch,
    clock,
    opts,
  )
  return {
    frame: frame.serviceId ? frame : getBookingFrame(db, tenantId, conversationId),
    outbox,
    revalidated: true,
  }
}
