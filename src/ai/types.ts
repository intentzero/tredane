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
  /** S6 (#177): mensagem com sinais de manipulação da IA (heurístico). */
  | 'injection_suspected'
  /** S6 (#177): saída do modelo fora do schema fechado — descartada. */
  | 'output_rejected'

export type AiCatalogService = {
  name: string
  durationMinutes: number
  /** null = sem preço cadastrado — IA não inventa valor. */
  priceCents: number | null
  /** Texto «Explicação para clientes»; null = não descrever procedimento. */
  clientExplanation: string | null
  /** DEC-075 — audiência do serviço (feminino | masculino | qualquer); descreve o serviço. */
  audiencia: 'feminino' | 'masculino' | 'qualquer'
  /** DEC-079 — singular do tipo. Ausente: a interface diz «Variante». */
  variantKind?: string | null
  /** DEC-079 — plural do tipo. Ausente: cai no singular, senão «Variantes». */
  variantKindPlural?: string | null
  /**
   * DEC-080 — combos que valem hoje (ativos, variantes em uso e com preço, mais baratos que a
   * soma). Aplicam-se sozinhos quando a cliente escolhe todas as variantes. O valor final é o do sistema.
   */
  combos?: { name: string; zoneNames: string[]; priceCents: number }[]
  /** DEC-078 / DEC-079 — variantes ativas. Ausente ou vazio: a linha do serviço vale. */
  zones?: {
    name: string
    durationMinutes: number
    priceCents: number | null
    audience?: 'feminino' | 'masculino' | 'ambos' | null
  }[]
  /** DEC-008 — minutos de intervalo depois do atendimento. */
  bufferMinutes?: number
  /** Quem faz o serviço (DEC-082). */
  professionalNames?: string[]
  /** Salas da lista do serviço. */
  roomNames?: string[]
}

/** DEC-079 — `ambos` combina. Masculino e feminino juntos não têm preço nem proposta. */
export function variantAudiencesConflict(
  zones: readonly { audience?: 'feminino' | 'masculino' | 'ambos' | null }[],
): boolean {
  let feminino = false
  let masculino = false
  for (const zone of zones) {
    if (zone.audience === 'feminino') feminino = true
    if (zone.audience === 'masculino') masculino = true
  }
  return feminino && masculino
}

/** Uma variante usa o singular; várias, o plural. Forma em falta cai na outra. */
export function variantKindWord(
  singular: string | null | undefined,
  plural: string | null | undefined,
  count: number,
): string {
  const one = singular?.trim() || ''
  const many = plural?.trim() || ''
  if (count === 1) return one || many || 'Variante'
  return many || one || 'Variantes'
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
  /** Link do Google Business definido pela clínica (nunca vindo da conversa). */
  googleBusinessUrl?: string | null
  timezone: string
  /** Data e hora actuais no fuso da clínica, por extenso. */
  nowLabel: string
  /** YYYY-MM-DD de hoje no fuso da clínica. */
  today: string
  openingHours: string[]
  freeSlots: AiFreeSlotDay[]
  /**
   * Frase fixa do WhatsApp quando a cliente pediu uma hora que o tempo recusou (DEC-077).
   * Não traz payload, percentagem nem a hora recusada.
   */
  tempoNote?: string | null
  upcomingAppointments: AiUpcomingAppointment[]
  reschedulePolicy: string | null
  cancellationPolicy: string | null
  /** DEC-089 — nome opcional do atendente virtual (persona). */
  virtualAttendantName?: string | null
  /** DEC-089 — género para concordância; ausente = copy neutra. */
  virtualAttendantGender?: 'masculino' | 'feminino' | null
}

export type AiContextPayload = {
  contactFirstName: string | null
  stage: string | null
  services: AiCatalogService[]
  messages: AiContextMessage[]
  /**
   * Continuidade do tom (Paulo 29/10/2026): a clínica já enviou ≥1 outbound
   * nesta conversa → o rascunho não recomeça com cumprimento.
   * Derivado só das mensagens do contexto (DEC-011); sem PII extra.
   */
  hasClinicOutbound: boolean
  /** Contagem de outbound da clínica no histórico enviado ao modelo. */
  clinicOutboundCount: number
  /** Ausente em chamadas antigas/testes; presente no rascunho de resposta. */
  clinic?: AiClinicContext
  /**
   * O que a conversa já fixou para o agendamento (serviço, dia, período, linha).
   * Não é dado do contacto. Ausente quando ainda não há sessão.
   */
  schedule?: {
    serviceName: string
    dayLabel: string | null
    period: 'manha' | 'tarde' | 'noite' | null
    audienceLine: 'feminino' | 'masculino' | null
  }
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
