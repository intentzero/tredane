import type {
  WhatsappConnectionView,
  WhatsappSignupSessionView,
} from './types'

/** Nunca incluir tokens, códigos ou cipher. */
export function serializeConnection(view: WhatsappConnectionView) {
  return {
    status: view.status,
    phoneNumberId: view.phoneNumberId,
    wabaId: view.wabaId,
    displayPhone: view.displayPhone,
    displayName: view.displayName,
    connectedAt: view.connectedAt,
    connectedByClerkUserId: view.connectedByClerkUserId,
    interruptedAt: view.interruptedAt,
    interruptReason: view.interruptReason,
    lastInboundAt: view.lastInboundAt,
    messageTemplates: view.messageTemplates,
    history: view.history.map((h) => ({
      id: h.id,
      action: h.action,
      actorClerkUserId: h.actorClerkUserId,
      phoneNumberId: h.phoneNumberId,
      occurredAt: h.occurredAt,
      detail: h.detail,
    })),
    metaMode: view.metaMode,
  }
}

export function serializeSignupSession(session: WhatsappSignupSessionView) {
  return {
    sessionId: session.sessionId,
    state: session.state,
    purpose: session.purpose,
    expiresAt: session.expiresAt,
    metaMode: session.metaMode,
    metaAppId: session.metaAppId,
    metaConfigId: session.metaConfigId,
    graphApiVersion: session.graphApiVersion,
  }
}

export function assertNoSecretsInPayload(payload: unknown): void {
  const json = JSON.stringify(payload)
  const banned = [
    'access_token',
    'accessToken',
    'synth_token_',
    'client_secret',
    'access_token_cipher',
  ]
  for (const b of banned) {
    if (json.includes(b)) {
      throw new Error(`secret_leaked:${b}`)
    }
  }
}
