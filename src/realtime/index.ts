/**
 * Tempo real, reconciliação e revogação D1→DO (issue #23).
 */
export {
  REALTIME_PROTOCOL_VERSION,
  WORKER_WS_ASSERTION,
  WS_INTERNAL_HEADERS,
  reduceConnectionUiState,
  encodeServerMessage,
  parseClientMessage,
  activeViewerUserIds,
  PRESENCE_TTL_MS,
  type ConnectionUiState,
  type SocketAttachment,
  type ServerMessage,
  type ClientMessage,
  type FenceSource,
  type AccessRevokeReason,
  type HelloMessage,
  type EventMessage,
  type AccessRevokedMessage,
} from './protocol'
export {
  createRealtimeRoutes,
  createDoInvalidator,
  createDoEventPublisher,
  type RealtimeRouteOptions,
  type ClinicEventPublisher,
} from './routes'
export {
  createD1AccessAuthority,
  createMapAccessAuthority,
  type AccessAuthority,
  type AccessDecision,
} from './authority'
export {
  ensureRealtimeFence,
  readFence,
  bumpAuthEpoch,
  setTenantSuspendedFence,
  denyUserAccess,
  getAccessDenial,
  localFenceBlocks,
  type RealtimeFence,
  type AccessDenial,
} from './fence'
export {
  appendRealtimeEvent,
  listRealtimeEventsAfter,
  getLastEventSeq,
  mergeEventsById,
  isEventVisibleToRole,
  eventAudience,
  type RealtimeEventRow,
  type AppendRealtimeEventInput,
  type RealtimeAudience,
} from './events'
export {
  deliverEventToSockets,
  closeUserSockets,
  closeAllSockets,
  type DeliverySocket,
  type DeliveryResult,
} from './fanout'
export {
  revokeMembershipAndPropagate,
  suspendTenantAndPropagate,
  reactivateTenantAndPropagate,
  markPendingDeletionAndPropagate,
  createFailingInvalidator,
  type ClinicAccessInvalidator,
  type RevokePropagationResult,
  type SuspendPropagationResult,
  type ReactivatePropagationResult,
  type PendingDeletionPropagationResult,
} from './revoke'
