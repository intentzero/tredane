/**
 * Propostas de agendamento versionadas (S3 / #174 / DEC-061).
 *
 * - Persistidas no SQLite do Clinic DO; IDs de entidades validados no backend.
 * - Não reservam horário ao emitir (DEC-008 / DEC-047).
 * - Vigência 30 min a partir do envio (relógio do backend; expiração preguiçosa).
 * - Conhecer o id não autoriza: exige tenant/contato/conversa + estado `enviada` + não expirada.
 * - Envio WhatsApp e resultados determinísticos: S4 (`send.ts` / `results.ts`).
 * - Clique autenticado → S5 (`buttons.ts` deixa a costura pronta).
 */
import type { Clock } from '../../db/clock'
import {
  checkAutomationQuota,
  recordLimitReached,
  type AbuseLimits,
} from '../ai/abuse-limits'
import { getContact } from '../contacts'
import {
  APPOINTMENT_PROPOSAL_OPEN_STATES,
  APPOINTMENT_PROPOSAL_VALIDITY_MS,
  type AppointmentProposalOpenState,
  type AppointmentProposalState,
} from '../constants'
import { getResource } from '../config/resources'
import { ensureClinicSettings } from '../config/settings'
import { getService } from '../config/services'
import {
  quoteVisit,
  readZoneSnapshots,
  writeZoneSnapshots,
} from '../config/zones'
import type { ComboSnapshot, ZoneSnapshot } from '../config/types'
import { ConflictError, NotFoundError, ValidationError } from '../errors'
import { newId } from '../ids'
import { getConversation } from '../inbox/conversations'
import type { ClinicDb } from '../store'
import type {
  AppointmentProposalRow,
  CreateAppointmentProposalInput,
  ProposalAuthorizationResult,
} from './types'

type ProposalSql = {
  id: string
  tenant_id: string
  lineage_id: string
  version: number
  contact_id: string
  conversation_id: string
  state: string
  clinic_location_text: string
  beneficiary_kind: string
  beneficiary_name: string
  service_id: string
  service_name: string
  professional_id: string | null
  professional_name: string | null
  starts_at: number
  ends_at: number
  duration_minutes: number
  timezone: string
  price_cents: number | null
  requires_signal: number
  signal_kind: string | null
  signal_fixed_cents: number | null
  signal_percent: number | null
  signal_conditions_text: string
  expires_at: number | null
  sent_at: number | null
  superseded_by_id: string | null
  appointment_id: string | null
  send_outbound_id?: string | null
  send_message_id?: string | null
  send_provider_message_id?: string | null
  result_outbound_id?: string | null
  result_kind?: string | null
  tempo_ceu?: string | null
  tempo_temperatura?: string | null
  tempo_celsius?: number | null
  created_at: number
  updated_at: number
}

function mapRow(row: ProposalSql): AppointmentProposalRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    lineageId: row.lineage_id,
    version: row.version,
    contactId: row.contact_id,
    conversationId: row.conversation_id,
    state: row.state as AppointmentProposalState,
    clinicLocationText: row.clinic_location_text,
    beneficiaryKind: row.beneficiary_kind as AppointmentProposalRow['beneficiaryKind'],
    beneficiaryName: row.beneficiary_name,
    serviceId: row.service_id,
    serviceName: row.service_name,
    professionalId: row.professional_id,
    professionalName: row.professional_name,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    durationMinutes: row.duration_minutes,
    timezone: row.timezone,
    priceCents: row.price_cents,
    requiresSignal: row.requires_signal === 1,
    signalKind: row.signal_kind,
    signalFixedCents: row.signal_fixed_cents,
    signalPercent: row.signal_percent,
    signalConditionsText: row.signal_conditions_text,
    expiresAt: row.expires_at,
    sentAt: row.sent_at,
    supersededById: row.superseded_by_id,
    appointmentId: row.appointment_id,
    sendOutboundId: row.send_outbound_id ?? null,
    sendMessageId: row.send_message_id ?? null,
    sendProviderMessageId: row.send_provider_message_id ?? null,
    resultOutboundId: row.result_outbound_id ?? null,
    resultKind: row.result_kind ?? null,
    tempoCeu: row.tempo_ceu === 'sol' || row.tempo_ceu === 'chuva' ? row.tempo_ceu : 'tanto_faz',
    tempoTemperatura:
      row.tempo_temperatura === 'acima' || row.tempo_temperatura === 'abaixo'
        ? row.tempo_temperatura
        : 'tanto_faz',
    tempoCelsius: row.tempo_celsius ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** Liga proposta ↔ intenção/mensagem WhatsApp após gravar o outbox (S4). */
export function linkProposalSend(
  db: ClinicDb,
  tenantId: string,
  proposalId: string,
  links: {
    sendOutboundId?: string | null
    sendMessageId?: string | null
    sendProviderMessageId?: string | null
  },
  clock: Clock,
): AppointmentProposalRow {
  const current = getProposal(db, tenantId, proposalId)
  if (!current) throw new NotFoundError('proposal_not_found', 'Proposta não encontrada')
  const now = clock.nowMs()
  db.run(
    `UPDATE appointment_proposals SET
       send_outbound_id = COALESCE(?, send_outbound_id),
       send_message_id = COALESCE(?, send_message_id),
       send_provider_message_id = COALESCE(?, send_provider_message_id),
       updated_at = ?
     WHERE tenant_id = ? AND id = ?`,
    links.sendOutboundId ?? null,
    links.sendMessageId ?? null,
    links.sendProviderMessageId ?? null,
    now,
    tenantId,
    proposalId,
  )
  return getProposal(db, tenantId, proposalId)!
}

export function linkProposalResult(
  db: ClinicDb,
  tenantId: string,
  proposalId: string,
  links: { resultOutboundId?: string | null; resultKind?: string | null },
  clock: Clock,
): AppointmentProposalRow {
  const current = getProposal(db, tenantId, proposalId)
  if (!current) throw new NotFoundError('proposal_not_found', 'Proposta não encontrada')
  const now = clock.nowMs()
  db.run(
    `UPDATE appointment_proposals SET
       result_outbound_id = COALESCE(?, result_outbound_id),
       result_kind = COALESCE(?, result_kind),
       updated_at = ?
     WHERE tenant_id = ? AND id = ?`,
    links.resultOutboundId ?? null,
    links.resultKind ?? null,
    now,
    tenantId,
    proposalId,
  )
  return getProposal(db, tenantId, proposalId)!
}

export function findProposalBySendOutboundId(
  db: ClinicDb,
  tenantId: string,
  outboundId: string,
): AppointmentProposalRow | null {
  const row = db.get<ProposalSql>(
    `SELECT * FROM appointment_proposals WHERE tenant_id = ? AND send_outbound_id = ?`,
    tenantId,
    outboundId,
  )
  return row ? mapRow(row) : null
}

export function findProposalByResultOutboundId(
  db: ClinicDb,
  tenantId: string,
  outboundId: string,
): AppointmentProposalRow | null {
  const row = db.get<ProposalSql>(
    `SELECT * FROM appointment_proposals WHERE tenant_id = ? AND result_outbound_id = ?`,
    tenantId,
    outboundId,
  )
  return row ? mapRow(row) : null
}

const OPEN = new Set<string>(APPOINTMENT_PROPOSAL_OPEN_STATES)

function isOpenState(state: AppointmentProposalState): state is AppointmentProposalOpenState {
  return OPEN.has(state)
}

function readProposalZoneKey(db: ClinicDb, tenantId: string, proposalId: string): string {
  return readZoneSnapshots(db, tenantId, 'proposal', proposalId)
    .map((z) => z.zoneId)
    .join(',')
}

function materialKey(p: {
  serviceId: string
  professionalId: string | null
  startsAt: number
  endsAt: number
  beneficiaryKind: string
  beneficiaryName: string
  priceCents: number | null
  requiresSignal: boolean
  signalKind: string | null
  signalFixedCents: number | null
  signalPercent: number | null
  zoneKey?: string
}): string {
  return [
    p.serviceId,
    p.professionalId ?? '',
    p.startsAt,
    p.endsAt,
    p.beneficiaryKind,
    p.beneficiaryName.trim().toLowerCase(),
    p.priceCents ?? '',
    p.requiresSignal ? 1 : 0,
    p.signalKind ?? '',
    p.signalFixedCents ?? '',
    p.signalPercent ?? '',
    p.zoneKey ?? '',
  ].join('|')
}

function assertTransition(
  from: AppointmentProposalState,
  to: AppointmentProposalState,
): void {
  const ok =
    (from === 'preparada' && (to === 'envio_pendente' || to === 'enviada' || to === 'substituida')) ||
    (from === 'envio_pendente' &&
      (to === 'envio_incerto' || to === 'enviada' || to === 'substituida')) ||
    (from === 'envio_incerto' && (to === 'enviada' || to === 'substituida' || to === 'envio_pendente')) ||
    (from === 'enviada' &&
      (to === 'confirmada' ||
        to === 'substituida' ||
        to === 'expirada' ||
        to === 'recusada_vaga' ||
        to === 'recusada_tempo' ||
        to === 'encaminhada'))
  if (!ok) {
    throw new ConflictError(
      'proposal_invalid_transition',
      `Transição de proposta inválida: ${from} → ${to}`,
      { from, to },
    )
  }
}

/**
 * UPDATE condicional: só aplica se o estado (e opcionalmente a versão) ainda batem.
 * Corridas no mesmo DO são serializadas; isto cobre retries e leituras obsoletas.
 */
function transitionRow(
  db: ClinicDb,
  tenantId: string,
  proposalId: string,
  fromState: AppointmentProposalState,
  toState: AppointmentProposalState,
  clock: Clock,
  patch: {
    expiresAt?: number | null
    sentAt?: number | null
    supersededById?: string | null
    appointmentId?: string | null
    expectedVersion?: number
  } = {},
): AppointmentProposalRow {
  assertTransition(fromState, toState)
  const now = clock.nowMs()
  const sets = ['state = ?', 'updated_at = ?']
  const params: Array<string | number | null> = [toState, now]
  if (patch.expiresAt !== undefined) {
    sets.push('expires_at = ?')
    params.push(patch.expiresAt)
  }
  if (patch.sentAt !== undefined) {
    sets.push('sent_at = ?')
    params.push(patch.sentAt)
  }
  if (patch.supersededById !== undefined) {
    sets.push('superseded_by_id = ?')
    params.push(patch.supersededById)
  }
  if (patch.appointmentId !== undefined) {
    sets.push('appointment_id = ?')
    params.push(patch.appointmentId)
  }
  let where = 'WHERE tenant_id = ? AND id = ? AND state = ?'
  params.push(tenantId, proposalId, fromState)
  if (patch.expectedVersion !== undefined) {
    where += ' AND version = ?'
    params.push(patch.expectedVersion)
  }
  const result = db.run(
    `UPDATE appointment_proposals SET ${sets.join(', ')} ${where}`,
    ...params,
  )
  const after = getProposal(db, tenantId, proposalId)
  // Node sqlite: changes===0 → falhou. DO SqlStorage devolve changes=-1; confirmar pelo estado.
  if (!after || after.state !== toState || result.changes === 0) {
    throw new ConflictError(
      'proposal_concurrent_transition',
      'A proposta mudou entretanto; transição recusada',
      { proposalId, fromState, toState, foundState: after?.state ?? null },
    )
  }
  return after
}

export function getProposal(
  db: ClinicDb,
  tenantId: string,
  proposalId: string,
): AppointmentProposalRow | null {
  const row = db.get<ProposalSql>(
    `SELECT * FROM appointment_proposals WHERE tenant_id = ? AND id = ?`,
    tenantId,
    proposalId,
  )
  return row ? mapRow(row) : null
}

/** Expira `enviada` vencida com o relógio do backend (sem job de limpeza). */
export function expireProposalIfNeeded(
  db: ClinicDb,
  tenantId: string,
  proposalId: string,
  clock: Clock,
): AppointmentProposalRow | null {
  const current = getProposal(db, tenantId, proposalId)
  if (!current) return null
  if (current.state !== 'enviada') return current
  if (current.expiresAt == null || clock.nowMs() < current.expiresAt) return current
  try {
    return transitionRow(db, tenantId, proposalId, 'enviada', 'expirada', clock, {
      expectedVersion: current.version,
    })
  } catch (err) {
    if (err instanceof ConflictError) {
      return getProposal(db, tenantId, proposalId)
    }
    throw err
  }
}

export function getActiveProposalForConversation(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  clock: Clock,
): AppointmentProposalRow | null {
  const row = db.get<ProposalSql>(
    `SELECT * FROM appointment_proposals
     WHERE tenant_id = ? AND conversation_id = ? AND state IN ('preparada', 'envio_pendente', 'envio_incerto', 'enviada')
     ORDER BY version DESC, created_at DESC
     LIMIT 1`,
    tenantId,
    conversationId,
  )
  if (!row) return null
  const refreshed = expireProposalIfNeeded(db, tenantId, row.id, clock)
  if (!refreshed || !isOpenState(refreshed.state)) return null
  return refreshed
}

export function getActiveProposalForContact(
  db: ClinicDb,
  tenantId: string,
  contactId: string,
  clock: Clock,
): AppointmentProposalRow | null {
  const row = db.get<ProposalSql>(
    `SELECT * FROM appointment_proposals
     WHERE tenant_id = ? AND contact_id = ? AND state IN ('preparada', 'envio_pendente', 'envio_incerto', 'enviada')
     ORDER BY version DESC, created_at DESC
     LIMIT 1`,
    tenantId,
    contactId,
  )
  if (!row) return null
  const refreshed = expireProposalIfNeeded(db, tenantId, row.id, clock)
  if (!refreshed || !isOpenState(refreshed.state)) return null
  return refreshed
}

function resolveFacts(
  db: ClinicDb,
  tenantId: string,
  input: CreateAppointmentProposalInput,
  clock: Clock,
): Omit<
  AppointmentProposalRow,
  | 'id'
  | 'tenantId'
  | 'lineageId'
  | 'version'
  | 'state'
  | 'expiresAt'
  | 'sentAt'
  | 'supersededById'
  | 'appointmentId'
  | 'createdAt'
  | 'updatedAt'
> & { zoneKey: string; zones: ZoneSnapshot[]; combo: ComboSnapshot | null } {
  const contact = getContact(db, tenantId, input.contactId)
  if (!contact) {
    throw new NotFoundError('contact_not_found', 'Contacto não encontrado nesta clínica')
  }
  const conversation = getConversation(db, tenantId, input.conversationId)
  if (!conversation) {
    throw new NotFoundError('conversation_not_found', 'Conversa não encontrada nesta clínica')
  }
  if (conversation.contactId !== contact.id) {
    throw new ValidationError(
      'conversation_contact_mismatch',
      'A conversa não pertence ao contacto indicado',
      { conversationId: input.conversationId, contactId: input.contactId },
    )
  }

  const service = getService(db, tenantId, input.serviceId)
  if (!service || !service.active) {
    throw new ValidationError(
      'service_inactive_or_missing',
      'Serviço inativo ou inexistente para proposta',
      { serviceId: input.serviceId },
    )
  }

  let professionalId: string | null = input.professionalId ?? null
  let professionalName: string | null = null
  if (professionalId) {
    const pro = getResource(db, tenantId, professionalId, clock)
    if (!pro || pro.kind !== 'professional' || !pro.active) {
      throw new ValidationError(
        'professional_unusable',
        'Profissional inativo ou inexistente para proposta',
        { professionalId },
      )
    }
    if (service.professionalIds.length > 0 && !service.professionalIds.includes(professionalId)) {
      throw new ValidationError(
        'professional_not_on_service',
        'Profissional não está ligado a este serviço',
        { professionalId, serviceId: service.id },
      )
    }
    professionalName = pro.name
  } else if (service.professionalIds.length === 1) {
    professionalId = service.professionalIds[0]!
    const pro = getResource(db, tenantId, professionalId, clock)
    professionalName = pro?.name ?? null
  }

  const quote = quoteVisit(db, tenantId, service, input.zoneIds)
  const durationMinutes = quote.durationMinutes
  if (input.durationMinutes != null && input.durationMinutes !== durationMinutes) {
    throw new ValidationError(
      'duration_not_adjustable',
      'a duração do procedimento não se ajusta ao agendar',
      { serviceId: service.id, durationMinutes },
    )
  }
  const startsAt = input.startsAt
  if (!Number.isFinite(startsAt) || startsAt <= 0) {
    throw new ValidationError('invalid_starts_at', 'Início da proposta inválido')
  }
  const endsAt = startsAt + durationMinutes * 60_000
  if (endsAt <= startsAt) {
    throw new ValidationError('invalid_ends_at', 'Fim da proposta deve ser depois do início')
  }

  const beneficiaryKind = input.beneficiaryKind ?? 'titular'
  let beneficiaryName = (input.beneficiaryName ?? '').trim()
  if (beneficiaryKind === 'titular') {
    beneficiaryName = (contact.displayName ?? '').trim() || 'Cliente'
  } else if (!beneficiaryName) {
    throw new ValidationError(
      'beneficiary_name_required',
      'Nome da beneficiária é obrigatório para terceiro',
    )
  }

  const settings = ensureClinicSettings(db, tenantId, clock)
  const signalConditions =
    input.signalConditionsText?.trim() ||
    (service.requiresSignal ? settings.signalCancellationPolicy || '' : '')

  return {
    contactId: contact.id,
    conversationId: conversation.id,
    clinicLocationText: settings.clinicAddress || '',
    beneficiaryKind,
    beneficiaryName,
    serviceId: service.id,
    serviceName: service.name,
    professionalId,
    professionalName,
    startsAt,
    endsAt,
    durationMinutes,
    timezone: settings.timezone,
    priceCents: quote.priceCents,
    zoneKey: quote.zones.map((z) => z.zoneId).join(','),
    zones: quote.zones,
    combo: quote.combo,
    requiresSignal: service.requiresSignal,
    signalKind: service.signalKind,
    signalFixedCents: service.signalFixedCents,
    signalPercent: service.signalPercent,
    signalConditionsText: signalConditions,
    sendOutboundId: null,
    sendMessageId: null,
    sendProviderMessageId: null,
    resultOutboundId: null,
    resultKind: null,
    tempoCeu: service.tempoCeu,
    tempoTemperatura: service.tempoTemperatura,
    tempoCelsius: service.tempoCelsius,
  }
}

function insertProposalRow(
  db: ClinicDb,
  tenantId: string,
  facts: ReturnType<typeof resolveFacts>,
  opts: { lineageId: string; version: number; id?: string },
  clock: Clock,
): AppointmentProposalRow {
  const now = clock.nowMs()
  const id = opts.id ?? newId('aprop')
  db.run(
    `INSERT INTO appointment_proposals (
      id, tenant_id, lineage_id, version, contact_id, conversation_id, state,
      clinic_location_text, beneficiary_kind, beneficiary_name,
      service_id, service_name, professional_id, professional_name,
      starts_at, ends_at, duration_minutes, timezone, price_cents,
      requires_signal, signal_kind, signal_fixed_cents, signal_percent, signal_conditions_text,
      expires_at, sent_at, superseded_by_id, appointment_id, created_at, updated_at,
      tempo_ceu, tempo_temperatura, tempo_celsius
    ) VALUES (
      ?, ?, ?, ?, ?, ?, 'preparada',
      ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      NULL, NULL, NULL, NULL, ?, ?,
      ?, ?, ?
    )`,
    id,
    tenantId,
    opts.lineageId,
    opts.version,
    facts.contactId,
    facts.conversationId,
    facts.clinicLocationText,
    facts.beneficiaryKind,
    facts.beneficiaryName,
    facts.serviceId,
    facts.serviceName,
    facts.professionalId,
    facts.professionalName,
    facts.startsAt,
    facts.endsAt,
    facts.durationMinutes,
    facts.timezone,
    facts.priceCents,
    facts.requiresSignal ? 1 : 0,
    facts.signalKind,
    facts.signalFixedCents,
    facts.signalPercent,
    facts.signalConditionsText,
    now,
    now,
    facts.tempoCeu,
    facts.tempoTemperatura,
    facts.tempoCelsius,
  )
  return getProposal(db, tenantId, id)!
}

function markSuperseded(
  db: ClinicDb,
  tenantId: string,
  previous: AppointmentProposalRow,
  nextId: string,
  clock: Clock,
): void {
  if (!isOpenState(previous.state)) return
  transitionRow(db, tenantId, previous.id, previous.state, 'substituida', clock, {
    supersededById: nextId,
    expectedVersion: previous.version,
  })
}

export type CreateProposalOptions = {
  /** Limites S7 — desligados por padrão; ao ligar, conta propostas criadas/pendentes. */
  abuseLimits?: AbuseLimits
}

/**
 * Cria proposta em `preparada`. Se já houver versão aberta na conversa com os mesmos
 * factos materiais, devolve-a (idempotente). Mudança material → substitui e cria nova versão.
 * Não reserva horário.
 */
export function createOrSupersedeProposal(
  db: ClinicDb,
  tenantId: string,
  input: CreateAppointmentProposalInput,
  clock: Clock,
  options: CreateProposalOptions = {},
): { proposal: AppointmentProposalRow; superseded: AppointmentProposalRow | null } {
  return db.transactionSync(() => {
    const facts = resolveFacts(db, tenantId, input, clock)
    const active = getActiveProposalForConversation(db, tenantId, facts.conversationId, clock)

    if (active) {
      const same =
        materialKey({
          serviceId: active.serviceId,
          professionalId: active.professionalId,
          startsAt: active.startsAt,
          endsAt: active.endsAt,
          beneficiaryKind: active.beneficiaryKind,
          beneficiaryName: active.beneficiaryName,
          priceCents: active.priceCents,
          requiresSignal: active.requiresSignal,
          signalKind: active.signalKind,
          signalFixedCents: active.signalFixedCents,
          signalPercent: active.signalPercent,
          zoneKey: readProposalZoneKey(db, tenantId, active.id),
        }) ===
        materialKey({
          serviceId: facts.serviceId,
          professionalId: facts.professionalId,
          startsAt: facts.startsAt,
          endsAt: facts.endsAt,
          beneficiaryKind: facts.beneficiaryKind,
          beneficiaryName: facts.beneficiaryName,
          priceCents: facts.priceCents,
          requiresSignal: facts.requiresSignal,
          signalKind: facts.signalKind,
          signalFixedCents: facts.signalFixedCents,
          signalPercent: facts.signalPercent,
          zoneKey: facts.zoneKey,
        })
      if (same) {
        return { proposal: active, superseded: null }
      }
    }

    const limits = options.abuseLimits
    if (limits?.enabled) {
      // Substituição: a pendente actual será fechada — não bloquear por pending=1.
      // Ainda contamos criação na janela (contacto + clínica).
      const decision = checkAutomationQuota(
        db,
        active
          ? {
              ...limits,
              // Folga só o teto de pendentes; quotas de criação mantêm-se.
              pendingProposalsPerContact: Number.MAX_SAFE_INTEGER,
            }
          : limits,
        { tenantId, contactId: facts.contactId, effect: 'proposal' },
        clock,
      )
      if (!decision.allowed) {
        recordLimitReached(
          db,
          limits,
          {
            tenantId,
            contactId: facts.contactId,
            effect: 'proposal',
            decision,
          },
          clock,
        )
        throw new ConflictError('abuse_limit_reached', decision.message, {
          limit: decision.limit,
          scope: decision.scope,
          max: decision.max,
          used: decision.used,
        })
      }
    }

    if (active) {
      const nextId = newId('aprop')
      // Fecha a anterior antes de inserir a nova (evita duas abertas e o teto pending=1).
      markSuperseded(db, tenantId, active, nextId, clock)
      const next = insertProposalRow(
        db,
        tenantId,
        facts,
        { lineageId: active.lineageId, version: active.version + 1, id: nextId },
        clock,
      )
      writeZoneSnapshots(db, tenantId, 'proposal', next.id, facts.zones, facts.combo)
      return { proposal: next, superseded: getProposal(db, tenantId, active.id) }
    }

    const id = newId('aprop')
    const proposal = insertProposalRow(
      db,
      tenantId,
      facts,
      { lineageId: id, version: 1, id },
      clock,
    )
    writeZoneSnapshots(db, tenantId, 'proposal', proposal.id, facts.zones, facts.combo)
    return { proposal, superseded: null }
  })
}

/** Alias estável da API do módulo (S3). */
export function createProposal(
  db: ClinicDb,
  tenantId: string,
  input: CreateAppointmentProposalInput,
  clock: Clock,
  options: CreateProposalOptions = {},
): AppointmentProposalRow {
  return createOrSupersedeProposal(db, tenantId, input, clock, options).proposal
}

export function markProposalSendPending(
  db: ClinicDb,
  tenantId: string,
  proposalId: string,
  clock: Clock,
): AppointmentProposalRow {
  const current = expireProposalIfNeeded(db, tenantId, proposalId, clock)
  if (!current) throw new NotFoundError('proposal_not_found', 'Proposta não encontrada')
  if (current.state === 'envio_pendente') return current
  if (current.state === 'envio_incerto') {
    return transitionRow(db, tenantId, proposalId, 'envio_incerto', 'envio_pendente', clock, {
      expectedVersion: current.version,
    })
  }
  return transitionRow(db, tenantId, proposalId, current.state, 'envio_pendente', clock, {
    expectedVersion: current.version,
  })
}

export function markProposalSendUncertain(
  db: ClinicDb,
  tenantId: string,
  proposalId: string,
  clock: Clock,
): AppointmentProposalRow {
  const current = expireProposalIfNeeded(db, tenantId, proposalId, clock)
  if (!current) throw new NotFoundError('proposal_not_found', 'Proposta não encontrada')
  if (current.state === 'envio_incerto') return current
  return transitionRow(db, tenantId, proposalId, current.state, 'envio_incerto', clock, {
    expectedVersion: current.version,
  })
}

/**
 * Marca como enviada e inicia a vigência de 30 min (relógio do backend).
 * Costura para S4 — não envia WhatsApp aqui.
 */
export function markProposalSent(
  db: ClinicDb,
  tenantId: string,
  proposalId: string,
  clock: Clock,
): AppointmentProposalRow {
  const current = getProposal(db, tenantId, proposalId)
  if (!current) throw new NotFoundError('proposal_not_found', 'Proposta não encontrada')
  if (current.state === 'enviada') return current
  const now = clock.nowMs()
  return transitionRow(db, tenantId, proposalId, current.state, 'enviada', clock, {
    sentAt: now,
    expiresAt: now + APPOINTMENT_PROPOSAL_VALIDITY_MS,
    expectedVersion: current.version,
  })
}

/**
 * Costura S5: consome autorização para marcação / Pix.
 * Não cria compromisso — só a transição de estado.
 */
export function markProposalConfirmed(
  db: ClinicDb,
  tenantId: string,
  proposalId: string,
  clock: Clock,
  appointmentId?: string | null,
): AppointmentProposalRow {
  const current = expireProposalIfNeeded(db, tenantId, proposalId, clock)
  if (!current) throw new NotFoundError('proposal_not_found', 'Proposta não encontrada')
  if (current.state === 'confirmada') return current
  return transitionRow(db, tenantId, proposalId, current.state, 'confirmada', clock, {
    appointmentId: appointmentId ?? current.appointmentId,
    expectedVersion: current.version,
  })
}

export function markProposalTempoRefused(
  db: ClinicDb,
  tenantId: string,
  proposalId: string,
  clock: Clock,
): AppointmentProposalRow {
  const current = expireProposalIfNeeded(db, tenantId, proposalId, clock)
  if (!current) throw new NotFoundError('proposal_not_found', 'Proposta não encontrada')
  if (current.state === 'recusada_tempo') return current
  return transitionRow(db, tenantId, proposalId, current.state, 'recusada_tempo', clock, {
    expectedVersion: current.version,
  })
}

export function markProposalSlotRefused(
  db: ClinicDb,
  tenantId: string,
  proposalId: string,
  clock: Clock,
): AppointmentProposalRow {
  const current = expireProposalIfNeeded(db, tenantId, proposalId, clock)
  if (!current) throw new NotFoundError('proposal_not_found', 'Proposta não encontrada')
  if (current.state === 'recusada_vaga') return current
  return transitionRow(db, tenantId, proposalId, current.state, 'recusada_vaga', clock, {
    expectedVersion: current.version,
  })
}

export function markProposalForwarded(
  db: ClinicDb,
  tenantId: string,
  proposalId: string,
  clock: Clock,
): AppointmentProposalRow {
  const current = expireProposalIfNeeded(db, tenantId, proposalId, clock)
  if (!current) throw new NotFoundError('proposal_not_found', 'Proposta não encontrada')
  if (current.state === 'encaminhada') return current
  return transitionRow(db, tenantId, proposalId, current.state, 'encaminhada', clock, {
    expectedVersion: current.version,
  })
}

/**
 * Tentativa de «restaurar» autorização consumida — sempre recusada.
 * Cobre o requisito de restore sem reativar autorização consumida.
 */
export function restoreProposalAuthorization(
  db: ClinicDb,
  tenantId: string,
  proposalId: string,
  clock: Clock,
): never {
  const current = getProposal(db, tenantId, proposalId)
  if (!current) {
    throw new NotFoundError('proposal_not_found', 'Proposta não encontrada')
  }
  void clock
  throw new ConflictError(
    'proposal_authorization_consumed',
    'Autorização consumida ou terminada não pode ser reativada',
    { proposalId, state: current.state },
  )
}

/**
 * Avalia se o id (opaco) autoriza clique. Conhecer o id não basta.
 * IDs fabricados (inexistentes neste tenant) → `fabricated_id`.
 */
export function evaluateProposalAuthorization(
  db: ClinicDb,
  input: {
    tenantId: string
    proposalId: string
    contactId: string
    conversationId: string
  },
  clock: Clock,
): ProposalAuthorizationResult {
  const raw = db.get<ProposalSql>(
    `SELECT * FROM appointment_proposals WHERE tenant_id = ? AND id = ?`,
    input.tenantId,
    input.proposalId,
  )
  if (!raw) {
    // Também rejeita id existente noutro tenant: a query já filtra por tenant_id.
    const any = db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM appointment_proposals WHERE id = ?`,
      input.proposalId,
    )
    return {
      allowed: false,
      reason: (any?.n ?? 0) > 0 ? 'tenant_mismatch' : 'fabricated_id',
      proposal: null,
    }
  }
  let proposal = mapRow(raw)
  proposal = expireProposalIfNeeded(db, input.tenantId, proposal.id, clock) ?? proposal
  if (proposal.contactId !== input.contactId) {
    return { allowed: false, reason: 'contact_mismatch', proposal }
  }
  if (proposal.conversationId !== input.conversationId) {
    return { allowed: false, reason: 'conversation_mismatch', proposal }
  }
  if (proposal.state === 'expirada') {
    return { allowed: false, reason: 'expired', proposal }
  }
  if (proposal.state !== 'enviada') {
    return { allowed: false, reason: 'not_enviada', proposal }
  }
  if (proposal.expiresAt != null && clock.nowMs() >= proposal.expiresAt) {
    const expired = expireProposalIfNeeded(db, input.tenantId, proposal.id, clock)
    return { allowed: false, reason: 'expired', proposal: expired ?? proposal }
  }
  return { allowed: true, proposal }
}

/** Contagem para limites de abuso (S7) — propostas criadas na janela. */
export function countProposalsCreated(
  db: ClinicDb,
  tenantId: string,
  since: number,
  contactId?: string,
): number {
  const row = db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM appointment_proposals
     WHERE tenant_id = ? AND created_at >= ?${contactId ? ' AND contact_id = ?' : ''}`,
    ...[tenantId, since, ...(contactId ? [contactId] : [])],
  )
  return row?.n ?? 0
}

/** Propostas ainda abertas (não consumidas / terminais) por contacto. */
export function countPendingProposalsForContact(
  db: ClinicDb,
  tenantId: string,
  contactId: string,
): number {
  const row = db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM appointment_proposals
     WHERE tenant_id = ? AND contact_id = ?
       AND state IN ('preparada', 'envio_pendente', 'envio_incerto', 'enviada')`,
    tenantId,
    contactId,
  )
  return row?.n ?? 0
}

/** Contagem de propostas (qualquer estado) por serviço — apagar serviço / histórico. */
export function countProposalsForService(
  db: ClinicDb,
  tenantId: string,
  serviceId: string,
  onlyOpen = false,
): number {
  const extra = onlyOpen
    ? ` AND state IN ('preparada', 'envio_pendente', 'envio_incerto', 'enviada')`
    : ''
  const row = db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM appointment_proposals
     WHERE tenant_id = ? AND service_id = ?${extra}`,
    tenantId,
    serviceId,
  )
  return row?.n ?? 0
}
