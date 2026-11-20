/**
 * Oferta de localização no WhatsApp (DEC-211; revisão um toque, Paulo 20/11/2026).
 *
 * Com URL https do Maps: corpo sem URL + só `cta_url` «Abrir mapa» (um toque abre o mapa).
 * A Meta não mistura `cta_url` com reply — Abrir agenda / Equipe não vão nesta bolha
 * (mesmo padrão do fecho #998; Paulo prioriza um toque para o mapa).
 * Sem URL https: replies Abrir mapa · Abrir agenda · Equipe (legado / lab; toque Abrir mapa → cta).
 */
import type { Clock } from '../../db/clock'
import type { SendOutboundInteractiveInput } from '../inbox/types'
import type { ClinicDb } from '../store'
import { openAgendaReplyButton } from '../../clientweb/offer'
import { HUMAN_HANDOFF_BUTTON_ID, HUMAN_HANDOFF_BUTTON_TITLE } from './human-handoff'
import { sayAct } from './dialogue-acts'

/** Texto do reply e do `cta_url` (≤ 20 caracteres da Meta). */
export const OPEN_MAP_CTA_TEXT = 'Abrir mapa'

export const OPEN_MAP_REPLY_BUTTON_ID = 'cw:abrir-mapa'

/**
 * Pedido de localização / mapa (DEC-211).
 * Inclui paráfrases («Onde atendem?», «onde é?», «onde vocês ficam?»).
 * Não casa FAQ de expediente («vocês atendem domingo?» / «até que horas atendem?»).
 * `\b` do JS falha após «é»/acentos — fronteira ASCII à esquerda + lookahead à direita.
 */
export const LOCATION_ASK_RE =
  /(?:^|[^a-z0-9à-ü])(?:onde\s+(?:fica|ficam|[eé]|eh|atendem)|onde\s+voc[eê]s\s+(?:ficam|atendem)|endere[cç]o|localiza[cç][aã]o|como\s+chegar|maps?|google)(?![a-z0-9])/i

export function isLocationAsk(text: string): boolean {
  return LOCATION_ASK_RE.test(text.trim())
}

/** Corpos Confirmados da 1.ª bolha (sem URL). Alinhados a `DIALOGUE_ACTS.informar_local_link`. */
export const LOCATION_MAP_OFFER_BODIES = [
  'Estamos aqui — abra o mapa para ver o caminho.',
  'Para chegar, abra o mapa e veja o caminho.',
] as const

/** Corpo da bolha com `cta_url` após toque legado no reply (espelha DEC-216 do Abrir agenda). */
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

/** True quando o texto ainda cola o link cadastrado (caminho LLM / legado). */
export function bodyContainsClinicMapsUrl(body: string, mapsUrl: string): boolean {
  const link = mapsUrl.trim()
  if (!link) return false
  return body.includes(link)
}

/**
 * Se o redator colou o URL da clínica, troca pelo corpo opção B (sem URL).
 * Devolve `useMapButtons` para anexar a oferta de mapa (`cta_url` ou replies).
 */
export function rewriteRawMapsUrlOutbound(
  body: string,
  conversationId: string,
  mapsUrl: string,
): { body: string; useMapButtons: boolean } {
  if (!bodyContainsClinicMapsUrl(body, mapsUrl)) {
    return { body, useMapButtons: false }
  }
  const link = mapsUrl.trim()
  const next = sayAct(
    'informar_local_link',
    conversationId,
    { link },
    LOCATION_MAP_OFFER_BODIES[0],
  )
  return { body: next, useMapButtons: true }
}

/**
 * Três reply buttons (máx. Meta): Abrir mapa · Abrir agenda · Falar com a equipe.
 * Só usado sem URL https (legado). Com URL, preferir `locationMapOfferInteractive`.
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

/**
 * Interactivo da 1.ª bolha de localização.
 * URL https → só `cta_url` «Abrir mapa» (um toque).
 * Sem URL → replies Abrir mapa · Agenda · Equipe (toque Abrir mapa → cta).
 */
export function locationMapOfferInteractive(
  mapsUrl: string,
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
  opts?: { serviceId?: string | null },
): SendOutboundInteractiveInput {
  const url = mapsUrl.trim()
  if (/^https:\/\//i.test(url)) {
    return locationMapCtaInteractive(url)
  }
  return { buttons: locationMapOfferButtons(db, tenantId, clock, opts) }
}
