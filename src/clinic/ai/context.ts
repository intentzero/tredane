import {
  AI_CONTEXT_MESSAGE_LIMIT_PROPOSED,
  redactProhibitedFromText,
} from '../../ai'
import { countClinicOutbound, hasClinicOutbound } from '../../ai/continuity'
import type { AiCatalogService, AiContextPayload } from '../../ai/types'
import {
  currentClientTurnText,
  explicitAudienceLine,
  filterServicesForLine,
} from '../catalog/audience'
import { listResources } from '../config/resources'
import { listServices } from '../config/services'
import { bestCombo } from '../catalog/combo'
import type { ServiceRow } from '../config/types'
import { getContact } from '../contacts'
import { getConversation } from '../inbox/conversations'
import { listMessages } from '../inbox/messages'
import { findOpenOpportunityForConversation } from '../pipeline/opportunities'
import type { ClinicDb } from '../store'
import { NotFoundError } from '../errors'
import type { Clock } from '../../db/clock'
import type { ForecastAdapter } from '../tempo/evaluate'
import { buildClinicAiContext } from './schedule-context'
import { getScheduleSession, type ScheduleSession } from './schedule-session'
import { needsAudienceLine, zonesForAudienceLine, type AudienceLine } from './variant-line'

/** Extrai primeiro nome do display_name (DEC-011 — nunca telefone). */
export function firstNameFromDisplayName(displayName: string | null): string | null {
  if (!displayName) return null
  const part = displayName.trim().split(/\s+/)[0]
  return part && part.length > 0 ? part : null
}

function lineForService(
  service: ServiceRow,
  turnText: string,
  turnLine: AudienceLine | null,
  session: ScheduleSession | null,
): AudienceLine | null {
  const name = service.name.trim().toLowerCase()
  const named = name.length > 0 && turnText.toLowerCase().includes(name)
  if (turnLine && named) return turnLine
  if (session?.serviceId === service.id) return turnLine ?? session.audienceLine
  return null
}

/** Com linha explícita ou já gravada na sessão, o modelo só vê as variantes dessa linha. */
function zonesForAi(
  service: ServiceRow,
  turnText: string,
  turnLine: AudienceLine | null,
  session: ScheduleSession | null,
): ServiceRow['zones'] {
  const active = service.zones.filter((zone) => zone.active)
  if (!needsAudienceLine(active)) return active
  const line = lineForService(service, turnText, turnLine, session)
  if (!line) return active
  return zonesForAudienceLine(active, line)
}

function sanitizeCatalogField(value: string | null | undefined): string | null {
  if (value == null) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return redactProhibitedFromText(trimmed)
}

/**
 * Constrói contexto mínimo autorizado (REQ-072 / AC-37 / S8 #179).
 * Exclui: telefone/wa_id, anexos, outras conversas, outros tenants, tokens/credenciais.
 */
export async function buildAiContextPayload(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  opts: {
    messageLimit?: number
    /** Com relógio → inclui clínica, data/hora, horários livres e agendamentos. */
    clock?: Clock
    clinicName?: string | null
    forecast?: ForecastAdapter
  } = {},
): Promise<{
  payload: AiContextPayload
  contactId: string
  /** Última mensagem da cliente (a que o rascunho responde). */
  lastInboundMessageId: string | null
  /** Presente só para asserts de isolamento em testes — NÃO enviado ao provedor. */
  _debugExcluded: {
    waIdPresent: boolean
    attachmentCount: number
    otherConversationIds: string[]
  }
}> {
  const conversation = getConversation(db, tenantId, conversationId)
  if (!conversation) {
    throw new NotFoundError('conversation_not_found', 'Conversa não encontrada')
  }

  const contact = getContact(db, tenantId, conversation.contactId)
  if (!contact) {
    throw new NotFoundError('contact_not_found', 'Contacto não encontrado')
  }

  const limit = Math.min(
    Math.max(opts.messageLimit ?? AI_CONTEXT_MESSAGE_LIMIT_PROPOSED, 1),
    AI_CONTEXT_MESSAGE_LIMIT_PROPOSED,
  )
  const { messages } = listMessages(db, tenantId, {
    conversationId,
    limit,
  })

  const turnText = currentClientTurnText(
    messages.map((m) => ({ direction: m.direction, body: m.body })),
  )
  const turnLine = explicitAudienceLine(turnText)
  const scheduleSession = getScheduleSession(db, tenantId, conversationId)
  const catalogResources = opts.clock ? listResources(db, tenantId, opts.clock) : []
  const activeServices = listServices(db, tenantId).filter((s) => s.active)
  const services = filterServicesForLine(activeServices, turnLine).map(
    (s): AiCatalogService => {
      const professionalNames = s.professionalIds
        .map((id) => catalogResources.find((r) => r.id === id)?.name)
        .filter((n): n is string => Boolean(n))
      const roomNames =
        s.roomRequirement.mode === 'rooms'
          ? s.roomRequirement.resourceIds
              .map((id) => catalogResources.find((r) => r.id === id)?.name)
              .filter((n): n is string => Boolean(n))
          : []
      return {
      name: sanitizeCatalogField(s.name) ?? 'Serviço',
      durationMinutes: s.durationMinutes,
      priceCents: s.priceCents,
      clientExplanation: sanitizeCatalogField(s.clientExplanation),
      audiencia: s.audiencia,
      variantKind: s.variantKind,
      variantKindPlural: s.variantKindPlural,
      bufferMinutes: s.bufferMinutes,
      professionalNames,
      roomNames,
      combos: usableCombos(s),
      zones: zonesForAi(s, turnText, turnLine, scheduleSession).map((z) => ({
          name: sanitizeCatalogField(z.name) ?? z.name,
          durationMinutes: z.durationMinutes,
          priceCents: z.priceCents,
          audience: z.audience,
        })),
      }
    },
  )

  const opportunity = findOpenOpportunityForConversation(db, tenantId, conversationId)
  const lastInbound = [...messages].reverse().find((m) => m.direction === 'inbound')

  const contextMessages = messages.map((m) => ({
    direction: m.direction,
    body: redactProhibitedFromText(m.body),
    // anexos nunca entram — MessageRow.attachments omitidos de propósito
  }))

  const payload: AiContextPayload = {
    contactFirstName: firstNameFromDisplayName(contact.displayName),
    stage: opportunity?.stage ?? null,
    services,
    messages: contextMessages,
    hasClinicOutbound: hasClinicOutbound(contextMessages),
    clinicOutboundCount: countClinicOutbound(contextMessages),
  }
  if (scheduleSession) {
    const held = activeServices.find((service) => service.id === scheduleSession.serviceId)
    if (held) {
      payload.schedule = {
        serviceName: sanitizeCatalogField(held.name) ?? held.name,
        dayLabel: scheduleSession.dayLabel,
        period: scheduleSession.period,
        audienceLine: scheduleSession.audienceLine,
      }
    }
  }
  if (opts.clock) {
    payload.clinic = await buildClinicAiContext(db, tenantId, opts.clock, {
      clinicName: opts.clinicName ?? null,
      contactId: contact.id,
      recentTexts: messages.map((m) => m.body),
      forecast: opts.forecast,
    })
  }

  const attRow = db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM attachments
     WHERE tenant_id = ? AND conversation_id = ?`,
    tenantId,
    conversationId,
  )
  const attachmentCount = attRow?.n ?? 0

  // Outras conversas do mesmo tenant (não entram no payload)
  const otherRows = db.all<{ id: string }>(
    `SELECT id FROM conversations
     WHERE tenant_id = ? AND id != ?
     LIMIT 50`,
    tenantId,
    conversationId,
  )

  return {
    payload,
    contactId: contact.id,
    lastInboundMessageId: lastInbound?.id ?? null,
    _debugExcluded: {
      waIdPresent: Boolean(contact.waId),
      attachmentCount,
      otherConversationIds: otherRows.map((r) => r.id),
    },
  }
}

/** Chaves JSON que nunca devem aparecer no payload enviado ao LLM. */
const PROHIBITED_PAYLOAD_KEY_RE =
  /"(waId|wa_id|phone|telefone|mobile|r2Key|r2_key|attachmentId|attachment_id|apiKey|api_key|accessToken|access_token|refreshToken|refresh_token|gatewayToken|gateway_token|authorization|credential|secret|password|privateKey|private_key)"\s*:/i

/** Valores tipicamente de credencial / PII proibida no JSON serializado. */
const PROHIBITED_PAYLOAD_VALUE_RE =
  /\b(sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._\-+/=]{8,}|ghp_[A-Za-z0-9]{8,}|xox[baprs]-[A-Za-z0-9-]{8,})\b/i

/**
 * Serializa o payload para inspeção — garante ausência de chaves/valores proibidos (S8 / AC-37).
 * Lança se o contexto mínimo for violado.
 */
export function assertContextMinimized(payload: AiContextPayload): void {
  const json = JSON.stringify(payload)
  if (PROHIBITED_PAYLOAD_KEY_RE.test(json)) {
    throw new Error('ai_context_contains_prohibited_keys')
  }
  if (PROHIBITED_PAYLOAD_VALUE_RE.test(json)) {
    throw new Error('ai_context_contains_prohibited_secrets')
  }
  // Nenhum número longo tipo telefone no JSON serializado do primeiro nome
  if (payload.contactFirstName && /\d{8,}/.test(payload.contactFirstName)) {
    throw new Error('ai_context_firstname_looks_like_phone')
  }
  for (const msg of payload.messages) {
    if (/\+?\d[\d\s().-]{8,}\d/.test(msg.body) || /wa\.me\/\d+/i.test(msg.body)) {
      throw new Error('ai_context_message_contains_phone')
    }
  }
  for (const svc of payload.services) {
    if (/\+?\d[\d\s().-]{8,}\d/.test(svc.name)) {
      throw new Error('ai_context_catalog_contains_phone')
    }
    if (svc.clientExplanation && /\+?\d[\d\s().-]{8,}\d/.test(svc.clientExplanation)) {
      throw new Error('ai_context_catalog_contains_phone')
    }
  }
}

/**
 * Asserts usados em testes S8: o JSON persistido de idempotência não guarda
 * prompts, corpos de mensagem nem inspeção de gateway.
 */
export function assertAiCommandResultMinimized(resultJson: string): void {
  if (
    /"(contextInspection|gatewayInspection|systemPrompt|userContent|messages|services|_debugExcluded)"\s*:/.test(
      resultJson,
    )
  ) {
    throw new Error('ai_command_stores_prohibited_context')
  }
  if (PROHIBITED_PAYLOAD_VALUE_RE.test(resultJson)) {
    throw new Error('ai_command_contains_prohibited_secrets')
  }
}

/** DEC-080 — combos que valem hoje: ativos, com todas as variantes em uso, com preço e mais baratos. */
function usableCombos(service: ServiceRow): NonNullable<AiCatalogService['combos']> {
  const zones = new Map(service.zones.map((z) => [z.id, z]))
  return service.combos
    .filter((combo) => {
      const members = combo.zoneIds.map((id) => zones.get(id))
      if (members.some((z) => !z)) return false
      return Boolean(bestCombo(members as NonNullable<(typeof members)[number]>[], [combo]))
    })
    .map((combo) => ({
      name: sanitizeCatalogField(combo.name) ?? combo.name,
      zoneNames: combo.zoneIds.map((id) => sanitizeCatalogField(zones.get(id)!.name) ?? zones.get(id)!.name),
      priceCents: combo.priceCents,
    }))
}
