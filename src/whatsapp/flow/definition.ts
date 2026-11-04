/**
 * Contrato estável do Flow JSON (ADR-0016 §3 / §7 + hub TR-306).
 * Versões: Flow JSON 7.3, data_api_version 4.0, flow_message_version 3.
 * Os data-source são dinâmicos (`${data.…}`); horas nunca vão no JSON publicado.
 *
 * Publicação na Meta é gate externo (#514); este objecto documenta o contrato.
 * O JSON a publicar está em `booking-flow.json` (e na cópia da store
 * `docs/flow-json-tredane-booking-staging.json`). Não publica sozinho.
 * `service_init` e `description` nas variantes exigem republicar antes do
 * Worker que os envia — senão a Meta responde `payload-schema-error`.
 * Pré-seleção do serviço: `Form.init-values.service_id` = `${data.service_init}`.
 * `init-value` no Dropdown é ilegal dentro de Form (Flow JSON 7.3).
 *
 * TR-306: entry passa a `HUB` (Agendar / Remarcar / Cancelar / Meus).
 * Republicar o Flow JSON **antes** do Worker que devolve HUB — senão
 * `invalid-screen-transition` / `payload-schema-error`.
 */
export const FLOW_JSON_VERSION = '7.3'
export const FLOW_DATA_API_VERSION = '4.0'
export const FLOW_MESSAGE_VERSION = '3'
export const FLOW_CATEGORY = 'APPOINTMENT_BOOKING'

/** Ids de ecrã estáveis entre versões — partir um id = Flow novo. */
export const FLOW_SCREEN_IDS = [
  'HUB',
  'SERVICO',
  'GENERO',
  'VARIANTES',
  'HORARIO',
] as const

/**
 * Esqueleto do routing model (data_exchange em cada Continuar / Ver proposta).
 * Os componentes concretos (Radio/Dropdown/Checkbox) seguem ADR-0016 §3.
 * Entry Meta (sem inbound): só HUB — INIT tem de o devolver (`entryFlowScreen`).
 * Remarcar/Cancelar/Meus fecham via SUCCESS no endpoint (sem ecrã nomeado).
 */
export const BOOKING_FLOW_ROUTING = {
  HUB: { next: 'data_exchange', fields: ['hub_action'] },
  SERVICO: { next: 'data_exchange', fields: ['service_id'] },
  GENERO: { next: 'data_exchange', fields: ['gender_id'] },
  VARIANTES: { next: 'data_exchange', fields: ['variant_ids'] },
  HORARIO: { next: 'data_exchange', fields: ['slot_id'] },
} as const
