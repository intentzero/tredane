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
