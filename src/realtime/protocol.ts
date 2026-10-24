/**
 * Contrato de mensagens WebSocket da clínica (issue #23 / REQ-040–042).
 * Sem tokens brutos, sem PHI além do mínimo já persistido e autorizado.
 */

export const REALTIME_PROTOCOL_VERSION = 1 as const

/** Headers internos Worker→DO no upgrade WS (não são tokens). */
export const WS_INTERNAL_HEADERS = {
  assertion: 'x-tredane-assertion',
  tenantId: 'x-tredane-tenant-id',
  clerkUserId: 'x-tredane-clerk-user-id',
  sessionId: 'x-tredane-session-id',
  role: 'x-tredane-role',
} as const

export const WORKER_WS_ASSERTION = 'tredane-worker-ws-v1'

export type ConnectionUiState =
  | 'live'
  | 'offline'
  | 'reconnecting'
  | 'access_revoked'

export type FenceSource =
  | 'membership_revoke'
  | 'tenant_suspend'
  | 'tenant_pending_deletion'
  | 'tenant_reactivate'
  | 'support_revoke'
  | 'superadmin'
  | 'authority_recheck'

export type AccessRevokeReason =
  | 'membership_revoked'
  | 'tenant_not_active'
  | 'not_member'
  | 'support_revoked'
  | 'session_expired'
  | 'authority_unavailable'

/** Metadados mínimos no WebSocket — sobrevivem à hibernação; nunca tokens. */
export type SocketAttachment = {
  connectionId: string
  clerkUserId: string
  /** ID de sessão Clerk (correlação); não é credencial reutilizável. */
  sessionId: string
  role: 'owner' | 'attendant'
  tenantId: string
  /** Epoch local do fence no momento do accept. */
  authEpoch: number
  connectedAt: number
}

export type HelloMessage = {
  v: typeof REALTIME_PROTOCOL_VERSION
  type: 'hello'
  connectionId: string
  tenantId: string
  eventSeq: number
  role: 'owner' | 'attendant'
  connectionState: 'live'
}

export type EventMessage = {
  v: typeof REALTIME_PROTOCOL_VERSION
  type: 'event'
  seq: number
  eventId: string
  eventType: string
  entity: { type: string; id: string }
  occurredAt: number
  payload: Record<string, unknown>
}

export type AccessRevokedMessage = {
  v: typeof REALTIME_PROTOCOL_VERSION
  type: 'access_revoked'
  tenantId: string
  reason: AccessRevokeReason
  /** Sem payload clínico. */
}

export type ErrorMessage = {
  v: typeof REALTIME_PROTOCOL_VERSION
  type: 'error'
  code: string
  message: string
}

export type ServerMessage =
  | HelloMessage
  | EventMessage
  | AccessRevokedMessage
  | ErrorMessage

export type ClientPingMessage = {
  v: typeof REALTIME_PROTOCOL_VERSION
  type: 'ping'
}

export type ClientMessage = ClientPingMessage

export function encodeServerMessage(msg: ServerMessage): string {
  return JSON.stringify(msg)
}

export function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const data = JSON.parse(raw) as { v?: unknown; type?: unknown }
    if (data.v !== REALTIME_PROTOCOL_VERSION) return null
    if (data.type === 'ping') return { v: 1, type: 'ping' }
    return null
  } catch {
    return null
  }
}

/**
 * Máquina de estados da conexão para a UI (REQ-042).
 * Biblioteca — não é tela produtiva do painel (#22).
 */
export function reduceConnectionUiState(
  prev: ConnectionUiState,
  signal:
    | { kind: 'connected' }
    | { kind: 'disconnected' }
    | { kind: 'reconnecting' }
    | { kind: 'access_revoked' }
    | { kind: 'reconciled' },
): ConnectionUiState {
  if (signal.kind === 'access_revoked') return 'access_revoked'
  if (prev === 'access_revoked') return 'access_revoked'
  switch (signal.kind) {
    case 'connected':
    case 'reconciled':
      return 'live'
    case 'disconnected':
      return 'offline'
    case 'reconnecting':
      return 'reconnecting'
  }
}
