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
export type AiFreeSlotDay = {
  serviceName: string
  /** YYYY-MM-DD no fuso da clínica. */
  date: string
  /** Ex.: «amanhã, quarta-feira 28/10». */
  dayLabel: string
  /** HH:MM no fuso da clínica. */
  times: string[]
}

export type AiUpcomingAppointment = {
  serviceName: string
  /** Ex.: «quarta 28/10 às 14:00» (fuso da clínica). */
  when: string
}

/** Dados da clínica e da agenda real (leitura pura; a IA nunca agenda). */
export type AiClinicContext = {
  name: string | null
  address: string | null
  timezone: string
  /** Data e hora actuais no fuso da clínica, por extenso. */
  nowLabel: string
  /** YYYY-MM-DD de hoje no fuso da clínica. */
  today: string
  openingHours: string[]
  freeSlots: AiFreeSlotDay[]
  upcomingAppointments: AiUpcomingAppointment[]
  reschedulePolicy: string | null
  cancellationPolicy: string | null
}

export type AiContextPayload = {
  contactFirstName: string | null
  stage: string | null
  services: AiCatalogService[]
  messages: AiContextMessage[]
  /** Ausente em chamadas antigas/testes; presente no rascunho de resposta. */
  clinic?: AiClinicContext
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
  /** Modelo explícito (rascunho automático = Haiku; «Gerar outra» = Sonnet). */
  model?: string
  /** 0.3–0.5 para respostas estáveis. */
  temperature?: number
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
  temperature?: number
  /** Headers não secretos (ex.: cf-aig-collect-log-payload). */
  headers: Record<string, string>
  context: AiContextPayload
}
