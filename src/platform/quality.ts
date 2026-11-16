/**
 * Qualidade da IA na Platform Admin (#834, PA-07, DEC-193).
 * Reaproveita as mesmas funções do Review MCP (DEC-159): métricas de conversa, sombra do interpretador
 * e amostras de revisão, sem duplicar cálculo. Por decisão do Paulo (Q-PA-01) o superadmin vê o texto das
 * amostras, com a mesma retenção de 30 dias; o telefone da cliente sai mascarado e cada leitura fica auditada.
 */
import type { AsyncAdminDb } from '../db/admin/async-store'
import { newId } from '../db/admin/ids'
import type { ReviewSampleDetail, ReviewSampleListItem } from '../review-samples'

/** Só os últimos 4 dígitos: chega para distinguir contactos sem expor o número. */
export function maskPhone(waId: string | null): string | null {
  if (!waId) return null
  const digits = waId.replace(/\D/g, '')
  return digits.length <= 4 ? '••••' : `••••${digits.slice(-4)}`
}

export function serializeSampleItem(i: ReviewSampleListItem) {
  return {
    id: i.id,
    tenantId: i.tenantId,
    tenantName: i.tenantName,
    conversationId: i.conversationId,
    contactDisplayName: i.contactDisplayName,
    contactPhoneMasked: maskPhone(i.contactWaId),
    flagSource: i.flagSource,
    flagReason: i.flagReason,
    clientComment: i.clientComment,
    clientComments: i.clientComments,
    flaggedAt: i.flaggedAt,
    expiresAt: i.expiresAt,
    messageCount: i.messageCount,
    lastMessageAt: i.lastMessageAt,
    lastMessagePreview: i.lastMessagePreview,
  }
}

export function serializeSampleDetail(d: ReviewSampleDetail) {
  return {
    ...serializeSampleItem(d),
    messages: d.messages.map((m) => ({
      id: m.id,
      seq: m.seq,
      direction: m.direction,
      body: m.body,
      createdAt: m.createdAt,
      deliveryState: m.deliveryState,
      authorDisplayName: m.authorDisplayName,
    })),
  }
}

/** Ler o texto de uma amostra é um acesso a dados de clientes: fica na auditoria central (ator, clínica, amostra). */
export async function recordSampleRead(
  db: AsyncAdminDb,
  input: { actorClerkUserId: string; tenantId: string; sampleId: string; nowMs: number },
): Promise<void> {
  await db.run(
    `INSERT INTO central_audit_events (
       id, occurred_at, actor_clerk_user_id, subject_clerk_user_id, tenant_id,
       action, object_type, object_id, outcome, support_session_id, metadata_json
     ) VALUES (?, ?, ?, NULL, ?, 'review.sample.read', 'review_sample', ?, 'success', NULL, NULL)`,
    newId('aud'),
    input.nowMs,
    input.actorClerkUserId,
    input.tenantId,
    input.sampleId,
  )
}
