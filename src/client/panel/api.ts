/** Cliente HTTP do painel — Bearer + cancelamento por geração de tenant (#22). */

export type AuthMode = 'synthetic' | 'clerk'

export type ClientAuthConfig = {
  authMode: AuthMode
  clerkPublishableKey: string | null
}

export type MeResponse = {
  kind: string
  clerkUserId: string
  sessionId: string
  isSuperadmin: boolean
}

export type TenantSummary = {
  tenantId: string
  name: string
  role: 'owner' | 'attendant'
  status: 'active'
}

export type TenantContextResponse = {
  tenantId: string
  name: string
  status: 'active'
  role: 'owner' | 'attendant'
}

export type ApiErrorCode =
  | 'unauthenticated'
  | 'session_expired'
  | 'tenant_access_denied'
  | 'permission_denied'
  | 'forged_role_rejected'
  | 'tenant_not_active'
  | 'network'
  | 'unknown'

export class PanelApiError extends Error {
  readonly status: number
  readonly code: ApiErrorCode

  constructor(status: number, code: ApiErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'PanelApiError'
    this.status = status
    this.code = code
  }
}

export type TokenGetter = () => Promise<string | null>

type FetchOpts = {
  signal?: AbortSignal
  /** Geração do tenant ativo — resposta tardia de outra clínica é descartada. */
  generation?: number
  expectGeneration?: () => number
}

async function parseError(res: Response): Promise<PanelApiError> {
  let code: ApiErrorCode = 'unknown'
  try {
    const body: unknown = await res.json()
    if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
      code = body.error as ApiErrorCode
    }
  } catch {
    /* ignore */
  }
  if (res.status === 401 && code === 'unknown') code = 'unauthenticated'
  if (res.status === 403 && code === 'unknown') code = 'permission_denied'
  return new PanelApiError(res.status, code)
}

function assertGeneration(opts?: FetchOpts): void {
  if (
    opts?.generation !== undefined &&
    opts.expectGeneration &&
    opts.expectGeneration() !== opts.generation
  ) {
    throw new PanelApiError(0, 'network', 'stale_tenant_response')
  }
}

export async function fetchClientAuthConfig(signal?: AbortSignal): Promise<ClientAuthConfig> {
  const res = await fetch('/api/auth/client-config', { signal, credentials: 'same-origin' })
  if (!res.ok) throw await parseError(res)
  const data: unknown = await res.json()
  if (
    !data ||
    typeof data !== 'object' ||
    !('authMode' in data) ||
    (data.authMode !== 'synthetic' && data.authMode !== 'clerk')
  ) {
    throw new PanelApiError(500, 'unknown', 'client_config_invalid')
  }
  const key =
    'clerkPublishableKey' in data && typeof data.clerkPublishableKey === 'string'
      ? data.clerkPublishableKey
      : null
  return { authMode: data.authMode, clerkPublishableKey: key }
}

export function createPanelApi(getToken: TokenGetter) {
  async function authFetch(path: string, init: RequestInit = {}, opts?: FetchOpts): Promise<Response> {
    const token = await getToken()
    if (!token) throw new PanelApiError(401, 'unauthenticated')
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)
    headers.set('Accept', 'application/json')
    try {
      const res = await fetch(path, {
        ...init,
        headers,
        signal: opts?.signal,
        credentials: 'same-origin',
      })
      assertGeneration(opts)
      return res
    } catch (err) {
      if (err instanceof PanelApiError) throw err
      if (opts?.signal?.aborted) throw err
      throw new PanelApiError(0, 'network', err instanceof Error ? err.message : 'network')
    }
  }

  return {
    async getMe(opts?: FetchOpts): Promise<MeResponse> {
      const res = await authFetch('/api/me', {}, opts)
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as MeResponse
    },

    async listTenants(opts?: FetchOpts): Promise<TenantSummary[]> {
      const res = await authFetch('/api/me/tenants', {}, opts)
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      const body = (await res.json()) as { tenants: TenantSummary[] }
      assertGeneration(opts)
      return body.tenants
    },

    async getTenantContext(tenantId: string, opts?: FetchOpts): Promise<TenantContextResponse> {
      const res = await authFetch(`/api/tenants/${encodeURIComponent(tenantId)}/context`, {}, opts)
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      const body = (await res.json()) as TenantContextResponse
      assertGeneration(opts)
      return body
    },

    async getClinicConfig(tenantId: string, opts?: FetchOpts): Promise<ClinicConfigSnapshot> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/config`,
        {},
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      const body = (await res.json()) as ClinicConfigSnapshot
      assertGeneration(opts)
      return body
    },

    async upsertService(
      tenantId: string,
      body: ServiceUpsertBody,
      opts?: FetchOpts & { serviceId?: string },
    ): Promise<ClinicService> {
      const path = opts?.serviceId
        ? `/api/tenants/${encodeURIComponent(tenantId)}/config/services/${encodeURIComponent(opts.serviceId)}`
        : `/api/tenants/${encodeURIComponent(tenantId)}/config/services`
      const res = await authFetch(
        path,
        {
          method: opts?.serviceId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as ClinicService
    },

    async setServiceActive(
      tenantId: string,
      serviceId: string,
      active: boolean,
      opts?: FetchOpts,
    ): Promise<ClinicService> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/config/services/${encodeURIComponent(serviceId)}/active`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ active }),
        },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as ClinicService
    },

    async upsertResource(
      tenantId: string,
      body: ResourceUpsertBody,
      opts?: FetchOpts & { resourceId?: string },
    ): Promise<ClinicResource> {
      const path = opts?.resourceId
        ? `/api/tenants/${encodeURIComponent(tenantId)}/config/resources/${encodeURIComponent(opts.resourceId)}`
        : `/api/tenants/${encodeURIComponent(tenantId)}/config/resources`
      const res = await authFetch(
        path,
        {
          method: opts?.resourceId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as ClinicResource
    },

    async setResourceActive(
      tenantId: string,
      resourceId: string,
      active: boolean,
      opts?: FetchOpts,
    ): Promise<ClinicResource> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/config/resources/${encodeURIComponent(resourceId)}/active`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ active }),
        },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as ClinicResource
    },

    async setWeeklyWindows(
      tenantId: string,
      resourceId: string,
      windows: WeeklyWindowInput[],
      opts?: FetchOpts,
    ): Promise<{ windows: ClinicWeeklyWindow[] }> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/config/resources/${encodeURIComponent(resourceId)}/weekly`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ windows }),
        },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as { windows: ClinicWeeklyWindow[] }
    },

    async createBlock(
      tenantId: string,
      body: CreateBlockBody,
      opts?: FetchOpts,
    ): Promise<CreateBlockResponse> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/config/blocks`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
      return (await res.json()) as CreateBlockResponse
    },

    async deleteBlock(tenantId: string, blockId: string, opts?: FetchOpts): Promise<void> {
      const res = await authFetch(
        `/api/tenants/${encodeURIComponent(tenantId)}/config/blocks/${encodeURIComponent(blockId)}`,
        { method: 'DELETE' },
        opts,
      )
      assertGeneration(opts)
      if (!res.ok) throw await parseError(res)
    },
  }
}

export type RoomRequirementDto =
  | { mode: 'none' }
  | { mode: 'category'; category: string }
  | { mode: 'resource'; resourceId: string }

export type ClinicService = {
  id: string
  name: string
  durationMinutes: number
  bufferMinutes: number
  occupiedMinutes: number
  priceCents: number | null
  clientExplanation: string | null
  active: boolean
  professionalIds: string[]
  roomRequirement: RoomRequirementDto
  createdAt: number
  updatedAt: number
}

export type ClinicResource = {
  id: string
  kind: 'professional' | 'room' | 'equipment'
  name: string
  category: string | null
  active: boolean
  futureAppointmentCount: number
  servicesWithoutResource?: string[]
  createdAt: number
  updatedAt: number
}

export type ClinicWeeklyWindow = {
  id: string
  resourceId: string
  dayOfWeek: number
  startMinute: number
  endMinute: number
}

export type ClinicBlock = {
  id: string
  resourceId: string
  startsAt: number
  endsAt: number
  reason: string
  note: string | null
  createdAt: number
}

export type ClinicConfigReadiness = {
  agendaConfigured: boolean
  readyToServe: boolean
  schedulingAllowed: boolean
  missing: string[]
  timezone: string
  counts: {
    servicesActive: number
    professionalsActive: number
    roomsActive: number
    resourcesWithWeekly: number
  }
}

export type ClinicConfigSnapshot = {
  settings: { tenantId: string; timezone: string; updatedAt: number }
  services: ClinicService[]
  resources: ClinicResource[]
  weeklyWindows: ClinicWeeklyWindow[]
  blocks: ClinicBlock[]
  readiness: ClinicConfigReadiness
}

export type ServiceUpsertBody = {
  name: string
  durationMinutes: number
  bufferMinutes: number
  priceCents?: number | null
  clientExplanation?: string | null
  active?: boolean
  professionalIds: string[]
  roomRequirement?: RoomRequirementDto
}

export type ResourceUpsertBody = {
  kind: 'professional' | 'room' | 'equipment'
  name: string
  category?: string | null
  active?: boolean
}

export type WeeklyWindowInput = {
  dayOfWeek: number
  startMinute: number
  endMinute: number
}

export type CreateBlockBody = {
  resourceId: string
  startsAt: number
  endsAt: number
  reason: 'folga' | 'ferias' | 'feriado' | 'manutencao' | 'outro'
  note?: string | null
  dryRun?: boolean
}

export type CreateBlockResponse = {
  created: boolean
  block: ClinicBlock | null
  affectedAppointments: Array<{
    id: string
    contactLabel: string | null
    startsAt: number
    endsAt: number
    status: string
  }>
}

export type PanelApi = ReturnType<typeof createPanelApi>
