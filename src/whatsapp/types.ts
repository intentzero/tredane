/** Tipos do canal WhatsApp (#31 / DEC-009 / REQ-051). */

export const WHATSAPP_BINDING_STATUSES = [
  'active',
  'interrupted',
  'released',
] as const

export type WhatsappBindingStatus = (typeof WHATSAPP_BINDING_STATUSES)[number]

export const WHATSAPP_SIGNUP_PURPOSES = [
  'connect',
  'reconnect',
  'replace',
] as const

export type WhatsappSignupPurpose = (typeof WHATSAPP_SIGNUP_PURPOSES)[number]

export const WHATSAPP_SIGNUP_STATUSES = [
  'pending',
  'consumed',
  'expired',
  'cancelled',
] as const

export type WhatsappSignupStatus = (typeof WHATSAPP_SIGNUP_STATUSES)[number]

export type MetaMode = 'synthetic' | 'live'

/** Vista segura para API/UI — sem tokens nem códigos. */
export type WhatsappConnectionView = {
  status: 'disconnected' | 'connected' | 'interrupted'
  phoneNumberId: string | null
  wabaId: string | null
  displayPhone: string | null
  displayName: string | null
  connectedAt: number | null
  connectedByClerkUserId: string | null
  interruptedAt: number | null
  interruptReason: string | null
  lastInboundAt: number | null
  /** Modelos Meta — placeholder até #34; lista vazia no MVP-17. */
  messageTemplates: Array<{
    name: string
    status: 'approved' | 'pending' | 'rejected'
  }>
  history: WhatsappHistoryItem[]
  metaMode: MetaMode
}

export type WhatsappHistoryItem = {
  id: string
  action: string
  actorClerkUserId: string | null
  phoneNumberId: string | null
  occurredAt: number
  detail: Record<string, unknown> | null
}

export type WhatsappSignupSessionView = {
  sessionId: string
  state: string
  purpose: WhatsappSignupPurpose
  expiresAt: number
  metaMode: MetaMode
  /** App ID público Meta (só modo live). */
  metaAppId: string | null
  /** Config ID do Embedded Signup (só modo live). */
  metaConfigId: string | null
  /** Graph API version sugerida. */
  graphApiVersion: string
}

export type CompleteSignupInput = {
  state: string
  code: string
  phoneNumberId: string
  wabaId: string
  displayPhone?: string | null
  displayName?: string | null
}

export type MetaTokenExchangeResult = {
  accessToken: string
  tokenType: string | null
  expiresIn: number | null
  phoneNumberId: string
  wabaId: string
  displayPhone: string
  displayName: string | null
}

export type BindingRow = {
  id: string
  phoneNumberId: string
  tenantId: string
  wabaId: string
  displayPhone: string
  displayName: string | null
  status: WhatsappBindingStatus
  connectedAt: number
  connectedByClerkUserId: string
  interruptedAt: number | null
  interruptReason: string | null
  releasedAt: number | null
  releasedByClerkUserId: string | null
  updatedAt: number
}
