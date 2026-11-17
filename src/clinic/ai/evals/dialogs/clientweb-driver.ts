/**
 * Página web da cliente no harness L1 (família CW-, ADR-0018 Fase 5).
 *
 * Substitui o `prepareBookingFlowOffer` como o Clinic DO faz com a página ligada: emite um link
 * (token só em memória) e devolve o botão «Abrir agenda» com o corpo da abertura do hub. Usa o
 * mesmo construtor de corpo e de botão que a produção (`src/clientweb/offer.ts`).
 */
import {
  clientWebOfferBody,
  clientWebOfferInteractive,
  clientWebPurposeBody,
  clientWebUrl,
  type PrepareClientWebOffer,
} from '../../../../clientweb/offer'
import { newClientWebLinkToken } from '../../../../clientweb/links'
import type { PrepareBookingFlowOffer } from '../../../../whatsapp/flow/offer-live'

export const CLIENT_WEB_L1_BASE = 'https://app.l1.test'

export type ClientWebHarness = {
  prepare: PrepareBookingFlowOffer
  /** Remarcar e cancelar no chat: emite o link com a finalidade. */
  prepareOffer: PrepareClientWebOffer
  /** Finalidades pedidas ao emitir, pela ordem (`home` = abertura do hub). */
  purposes: () => Array<{ purpose: string; appointmentId: string | null }>
  offers: () => number
  /** URLs emitidos, pela ordem. */
  urls: () => string[]
}

export function createClientWebHarness(): ClientWebHarness {
  const urls: string[] = []
  const purposes: Array<{ purpose: string; appointmentId: string | null }> = []
  const prepare: PrepareBookingFlowOffer = async (input) => {
    const url = clientWebUrl(CLIENT_WEB_L1_BASE, newClientWebLinkToken())
    urls.push(url)
    purposes.push({ purpose: 'home', appointmentId: null })
    return {
      flowToken: 'client_web',
      body: clientWebOfferBody(input.body),
      interactive: clientWebOfferInteractive(url),
    }
  }
  const prepareOffer: PrepareClientWebOffer = async (input) => {
    const url = clientWebUrl(CLIENT_WEB_L1_BASE, newClientWebLinkToken())
    urls.push(url)
    purposes.push({ purpose: input.purpose, appointmentId: input.appointmentId })
    return { body: clientWebPurposeBody(input.purpose), interactive: clientWebOfferInteractive(url) }
  }
  return { prepare, prepareOffer, purposes: () => [...purposes], offers: () => urls.length, urls: () => [...urls] }
}
