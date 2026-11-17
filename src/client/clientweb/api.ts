/**
 * Cliente HTTP da página web da cliente. Só chama `/api/c/*` (mesma origem, cookie de sessão).
 * Nunca envia nem recebe `tenant_id` ou `contact_id`; o token só vai no corpo da troca.
 */

export type ClientWebAppointment = {
  id: string
  serviceName: string
  startsAt: number
  endsAt: number
}

export type ClientWebState = {
  clinicName: string
  firstName: string | null
  timezone: string
  appointments: ClientWebAppointment[]
  sessionExpiresAt: number
}

export type CatalogZone = {
  id: string
  name: string
  audience: 'feminino' | 'masculino' | 'ambos'
  durationMinutes: number
  priceCents: number | null
}

export type CatalogService = {
  id: string
  name: string
  durationMinutes: number
  priceCents: number | null
  audience: 'feminino' | 'masculino' | 'qualquer'
  variantKind: string | null
  variantKindPlural: string | null
  variantSelection: 'uma' | 'varias'
  requiresSignal: boolean
  zones: CatalogZone[]
}

export type Catalog = {
  timezone: string
  horizonDays: number
  today: string
  services: CatalogService[]
}

export type Slot = { id: string; date: string; time: string }

export type Line = 'feminino' | 'masculino'

export type BookInput = { serviceId: string; variantIds: string[]; line: Line | null; slotId: string }

export type BookResult =
  | { status: 'booked'; appointment: { id: string; startsAt: number; endsAt: number; serviceName: string } }
  | { status: 'pix_signal' }
  | { status: 'slot_taken' }
  | { status: 'paused' }
  | { status: 'error'; error: string }

export type ExchangeResult = 'ok' | 'unavailable' | 'error'
export type StateResult =
  | { kind: 'ok'; state: ClientWebState }
  | { kind: 'unauthorized' }
  | { kind: 'error' }

/**
 * A troca é de uso único: em React StrictMode o efeito corre duas vezes em desenvolvimento,
 * e a segunda troca falharia. Uma troca por token, partilhada.
 */
const exchanges = new Map<string, Promise<ExchangeResult>>()

export function exchangeLink(token: string): Promise<ExchangeResult> {
  const existing = exchanges.get(token)
  if (existing) return existing
  const run = (async (): Promise<ExchangeResult> => {
    try {
      const res = await fetch('/api/c/exchange', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      if (res.ok) return 'ok'
      return res.status === 410 ? 'unavailable' : 'error'
    } catch {
      return 'error'
    }
  })()
  exchanges.set(token, run)
  return run
}

export async function fetchState(): Promise<StateResult> {
  try {
    const res = await fetch('/api/c/state', { credentials: 'same-origin' })
    if (res.status === 401) return { kind: 'unauthorized' }
    if (!res.ok) return { kind: 'error' }
    return { kind: 'ok', state: (await res.json()) as ClientWebState }
  } catch {
    return { kind: 'error' }
  }
}

/** Só para testes. */
export function resetExchangesForTest(): void {
  exchanges.clear()
}

async function json<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T
  } catch {
    return null
  }
}

/** `null` = sem sessão (mostrar o aviso de link); `'error'` = falha de rede ou servidor. */
export async function fetchCatalog(): Promise<Catalog | 'unauthorized' | 'error'> {
  try {
    const res = await fetch('/api/c/catalog', { credentials: 'same-origin' })
    if (res.status === 401) return 'unauthorized'
    if (!res.ok) return 'error'
    return (await json<Catalog>(res)) ?? 'error'
  } catch {
    return 'error'
  }
}

export type SlotsResult = { kind: 'ok'; slots: Slot[] } | { kind: 'unauthorized' } | { kind: 'error' }

export async function fetchSlots(input: {
  serviceId: string
  variantIds: string[]
  from: string
  to: string
}): Promise<SlotsResult> {
  try {
    const res = await fetch('/api/c/availability', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (res.status === 401) return { kind: 'unauthorized' }
    // 422: pedido fora do horizonte ou serviço que deixou de estar marcável.
    if (res.status === 422) return { kind: 'ok', slots: [] }
    if (!res.ok) return { kind: 'error' }
    const body = await json<{ slots: Slot[] }>(res)
    return body ? { kind: 'ok', slots: body.slots } : { kind: 'error' }
  } catch {
    return { kind: 'error' }
  }
}

export async function bookSlot(input: BookInput): Promise<BookResult | 'unauthorized' | 'error'> {
  try {
    const res = await fetch('/api/c/book', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (res.status === 401) return 'unauthorized'
    if (!res.ok) return 'error'
    return (await json<BookResult>(res)) ?? 'error'
  } catch {
    return 'error'
  }
}
