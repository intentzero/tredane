/**
 * Estado administrativo de integração — sem conteúdo clínico (#24).
 * Até F3/WhatsApp e Pix reais, apenas stubs observáveis.
 */

export type IntegrationChannelStatus =
  | 'not_connected'
  | 'pending'
  | 'connected'
  | 'error'
  | 'not_configured'

export type TenantIntegrationStatus = {
  whatsapp: {
    status: IntegrationChannelStatus
    /** Sem número real / PHI. */
    note: string
  }
  pix: {
    status: IntegrationChannelStatus
    note: string
  }
}

/** Stub fail-closed: nunca inventa canal ligado sem verificação. */
export function stubIntegrationStatus(): TenantIntegrationStatus {
  return {
    whatsapp: {
      status: 'not_connected',
      note: 'Associação oficial Meta ainda não verificada (F3)',
    },
    pix: {
      status: 'not_configured',
      note: 'Adaptador Pix simulado; conta da clínica não ligada',
    },
  }
}
