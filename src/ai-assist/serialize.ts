import type { AiSuggestionRow } from '../clinic/ai'

export function serializeAiSuggestion(row: AiSuggestionRow) {
  return {
    id: row.id,
    conversationId: row.conversationId,
    kind: row.kind,
    status: row.status,
    provider: row.provider,
    model: row.model,
    suggestedText: row.suggestedText,
    warningCodes: row.warningCodes,
    warningLabels: row.warningLabels,
    sourceRefs: row.sourceRefs.map((s) => ({
      serviceName: s.serviceName,
      kind: s.kind,
      label: `Fonte: explicação cadastrada pela clínica em ${s.serviceName}`,
    })),
    requestMeta: {
      latencyMs: row.requestMeta.latencyMs,
      inputTokens: row.requestMeta.inputTokens,
      outputTokens: row.requestMeta.outputTokens,
      messageCount: row.requestMeta.messageCount,
      mode: row.requestMeta.mode,
    },
    errorCode: row.errorCode,
    requestedByClerkUserId: row.requestedByClerkUserId,
    requestedByDisplayName: row.requestedByDisplayName,
    decision: row.decision,
    decidedByClerkUserId: row.decidedByClerkUserId,
    decidedAt: row.decidedAt,
    revisedText: row.revisedText,
    outboundMessageId: row.outboundMessageId,
    parentSuggestionId: row.parentSuggestionId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    /** Sempre false — AC-06 / ADR-0004. */
    messageSent: false as const,
  }
}
