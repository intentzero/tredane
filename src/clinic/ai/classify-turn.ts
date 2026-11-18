/**
 * Classificação do turno (DEC-202, P3 — **Proposto**): uma só função com a ordem de decisão do
 * atendimento, depois das guardas de segurança (mídia, política, parar, transparência sobre IA).
 *
 * A ordem é o contrato e está em {@link TURN_ORDER}; o autodraft só executa a ação da classe
 * devolvida. Mudar a ordem muda o comportamento, por isso há um teste que a fixa. Sem efeitos
 * secundários: as sondas que leem a base chegam como funções preguiçosas e só correm quando a
 * etapa anterior não decidiu.
 *
 * Classes:
 * - `link_early`: cumprimento, remarcar ou cancelar próprios (antes do handoff léxico, P24);
 * - `handoff`: pedido de pessoa, terceiro, assunto sensível;
 * - `farewell`: «Terminar», desistência educada, ou agradecimento após marcar;
 * - `my_appointments`: «meus agendamentos»;
 * - `catalog_list`: «quais serviços?» (informação, sem estado);
 * - `link_route`: pedido de marcar ou de vaga, com ou sem pergunta de informação (turno misto);
 * - `info`: o resto — catálogo, horário, preço, FAQ ou pergunta aberta (redator com validador).
 */
import { isGreetingOnly, isCancelRequest, isRescheduleRequest, routeToClientWeb } from '../../clientweb/route-intent'
import type { ClientWebRoute, RouteServiceHint } from '../../clientweb/route-intent'
import { isMyAppointmentsQuery } from '../../clientweb/hub'
import { catalogListReply } from './catalog-list'
import type { ServiceRow } from '../config/types'

export type EarlyRoute = {
  purpose: 'home' | 'agendar' | 'remarcar' | 'cancelar'
  serviceId: null
  noUpcoming: boolean
}

export type TurnClass<R = string> =
  | { kind: 'link_early'; route: EarlyRoute }
  | { kind: 'handoff'; reason: R }
  | { kind: 'farewell' }
  | { kind: 'my_appointments' }
  | { kind: 'catalog_list'; text: string }
  | { kind: 'link_route'; route: ClientWebRoute }
  | { kind: 'info' }

/** A ordem em que as classes são tentadas. Fixada por teste. */
export const TURN_ORDER = [
  'link_early',
  'handoff',
  'farewell',
  'my_appointments',
  'catalog_list',
  'link_route',
  'info',
] as const satisfies ReadonlyArray<TurnClass['kind']>

export type ClassifyTurnInput<R = string> = {
  text: string
  services: readonly ServiceRow[]
  hasUpcoming: boolean
  /** Motivo de pausa por pedido de pessoa ou assunto sensível; lê a base, por isso é preguiçosa. */
  handoffReason: () => R | null
  /** Despedida: desistência educada, ou agradecimento depois de marcar. */
  isFarewell: () => boolean
}

export function classifyTurn<R = string>(input: ClassifyTurnInput<R>): TurnClass<R> {
  const text = input.text
  const early = earlyRoute(text, input.hasUpcoming)
  if (early) return { kind: 'link_early', route: early }
  const reason = input.handoffReason()
  if (reason) return { kind: 'handoff', reason }
  if (input.isFarewell()) return { kind: 'farewell' }
  if (isMyAppointmentsQuery(text)) return { kind: 'my_appointments' }
  const list = catalogListReply(text, input.services)
  if (list) return { kind: 'catalog_list', text: list }
  const route = routeToClientWeb({
    text,
    services: input.services as readonly RouteServiceHint[],
    hasUpcoming: input.hasUpcoming,
  })
  if (route) return { kind: 'link_route', route }
  return { kind: 'info' }
}

function earlyRoute(text: string, hasUpcoming: boolean): EarlyRoute | null {
  if (isGreetingOnly(text)) return { purpose: 'home', serviceId: null, noUpcoming: false }
  if (isCancelRequest(text)) {
    return hasUpcoming
      ? { purpose: 'cancelar', serviceId: null, noUpcoming: false }
      : { purpose: 'agendar', serviceId: null, noUpcoming: true }
  }
  if (isRescheduleRequest(text)) {
    return hasUpcoming
      ? { purpose: 'remarcar', serviceId: null, noUpcoming: false }
      : { purpose: 'agendar', serviceId: null, noUpcoming: true }
  }
  return null
}
