/**
 * Lista interativa de serviços (P8 regressão 15/11/2026).
 * ≤3 serviços: botões; 4–10: lista WhatsApp; >10: 10 primeiras linhas + texto.
 */
import type { ServiceRow } from '../config/types'
import {
  buildServiceChoiceButtons,
  buildServiceChoiceList,
  type ChoiceInteractive,
} from './choice-offer'
import type { DeferredBookingFrame } from './deferred-booking-frame'
import type { BookingFramePending } from './schedule-session'

export const SERVICE_PICK_BODY = 'Qual serviço você quer?'
export const SERVICE_PICK_BODY_CATALOG = 'Qual você quer?'

/** A partir deste número de opções usa lista (4+) em vez de texto corrido. */
export const SERVICE_PICK_LIST_MIN = 4

export type ServicePickOffer = {
  body: string
  interactive: ChoiceInteractive | null
  pending: BookingFramePending | null
}

function uniqueActiveServices(services: readonly ServiceRow[]): Array<{ id: string; name: string }> {
  const seen = new Set<string>()
  const out: Array<{ id: string; name: string }> = []
  for (const s of services) {
    if (s.active === false) continue
    const name = s.name.trim()
    if (!name || seen.has(s.id)) continue
    seen.add(s.id)
    out.push({ id: s.id, name })
  }
  return out
}

export function shouldUseServicePickInteractive(serviceCount: number): boolean {
  return serviceCount >= SERVICE_PICK_LIST_MIN
}

/**
 * Oferta tocável de escolha de serviço, ou null para copy em prosa (1 serviço / fallback).
 */
export function buildServicePickOffer(input: {
  services: readonly ServiceRow[]
  catalogVersion: string
  body?: string
}): ServicePickOffer | null {
  const options = uniqueActiveServices(input.services)
  if (options.length < 2) return null
  const body = (input.body ?? SERVICE_PICK_BODY).trim()
  if (options.length <= 3) {
    const built = buildServiceChoiceButtons(input.catalogVersion, options)
    return {
      body,
      interactive: built.interactive,
      pending: built.pending,
    }
  }
  const capped = options.slice(0, 10)
  const built = buildServiceChoiceList(input.catalogVersion, capped)
  const suffix =
    options.length > 10
      ? '\n\nSe não achar na lista, escreva o nome do serviço.'
      : ''
  return {
    body: `${body}${suffix}`,
    interactive: built.interactive,
    pending: built.pending,
  }
}

export function bodyForCatalogServiceList(names: readonly string[]): string {
  if (names.length >= SERVICE_PICK_LIST_MIN) {
    return `Temos ${names.length} opções.\n${SERVICE_PICK_BODY_CATALOG}`
  }
  if (names.length >= 2) {
    return SERVICE_PICK_BODY_CATALOG
  }
  return `Temos:\n${names.join('\n')}\n${SERVICE_PICK_BODY_CATALOG}`
}

/** Grava pending de serviço no quadro antes do outbound (sem serviceId ainda). */
export function attachServicePickToDeferred(
  deferred: DeferredBookingFrame,
  catalogVersion: string,
  pick: ServicePickOffer,
): ChoiceInteractive | null {
  if (!pick.interactive || !pick.pending) return null
  deferred.save({
    serviceId: null,
    catalogVersion,
    pending: pick.pending,
    phase: 'coletando',
  })
  return pick.interactive
}