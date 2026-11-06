/**
 * Contrato estável do Flow JSON (ADR-0016 §3 / §7 + hub TR-306).
 * Versões: Flow JSON 7.3, data_api_version 4.0, flow_message_version 3.
 * Os data-source são dinâmicos (`${data.…}`); horas nunca vão no JSON publicado.
 *
 * Publicação na Meta é gate externo (#514); este objecto documenta o contrato.
 * O JSON a publicar está em `booking-flow.json` (e na cópia da store
 * `docs/flow-json-tredane-booking-staging.json`). Não publica sozinho.
 * SERVICO usa `RadioButtonsGroup` (mesmo padrão do HUB) — evita o microcopy
 * Meta «Enter {label}» do Dropdown vazio. `service_init` pré-seleciona quando
 * há id conhecido; string vazia = rádios sem selecção + `required: true`.
 * `init-value` no componente é ilegal dentro de Form (Flow JSON 7.3).
 * Catálogo > 20 agendáveis → `too_many_services` (teto do RadioButtonsGroup).
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
 * Arestas do `routing_model` publicado (`booking-flow.json`). Um teste garante que coincidem.
 * A Meta recusa («Ocorreu um erro») qualquer salto fora daqui; repetir o mesmo ecrã com
 * `error_message` é aceite.
 */
export const BOOKING_FLOW_EDGES: Readonly<Record<(typeof FLOW_SCREEN_IDS)[number], readonly string[]>> = {
  HUB: ['SERVICO'],
  SERVICO: ['GENERO', 'VARIANTES', 'HORARIO'],
  GENERO: ['VARIANTES', 'HORARIO'],
  VARIANTES: ['HORARIO'],
  HORARIO: [],
}

export function isFlowTransitionAllowed(from: string, to: string): boolean {
  if (from === to) return true
  const edges = BOOKING_FLOW_EDGES[from as keyof typeof BOOKING_FLOW_EDGES]
  return edges ? edges.includes(to) : false
}

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
