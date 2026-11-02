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
  autoBookCapability,
  type AiAssistRpcDeps,
} from './deps'
export {
  DEFAULT_ABUSE_LIMITS,
  DEFAULT_ABUSE_LIMIT_NUMBERS,
  ABUSE_LIMIT_HARD_CAPS,
  abuseLimitsFromEnv,
  resolveAbuseLimits,
  checkAutomationQuota,
  type AbuseLimits,
  type AbuseLimitNumbers,
  type ClinicAbuseLimitsRow,
} from './abuse-limits'
export type * from './types'
export {
  enqueueAutoDraft,
  enqueueLatestUnansweredInbound,
  runDueAutoDrafts,
  nextAutoDraftDueAt,
  getConversationDraftState,
  getAutoDraftJob,
  cancelAutoDraft,
  AUTODRAFT_ACTOR_ID,
  AUTODRAFT_STALE_MS,
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
  loadTurnContext,
  getOrCompileCatalog,
  clearCompiledCatalogCache,
  readCatalogVersion,
  type TurnContext,
  type CompiledCatalog,
  type CatalogReadStats,
} from './turn-context'
export {
  DIALOGUE_ACTS,
  dialogueActIndex,
  renderDialogueAct,
  renderEveryVariant,
  type DialogueActId,
  type DialogueVars,
} from './dialogue-acts'
export {
  validateClientOutbound,
  countQuestions,
  countParagraphs,
  type OutboundValidateOpts,
  type OutboundValidateResult,
  type OutboundRejection,
} from './outbound-validate'
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
