/**
 * Página web da cliente no harness L1 (DEC-202).
 *
 * Substitui o `prepareClientWebOffer` do Clinic DO: emite um link (token só em memória) e
 * devolve o botão «Abrir agenda», com o mesmo construtor de botão que a produção
 * (`src/clientweb/offer.ts`). Guarda o propósito, a marcação e o serviço pedidos, para os
 * casos verificarem para onde o link aponta.
 */
import {
  clientWebOfferInteractive,
  clientWebUrl,
  type PrepareClientWebOffer,
} from '../../../../clientweb/offer'
import { newClientWebLinkToken } from '../../../../clientweb/links'

export const CLIENT_WEB_L1_BASE = 'https://app.l1.test'

export type ClientWebIssued = {
  purpose: string
  appointmentId: string | null
  serviceId: string | null
}

export type ClientWebHarness = {
  prepareOffer: PrepareClientWebOffer
  /** Links emitidos, pela ordem. */
  issued: () => ClientWebIssued[]
  offers: () => number
  /** URLs emitidos, pela ordem. */
  urls: () => string[]
}

export function createClientWebHarness(): ClientWebHarness {
  const urls: string[] = []
  const issued: ClientWebIssued[] = []
  const prepareOffer: PrepareClientWebOffer = async (input) => {
    const url = clientWebUrl(CLIENT_WEB_L1_BASE, newClientWebLinkToken())
    urls.push(url)
    issued.push({
      purpose: input.purpose,
      appointmentId: input.appointmentId ?? null,
      serviceId: input.serviceId ?? null,
    })
    return clientWebOfferInteractive(url)
  }
  return { prepareOffer, issued: () => [...issued], offers: () => urls.length, urls: () => [...urls] }
}
