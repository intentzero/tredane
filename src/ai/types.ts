/**
 * Contratos tipados do adaptador de IA (#41 / ADR-0004 / DEC-011).
 * Sem ferramentas, sem ações autónomas — só texto sugerido.
 */

export type AiMode = 'synthetic' | 'gateway'

export type AiSuggestionKind = 'reply' | 'summary'

/** Códigos de aviso à atendente (DEC-046). Detecção: Proposto / Em aberto. */
export type AiWarningCode =
  | 'no_price'
  | 'offensive'
  | 'off_topic'
  | 'clinical'
  | 'no_explanation'
  | 'provider_unavailable'

export type AiCatalogService = {
  name: string
  durationMinutes: number
  /** null = sem preço cadastrado — IA não inventa valor. */
  priceCents: number | null
  /** Texto «Explicação para clientes»; null = não descrever procedimento. */
  clientExplanation: string | null
}

export type AiContextMessage = {
  direction: 'inbound' | 'outbound' | 'system'
  /** Corpo já minimizado (telefones/anexos removidos). */
  body: string
}

/**
 * Payload autorizado enviado ao provedor (AC-37 / REQ-072).
 * Testes inspecionam este objeto — nunca telefone, anexos, outras conversas/tenants.
 */
export type AiContextPayload = {
  contactFirstName: string | null
  stage: string | null
  services: AiCatalogService[]
  messages: AiContextMessage[]
}

export type AiGenerateInput = {
  kind: AiSuggestionKind
  context: AiContextPayload
  /** Avisos já detectados localmente (DEC-046). */
  warnings: AiWarningCode[]
  /** Serviços sem preço tocados pela pergunta (AC-41). */
  servicesWithoutPrice: string[]
  /** Serviços sem explicação tocados (AC-43). */
  servicesWithoutExplanation: string[]
  /** Serviço com explicação usada como fonte. */
  explanationSources: Array<{ serviceName: string }>
  maxOutputTokens: number
  timeoutMs: number
}

export type AiGenerateSuccess = {
  ok: true
  text: string
  provider: string
  model: string
  latencyMs: number
  /** Métricas sem conteúdo pessoal. */
  inputTokens: number | null
  outputTokens: number | null
}

export type AiGenerateFailure = {
  ok: false
  code:
    | 'timeout'
    | 'rate_limit'
    | 'provider_error'
    | 'invalid_response'
    | 'budget_exceeded'
  message: string
  retryable: boolean
  latencyMs: number
  provider: string
  model: string
}

export type AiGenerateResult = AiGenerateSuccess | AiGenerateFailure

/** Pedido HTTP ao AI Gateway — inspecionável nos testes (sem PII proibida). */
export type AiGatewayRequestInspection = {
  urlPath: string
  model: string
  systemPrompt: string
  userContent: string
  maxTokens: number
  /** Headers não secretos (ex.: cf-aig-collect-log-payload). */
  headers: Record<string, string>
  context: AiContextPayload
}
