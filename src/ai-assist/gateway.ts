import type { ClinicCaller } from '../clinic'
import type {
  AiAssistRpcDeps,
  AiSuggestionRow,
  DecideSuggestionInput,
  SuggestReplyInput,
  SummarizeInput,
} from '../clinic/ai'
import type { SuggestResult, DecideResult } from '../clinic/ai'

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
}
