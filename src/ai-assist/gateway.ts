import type { ClinicCaller } from '../clinic'
import type {
  AiAssistRpcDeps,
  AiSuggestionRow,
  DecideSuggestionInput,
  SuggestReplyInput,
  SummarizeInput,
} from '../clinic/ai'
import type { SuggestResult, DecideResult, AiDailyUsage } from '../clinic/ai'

export type AiAssistGateway = {
  suggestReply: (
    caller: ClinicCaller,
    input: SuggestReplyInput,
    deps: AiAssistRpcDeps,
  ) => Promise<SuggestResult>
  summarize: (
    caller: ClinicCaller,
    input: SummarizeInput,
    deps: AiAssistRpcDeps,
  ) => Promise<SuggestResult>
  decide: (
    caller: ClinicCaller,
    input: DecideSuggestionInput,
  ) => Promise<DecideResult>
  list: (
    caller: ClinicCaller,
    conversationId: string,
    opts?: { kind?: 'reply' | 'summary'; limit?: number },
  ) => Promise<AiSuggestionRow[]>
  get: (caller: ClinicCaller, suggestionId: string) => Promise<AiSuggestionRow>
  draftState?: (caller: ClinicCaller, conversationId: string) => Promise<AiDraftStateRaw>
  status?: (caller: ClinicCaller) => Promise<AiStatusRaw>
}

export type AiDraftStateRaw = {
  job: { conversationId: string; messageId: string; dueAt: number; state: 'queued' | 'generating' } | null
  suggestion: AiSuggestionRow | null
  usage: AiDailyUsage
  syntheticFallback: boolean
  mode: string
}

export type AiStatusRaw = { mode: string; syntheticFallback: boolean; usage: AiDailyUsage }
