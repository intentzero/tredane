/**
 * Cliente HTTP da página web da cliente. Só chama `/api/c/*` (mesma origem, cookie de sessão).
 * Nunca envia nem recebe `tenant_id` ou `contact_id`; o token só vai no corpo da troca.
 */

export type ClientWebAppointment = {
  id: string
  serviceName: string
  startsAt: number
  endsAt: number
  /** DEC-218: serviço e profissional da marcação (pré-escolha ao remarcar). */
  serviceId: string
  professionalId: string
  professionalName: string
  /** Sinal pago: a cliente não cancela sozinha, pede à equipe (DEC-198). */
  hasPaidSignal: boolean
  /** Variantes da visita (snapshot); vazio sem zonas. */
  zoneNames: string[]
  /** Combo aplicado na visita, se houver. */
  comboName: string | null
  /** Preço cotado (combo / soma zonas / linha do serviço). */
  priceCents: number | null
}

export type ClientWebState = {
  clinicName: string
  firstName: string | null
  timezone: string
  /** DEC-211: «Como chegar» (link do Google Business); ausente sem link. */
  locationUrl?: string | null
  appointments: ClientWebAppointment[]
  sessionExpiresAt: number
}

export type CatalogZone = {
  id: string
  name: string
  /** Só para a pesquisa casar (DEC-110); nunca se mostra. */
  synonyms: string[]
  audience: 'feminino' | 'masculino' | 'ambos'
  durationMinutes: number
  priceCents: number | null
}

/** Combo activo e aplicável (DEC-080): preço próprio, 2+ zonas activas. */
export type CatalogCombo = {
  id: string
  name: string
  priceCents: number
  zoneIds: string[]
}

export type CatalogProfessional = { id: string; name: string }

export type CatalogService = {
  id: string
  name: string
  /** Só para a pesquisa casar (DEC-110); nunca se mostra. */
  synonyms: string[]
  durationMinutes: number
  priceCents: number | null
  audience: 'feminino' | 'masculino' | 'qualquer'
  variantKind: string | null
  variantKindPlural: string | null
  variantSelection: 'uma' | 'varias'
  requiresSignal: boolean
  zones: CatalogZone[]
  /** DEC-080 — omitido ou vazio = sem combos. */
  combos?: CatalogCombo[]
  /** DEC-218: profissionais ativas do serviço (ordenadas por nome). */
  professionals: CatalogProfessional[]
}

export type Catalog = {
  timezone: string
  horizonDays: number
  today: string
  services: CatalogService[]
}

export type Slot = { id: string; date: string; time: string }

/** Dia sem vagas: fechada (sem expediente / bloqueio clínica) ou cheia. Sem nome de feriado. */
export type EmptyDayReason = 'closed' | 'full'
export type EmptyDay = { date: string; reason: EmptyDayReason }

export type Line = 'feminino' | 'masculino'

export type BookInput = {
  serviceId: string
  variantIds: string[]
  line: Line | null
  slotId: string
  /** null = Sem preferência (DEC-218). */
  professionalId: string | null
}

export type BookResult =
  | {
      status: 'booked'
      appointment: {
        id: string
        startsAt: number
        endsAt: number
        serviceName: string
        professionalName: string | null
      }
    }
  | { status: 'pix_signal' }
  | { status: 'slot_taken' }
  | { status: 'paused' }
  | { status: 'error'; error: string }

/** Finalidade do link: abre a página já no ecrã de remarcar ou de cancelar (ADR-0018, Fase 5). */
export type LinkPurpose = 'home' | 'agendar' | 'remarcar' | 'cancelar'
export type ExchangeResult =
  | {
      kind: 'ok'
      purpose: LinkPurpose
      appointmentId: string | null
      serviceId: string | null
      audienceLine: Line | null
      variantIds: string[]
      preferredDate: string | null
      dayPart: 'manha' | 'tarde' | 'noite' | null
    }
  | 'unavailable'
  | 'error'
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
      if (res.ok) {
        const body = await json<{
          purpose?: LinkPurpose
          appointmentId?: string | null
          serviceId?: string | null
          audienceLine?: string | null
          variantIds?: string[]
          preferredDate?: string | null
          dayPart?: string | null
        }>(res)
        const audienceLine =
          body?.audienceLine === 'feminino' || body?.audienceLine === 'masculino' ? body.audienceLine : null
        const variantIds = Array.isArray(body?.variantIds)
          ? body.variantIds.filter((x): x is string => typeof x === 'string')
          : []
        const preferredDate =
          typeof body?.preferredDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.preferredDate)
            ? body.preferredDate
            : null
        const dayPart =
          body?.dayPart === 'manha' || body?.dayPart === 'tarde' || body?.dayPart === 'noite' ? body.dayPart : null
        return {
          kind: 'ok',
          purpose: body?.purpose ?? 'home',
          appointmentId: body?.appointmentId ?? null,
          serviceId: body?.serviceId ?? null,
          audienceLine,
          variantIds,
          preferredDate,
          dayPart,
        }
      }
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

export type SlotsResult =
  | { kind: 'ok'; slots: Slot[]; emptyDays: EmptyDay[] }
  | { kind: 'unauthorized' }
  | { kind: 'error' }

function parseEmptyDays(raw: unknown): EmptyDay[] {
  if (!Array.isArray(raw)) return []
  const out: EmptyDay[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const date = (row as { date?: unknown }).date
    const reason = (row as { reason?: unknown }).reason
    if (typeof date !== 'string' || (reason !== 'closed' && reason !== 'full')) continue
    out.push({ date, reason })
  }
  return out
}

export async function fetchSlots(input: {
  serviceId: string
  variantIds: string[]
  from: string
  to: string
  /** Calendário: só a primeira hora de cada dia. */
  daysOnly?: boolean
  /** DEC-218: preferência; omitido/null = Sem preferência. */
  professionalId?: string | null
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
    if (res.status === 422) return { kind: 'ok', slots: [], emptyDays: [] }
    if (!res.ok) return { kind: 'error' }
    const body = await json<{ slots: Slot[]; emptyDays?: unknown }>(res)
    return body ? { kind: 'ok', slots: body.slots, emptyDays: parseEmptyDays(body.emptyDays) } : { kind: 'error' }
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

export type CancelResult = { status: 'cancelled'; serviceName: string; startsAt: number } | { status: 'needs_team' } | { status: 'not_found' }

/** Horas para remarcar: serviço e zonas vêm da própria marcação. */
export async function fetchRescheduleSlots(input: {
  appointmentId: string
  from: string
  to: string
  daysOnly?: boolean
  professionalId?: string | null
}): Promise<SlotsResult> {
  try {
    const res = await fetch('/api/c/availability', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (res.status === 401) return { kind: 'unauthorized' }
    if (res.status === 404 || res.status === 422) return { kind: 'ok', slots: [], emptyDays: [] }
    if (!res.ok) return { kind: 'error' }
    const body = await json<{ slots: Slot[]; emptyDays?: unknown }>(res)
    return body ? { kind: 'ok', slots: body.slots, emptyDays: parseEmptyDays(body.emptyDays) } : { kind: 'error' }
  } catch {
    return { kind: 'error' }
  }
}

export async function rescheduleSlot(input: {
  appointmentId: string
  slotId: string
  professionalId?: string | null
}): Promise<BookResult | 'unauthorized' | 'error'> {
  try {
    const res = await fetch('/api/c/reschedule', {
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

export async function cancelAppointment(input: { appointmentId: string }): Promise<CancelResult | 'unauthorized' | 'error'> {
  try {
    const res = await fetch('/api/c/cancel', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (res.status === 401) return 'unauthorized'
    if (!res.ok) return 'error'
    return (await json<CancelResult>(res)) ?? 'error'
  } catch {
    return 'error'
  }
}

export async function askTeam(): Promise<'asked' | 'after_hours' | 'unauthorized' | 'error'> {
  try {
    const res = await fetch('/api/c/ask-team', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    if (res.status === 401) return 'unauthorized'
    if (!res.ok) return 'error'
    const body = await json<{ status: 'asked' | 'after_hours' }>(res)
    return body?.status ?? 'error'
  } catch {
    return 'error'
  }
}
