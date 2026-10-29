export {
  buildAiContextPayload,
  assertContextMinimized,
  assertAiCommandResultMinimized,
  firstNameFromDisplayName,
} from './context'
export {
  getSuggestion,
  listSuggestionsForConversation,
  insertSuggestion,
  updateSuggestionDecision,
} from './suggestions'
export {
  suggestReplyOp,
  summarizeConversationOp,
  decideSuggestionOp,
  listConversationSuggestionsOp,
  getSuggestionOp,
  attachSuggestionToOutboundOp,
  type SuggestResult,
  type DecideResult,
} from './operations'
export {
  toAiAssistDeps,
  rpcDepsFromEnv,
  parseAutoBookFlag,
  parseAutoBookTenants,
  autoBookCapability,
  type AiAssistRpcDeps,
} from './deps'
export type * from './types'
export {
  enqueueAutoDraft,
  runDueAutoDrafts,
  nextAutoDraftDueAt,
  getConversationDraftState,
  getAutoDraftJob,
  cancelAutoDraft,
  AUTODRAFT_ACTOR_ID,
  type AutoDraftJob,
  type AutoDraftOutcome,
} from './autodraft'
export {
  tryAiAutoBook,
  detectExplicitConfirmation,
  AI_AUTOBOOK_ACTOR_ID,
  AI_AUTOBOOK_ACTOR_NAME,
  type AutoBookOutcome,
  type AutoBookStatus,
} from './autobook'
export { getAiDailyUsage, type AiDailyUsage } from './usage'
export { buildClinicAiContext } from './schedule-context'
export {
  createProposal,
  createOrSupersedeProposal,
  getProposal,
  getActiveProposalForConversation,
  getActiveProposalForContact,
  expireProposalIfNeeded,
  markProposalSent,
  markProposalSendPending,
  markProposalSendUncertain,
  markProposalConfirmed,
  markProposalSlotRefused,
  markProposalForwarded,
  evaluateProposalAuthorization,
  restoreProposalAuthorization,
} from '../proposals'
