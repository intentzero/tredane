import type { AiGenerateInput, AiGenerateResult, AiGatewayRequestInspection } from './types'

/**
 * Adaptador de provedor de IA (ADR-0004).
 * Não envia WhatsApp, não agenda, não muda etapa — só gera texto.
 */
export interface AiProviderAdapter {
  readonly providerId: string
  readonly mode: 'synthetic' | 'gateway'

  generate(input: AiGenerateInput): Promise<AiGenerateResult>

  /**
   * Último pedido construído (synthetic ou gateway) — para testes AC-37.
   * Não inclui chaves nem telefone.
   */
  lastInspection(): AiGatewayRequestInspection | null
}
