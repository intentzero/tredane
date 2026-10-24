import {
  AI_CONTEXT_MESSAGE_LIMIT_PROPOSED,
  redactProhibitedFromText,
} from '../../ai'
import type { AiCatalogService, AiContextPayload } from '../../ai/types'
import { listServices } from '../config/services'
import { getContact } from '../contacts'
import { getConversation } from '../inbox/conversations'
import { listMessages } from '../inbox/messages'
import { findOpenOpportunityForConversation } from '../pipeline/opportunities'
import type { ClinicDb } from '../store'
import { NotFoundError } from '../errors'

/** Extrai primeiro nome do display_name (DEC-011 — nunca telefone). */
export function firstNameFromDisplayName(displayName: string | null): string | null {
  if (!displayName) return null
  const part = displayName.trim().split(/\s+/)[0]
  return part && part.length > 0 ? part : null
}

/**
 * Constrói contexto mínimo autorizado (REQ-072 / AC-37).
 * Exclui: telefone/wa_id, anexos, outras conversas, outros tenants.
 */
export function buildAiContextPayload(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  opts: { messageLimit?: number } = {},
): {
  payload: AiContextPayload
  contactId: string
  /** Presente só para asserts de isolamento em testes — NÃO enviado ao provedor. */
  _debugExcluded: {
    waIdPresent: boolean
    attachmentCount: number
    otherConversationIds: string[]
  }
} {
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

  const services = listServices(db, tenantId)
    .filter((s) => s.active)
    .map(
      (s): AiCatalogService => ({
        name: s.name,
        durationMinutes: s.durationMinutes,
        priceCents: s.priceCents,
        clientExplanation: s.clientExplanation,
      }),
    )

  const opportunity = findOpenOpportunityForConversation(db, tenantId, conversationId)

  const payload: AiContextPayload = {
    contactFirstName: firstNameFromDisplayName(contact.displayName),
    stage: opportunity?.stage ?? null,
    services,
    messages: messages.map((m) => ({
      direction: m.direction,
      body: redactProhibitedFromText(m.body),
      // anexos nunca entram — MessageRow.attachments omitidos de propósito
    })),
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
    _debugExcluded: {
      waIdPresent: Boolean(contact.waId),
      attachmentCount,
      otherConversationIds: otherRows.map((r) => r.id),
    },
  }
}

/** Serializa o payload para inspeção — garante ausência de chaves proibidas. */
export function assertContextMinimized(payload: AiContextPayload): void {
  const json = JSON.stringify(payload)
  if (/"waId"|"wa_id"|"phone"|"telefone"|"r2Key"|"r2_key"/i.test(json)) {
    throw new Error('ai_context_contains_prohibited_keys')
  }
  // Nenhum número longo tipo telefone no JSON serializado do primeiro nome
  if (payload.contactFirstName && /\d{8,}/.test(payload.contactFirstName)) {
    throw new Error('ai_context_firstname_looks_like_phone')
  }
}
