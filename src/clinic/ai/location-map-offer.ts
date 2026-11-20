/**
 * Oferta de localização no WhatsApp (opção B, Paulo 20/11/2026).
 *
 * Corpo sem URL + reply «Abrir mapa» · «Abrir agenda» · «Falar com a equipe».
 * Toque em Abrir mapa → bolha com `cta_url` do link da localização Google cadastrado.
 * A Meta não mistura `cta_url` com reply buttons e só permite um `cta_url` por mensagem:
 * o mapa abre no segundo passo; «Abrir agenda» fica reply (DEC-216) e abre a página depois.
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

/** True quando o texto ainda cola o link cadastrado (caminho LLM / legado). */
export function bodyContainsClinicMapsUrl(body: string, mapsUrl: string): boolean {
  const link = mapsUrl.trim()
  if (!link) return false
  return body.includes(link)
}

/**
 * Se o redator colou o URL da clínica, troca pelo corpo opção B (sem URL).
 * Devolve `useMapButtons` para anexar Abrir mapa · Agenda · Equipe.
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
