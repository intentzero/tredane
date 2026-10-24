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
  }
}

export type PanelApi = ReturnType<typeof createPanelApi>
