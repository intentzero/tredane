/**
 * Contrato estável do Flow JSON (ADR-0016 §3 / §7).
 * Versões: Flow JSON 7.3, data_api_version 4.0, flow_message_version 3.
 * Os data-source são dinâmicos (`${data.…}`); horas nunca vão no JSON publicado.
 *
 * Publicação na Meta é gate externo (#514); este objecto documenta o contrato
 * e serve de base ao JSON a publicar — não publica sozinho.
 */
export const FLOW_JSON_VERSION = '7.3'
export const FLOW_DATA_API_VERSION = '4.0'
export const FLOW_MESSAGE_VERSION = '3'
export const FLOW_CATEGORY = 'APPOINTMENT_BOOKING'

/** Ids de ecrã estáveis entre versões — partir um id = Flow novo. */
export const FLOW_SCREEN_IDS = ['SERVICO', 'GENERO', 'VARIANTES', 'HORARIO'] as const

/**
 * Esqueleto do routing model (data_exchange em cada Continuar / Ver proposta).
 * Os componentes concretos (Radio/Dropdown/Checkbox) seguem ADR-0016 §3.
 */
export const BOOKING_FLOW_ROUTING = {
  SERVICO: { next: 'data_exchange', fields: ['service_id'] },
  GENERO: { next: 'data_exchange', fields: ['gender_id'] },
  VARIANTES: { next: 'data_exchange', fields: ['variant_ids'] },
  HORARIO: { next: 'data_exchange', fields: ['slot_id'] },
} as const
