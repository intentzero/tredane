/**
 * Oferta do link da página web da cliente no chat (ADR-0018, Fase 5; DEC-196).
 *
 * A frase é determinística (DEC-104): a abertura do hub do chat passa a levar o botão «Abrir agenda»
 * em vez do CTA do Flow. Texto **Proposto** (o do Flow é Confirmado; este ainda não foi revisto).
 */
import type { SendOutboundInteractiveInput } from '../clinic/inbox/types'

export const CLIENT_WEB_CTA_TEXT = 'Abrir agenda'

/** Remate da abertura do hub: troca a pergunta aberta pela indicação do botão. */
const HUB_ASK = /\s*O que você precisa\?\s*$/

export const CLIENT_WEB_OFFER_SENTENCE =
  'Para agendar, remarcar ou cancelar, toque em «Abrir agenda». Para tirar dúvidas, escreva aqui.'

/** Corpo da oferta a partir do corpo do hub (expediente de hoje incluído). */
export function clientWebOfferBody(hubBody: string | null | undefined): string {
  const base = (hubBody ?? '').trim().replace(HUB_ASK, '').trim()
  return base ? `${base} ${CLIENT_WEB_OFFER_SENTENCE}` : `Olá! ${CLIENT_WEB_OFFER_SENTENCE}`
}

/** `https://app/c/<token>`; a base vem de `APP_BASE_URL`, sem barra final. */
export function clientWebUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/c/${token}`
}

export function clientWebOfferInteractive(url: string): SendOutboundInteractiveInput {
  return { ctaUrl: { displayText: CLIENT_WEB_CTA_TEXT, url } }
}

/** A página só vai por https; em desenvolvimento (http://localhost) não há envio real. */
export function isHttpsBase(baseUrl: string | undefined): baseUrl is string {
  return typeof baseUrl === 'string' && /^https:\/\//i.test(baseUrl.trim())
}

/** Finalidade do link (ADR-0018): abre a página já no ecrã de remarcar ou de cancelar. */
export type ClientWebOfferPurpose = 'remarcar' | 'cancelar'

export const CLIENT_WEB_RESCHEDULE_BODY =
  'Para remarcar, toque em «Abrir agenda» e escolha a nova data e hora. Se tiver dúvidas, escreva aqui.'

export const CLIENT_WEB_CANCEL_BODY =
  'Para cancelar, toque em «Abrir agenda» e confirme a marcação. Se tiver dúvidas, escreva aqui.'

export const CLIENT_WEB_BOOK_BODY =
  'Para agendar, toque em «Abrir agenda» e escolha o dia e a hora. Se tiver dúvidas, escreva aqui.'

export const CLIENT_WEB_NO_UPCOMING_BODY =
  'Não encontrei marcações futuras no seu nome. Para agendar, toque em «Abrir agenda». Se tiver dúvidas, escreva aqui.'

/** Corpo fixo da oferta de remarcar ou cancelar (DEC-104). Texto **Proposto**. */
export function clientWebPurposeBody(purpose: ClientWebOfferPurpose): string {
  return purpose === 'remarcar' ? CLIENT_WEB_RESCHEDULE_BODY : CLIENT_WEB_CANCEL_BODY
}

/**
 * Corpo fixo do encaminhamento (DEC-202). Com um serviço reconhecido, nomeia-o: a página abre
 * nele. Texto **Proposto**.
 */
export function clientWebRouteBody(input: {
  purpose: 'agendar' | 'remarcar' | 'cancelar'
  serviceName?: string | null
  noUpcoming?: boolean
}): string {
  if (input.purpose === 'remarcar') return CLIENT_WEB_RESCHEDULE_BODY
  if (input.purpose === 'cancelar') return CLIENT_WEB_CANCEL_BODY
  if (input.noUpcoming) return CLIENT_WEB_NO_UPCOMING_BODY
  const name = input.serviceName?.trim()
  return name
    ? `Para agendar ${name}, toque em «Abrir agenda» e escolha o dia e a hora. Se tiver dúvidas, escreva aqui.`
    : CLIENT_WEB_BOOK_BODY
}

export type PrepareClientWebOfferInput = {
  tenantId: string
  conversationId: string
  purpose: 'home' | 'agendar' | 'remarcar' | 'cancelar'
  /** A marcação alvo quando a cliente só tem uma futura; senão a página abre as marcações. */
  appointmentId?: string | null
  /** Serviço reconhecido no texto (DEC-202(4)): a página abre nele. */
  serviceId?: string | null
}

/**
 * Gancho do autodraft e do painel: emite o link pessoal e devolve o botão «Abrir agenda».
 * `null` = não há link possível (sem número ativo, base sem https); quem chama passa à equipe.
 */
export type PrepareClientWebOffer = (
  input: PrepareClientWebOfferInput,
) => Promise<SendOutboundInteractiveInput | null>
