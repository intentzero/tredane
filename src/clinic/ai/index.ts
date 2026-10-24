export {
  buildAiContextPayload,
  assertContextMinimized,
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
  type AiAssistRpcDeps,
} from './deps'
export type * from './types'
