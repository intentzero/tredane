/**
 * Oferta de localização no WhatsApp (opção B, Paulo 20/11/2026).
 *
 * Corpo sem URL + reply «Abrir mapa» · «Abrir agenda» · «Falar com a equipe».
 * Toque em Abrir mapa → bolha com `cta_url` do link da localização Google cadastrado.
 * A Meta não mistura `cta_url` com reply buttons e só permite um `cta_url` por mensagem:
 * o mapa abre no segundo passo; «Abrir agenda» fica reply (DEC-216) e abre a página depois.
 */
import type { SendOutboundInteractiveInput } from '../inbox/types'
import type { ClinicDb } from '../store'
import type { Clock } from '../types'
import { openAgendaReplyButton } from '../../clientweb/offer'
import { HUMAN_HANDOFF_BUTTON_ID, HUMAN_HANDOFF_BUTTON_TITLE } from './human-handoff'

/** Texto do reply e do `cta_url` (≤ 20 caracteres da Meta). */
export const OPEN_MAP_CTA_TEXT = 'Abrir mapa'

export const OPEN_MAP_REPLY_BUTTON_ID = 'cw:abrir-mapa'

/** Corpos Confirmados da 1.ª bolha (sem URL). Alinhados a `DIALOGUE_ACTS.informar_local_link`. */
export const LOCATION_MAP_OFFER_BODIES = [
  'Estamos aqui — abra o mapa para ver o caminho.',
  'Para chegar, abra o mapa e veja o caminho.',
] as const

/** Corpo da bolha com `cta_url` após o toque (espelha o padrão DEC-216 do Abrir agenda). */
export const LOCATION_MAP_CTA_BODY = 'Para ver o caminho, toque em «Abrir mapa».'

export function openMapReplyButton(): { id: string; title: string } {
  return { id: OPEN_MAP_REPLY_BUTTON_ID, title: OPEN_MAP_CTA_TEXT }
}

export function parseOpenMapReplyButton(raw: string): boolean {
  return raw.trim() === OPEN_MAP_REPLY_BUTTON_ID
}

/** Resposta determinística de localização (opção B) — sem URL no texto. */
export function isLocationMapOfferReply(body: string): boolean {
  const t = body.trim().toLocaleLowerCase('pt-BR')
  return LOCATION_MAP_OFFER_BODIES.some((b) => b.toLocaleLowerCase('pt-BR') === t)
}

/**
 * Três reply buttons (máx. Meta): Abrir mapa · Abrir agenda · Falar com a equipe.
 * `serviceId` opcional pré-escolhe o serviço no link da agenda (DEC-202(4)).
 */
export function locationMapOfferButtons(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
  opts?: { serviceId?: string | null },
): Array<{ id: string; title: string }> {
  void db
  void tenantId
  void clock
  return [
    openMapReplyButton(),
    openAgendaReplyButton(opts?.serviceId),
    { id: HUMAN_HANDOFF_BUTTON_ID, title: HUMAN_HANDOFF_BUTTON_TITLE },
  ]
}

export function locationMapCtaInteractive(url: string): SendOutboundInteractiveInput {
  return { ctaUrl: { displayText: OPEN_MAP_CTA_TEXT, url } }
}
