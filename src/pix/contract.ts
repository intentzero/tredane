import type {
  CreateChargeInput,
  PixCharge,
  PixRefund,
  PixResult,
  RawWebhookEnvelope,
  RequestRefundInput,
  ValidatedWebhookEvent,
} from './types'

/**
 * Adaptador de provedor Pix.
 *
 * - Mantém valor, conta da clínica e tenant em todas as operações.
 * - Não envia mensagens WhatsApp nem conhece conversas — só cobrança/estorno.
 * - Implementações reais usam HTTP `fetch` (Workers); o simulado é in-process.
 * - Provedor de produto Confirmado: Woovi / OpenPix (DEC-049, ADR-0014).
 *   Adaptador real: `WooviPixAdapter` (#37). Simulado permanece para testes unitários.
 */
export interface PixProviderAdapter {
  readonly providerId: string

  createCharge(input: CreateChargeInput): Promise<PixResult<PixCharge>>

  getCharge(providerChargeId: string): Promise<PixResult<PixCharge>>

  cancelCharge(providerChargeId: string): Promise<PixResult<PixCharge>>

  /**
   * Valida assinatura/origem, normaliza o evento e rejeita tenant/conta/valor
   * inconsistentes. Não aplica regras de agenda (pago sem horário fica na camada de domínio).
   */
  validateWebhookEvent(
    envelope: RawWebhookEnvelope,
  ): Promise<PixResult<ValidatedWebhookEvent>>

  requestRefund(input: RequestRefundInput): Promise<PixResult<PixRefund>>

  getRefund(providerRefundId: string): Promise<PixResult<PixRefund>>
}
