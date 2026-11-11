/**
 * OAuth MCP (DEC-159) — Workers OAuth Provider no mesmo Worker.
 * Requer binding OAUTH_KV. Consent só com Clerk privateMetadata.superadmin.
 *
 * Imports do `@cloudflare/workers-oauth-provider` são dinâmicos para não
 * puxar `cloudflare:workers` no Vitest Node (Bearer superadmin cobre CI).
 */
import type { AuthServices } from '../../auth'
import { authenticateHumanWithOptionalSuperadmin } from '../../auth/authorize'
import { isAuthError } from '../../auth/errors'
import { REVIEW_SAMPLES_SCOPE } from '../../review-samples'
import type { WorkerBindings } from '../../worker/bindings'

/**
 * Top-level GET /authorize (redirect MCP) often has no Origin and an external Referer.
 * Synthesize Origin from our Host/APP_BASE_URL so cookie CSRF check accepts same-site
 * Lax cookies without weakening POST (form still sends real Origin ∈ parties).
 */
export function authorizeSessionRequest(
  request: Request,
  env: WorkerBindings | null | undefined,
): Request {
  if (request.method !== 'GET' && request.method !== 'HEAD') return request
  if (request.headers.get('Origin')) return request
  const url = new URL(request.url)
  let allowedOrigin: string | null = null
  if (env?.APP_BASE_URL) {
    try {
      const base = new URL(env.APP_BASE_URL)
      if (base.host === url.host) allowedOrigin = base.origin
    } catch {
      /* ignore */
    }
  }
  if (!allowedOrigin) {
    // Pedido já está no nosso host; Origin = origin do próprio URL.
    allowedOrigin = url.origin
  }
  const headers = new Headers(request.headers)
  headers.set('Origin', allowedOrigin)
  return new Request(request, { headers })
}

export type ReviewMcpOAuthProps = {
  clerkUserId: string
  scope: string[]
}

const SCOPES = [REVIEW_SAMPLES_SCOPE, 'offline_access'] as const

type OAuthMod = typeof import('@cloudflare/workers-oauth-provider')

async function loadOAuth(): Promise<OAuthMod> {
  return import('@cloudflare/workers-oauth-provider')
}

export function reviewMcpResourceUrl(
  env: WorkerBindings | null | undefined,
  requestUrl: string,
): string {
  const base = (env?.APP_BASE_URL ?? new URL(requestUrl).origin).replace(/\/$/, '')
  return `${base}/api/mcp/review-central`
}

export function reviewMcpIssuerUrl(
  env: WorkerBindings | null | undefined,
  requestUrl: string,
): string {
  return (env?.APP_BASE_URL ?? new URL(requestUrl).origin).replace(/\/$/, '')
}

export function oauthKvConfigured(env: WorkerBindings | null | undefined): boolean {
  return Boolean(env?.OAUTH_KV)
}

async function createReviewMcpAuthorizationServer(
  env: WorkerBindings,
  requestUrl: string,
) {
  const { OAuthAuthorizationServer } = await loadOAuth()
  return new OAuthAuthorizationServer<WorkerBindings>({
    issuer: reviewMcpIssuerUrl(env, requestUrl),
    resources: [reviewMcpResourceUrl(env, requestUrl)],
    scopesSupported: [...SCOPES],
    clientIdMetadataDocumentEnabled: true,
    clientRegistrationEndpoint: '/oauth/register',
  })
}

export function resourceMetadataBody(env: WorkerBindings, requestUrl: string) {
  const resource = reviewMcpResourceUrl(env, requestUrl)
  const issuer = reviewMcpIssuerUrl(env, requestUrl)
  return {
    resource,
    authorization_servers: [issuer],
    scopes_supported: [REVIEW_SAMPLES_SCOPE],
    bearer_methods_supported: ['header'],
  }
}

export function unauthorizedMcpResponse(
  env: WorkerBindings | null | undefined,
  requestUrl: string,
  message = 'Authentication required',
): Response {
  const metaUrl = `${reviewMcpIssuerUrl(env, requestUrl)}/.well-known/oauth-protected-resource`
  const headers = new Headers({
    'Content-Type': 'application/json',
    'WWW-Authenticate': `Bearer realm="tredane-review-central", resource_metadata="${metaUrl}"`,
  })
  return new Response(
    JSON.stringify({
      error: 'unauthorized',
      message,
      oauth: oauthKvConfigured(env),
      bearerSuperadminFallback: true,
      scope: REVIEW_SAMPLES_SCOPE,
    }),
    { status: 401, headers },
  )
}

/** Valida access token OAuth quando OAUTH_KV está configurado. */
export async function tryValidateReviewMcpOAuthToken(
  env: WorkerBindings,
  request: Request,
): Promise<ReviewMcpOAuthProps | null> {
  if (!oauthKvConfigured(env)) return null
  const auth = request.headers.get('Authorization')
  if (!auth || !/^Bearer\s+\S+/i.test(auth)) return null
  // Tokens Clerk/synth: deixar o caminho Bearer superadmin tratar.
  if (/^Bearer\s+synth:/i.test(auth)) return null
  if (/^Bearer\s+eyJ/i.test(auth)) return null

  try {
    const as = await createReviewMcpAuthorizationServer(env, request.url)
    const resource = reviewMcpResourceUrl(env, request.url)
    const token = auth.replace(/^Bearer\s+/i, '').trim()
    const validated = await as.validateToken<ReviewMcpOAuthProps>(
      resource,
      token,
      env,
    )
    if (!validated) return null
    const props = validated.props ?? ({} as ReviewMcpOAuthProps)
    const clerkUserId =
      typeof props.clerkUserId === 'string' && props.clerkUserId
        ? props.clerkUserId
        : validated.userId
    if (!clerkUserId) return null
    const scope = Array.isArray(validated.scope) ? validated.scope : []
    if (!scope.includes(REVIEW_SAMPLES_SCOPE)) return null
    return { clerkUserId, scope }
  } catch {
    return null
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
}

/** HTML quando /authorize GET não tem sessão Clerk superadmin (evita stall em text/plain). */
export function authorizeLoginRequiredHtml(
  loginUrl: string,
  message: string,
): string {
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Tredane — login para autorizar MCP</title>
<style>
body{font-family:system-ui,sans-serif;max-width:32rem;margin:2rem auto;padding:0 1rem;line-height:1.45}
a.button{display:inline-block;margin:.75rem .5rem .75rem 0;padding:.5rem 1rem;background:#111;color:#fff;text-decoration:none;border-radius:4px}
</style></head><body>
<h1>É preciso entrar no painel</h1>
<p>${escapeHtml(message)}</p>
<p>Abra o login numa conta com <code>privateMetadata.superadmin === true</code>, depois volte a esta página (ou reinicie o OAuth no Cursor).</p>
<p><a class="button" href="${escapeHtml(loginUrl)}">Abrir login Tredane</a></p>
<p style="color:#555;font-size:.9rem">URL desta autorização: mantenha o separador do Cursor aberto até concluir o consentimento.</p>
</body></html>`
}

function consentPageHtml(
  details: {
    clientName: string
    clientDomain?: string
    redirectHost: string
    redirectIsLoopback: boolean
    scope: string[]
  },
  handle: string,
  error?: string,
): string {
  const name = escapeHtml(details.clientName)
  const origin = details.clientDomain
    ? `Publicado por <strong>${escapeHtml(details.clientDomain)}</strong>.`
    : 'Esta app registrou-se sozinha; o nome não é verificado.'
  const scopes = details.scope
    .map(
      (scope) =>
        `<label><input type="checkbox" name="scope" value="${escapeHtml(scope)}" checked> ${escapeHtml(scope)}</label>`,
    )
    .join('<br>')
  const err = error
    ? `<p style="color:#b00020">${escapeHtml(error)}</p>`
    : ''
  const loopback = details.redirectIsLoopback
    ? '<p><strong>Os tokens vão para uma app no seu computador.</strong> Continue só se acabou de iniciar o login a partir dela.</p>'
    : ''
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Tredane — autorizar MCP de revisão</title>
<style>
body{font-family:system-ui,sans-serif;max-width:32rem;margin:2rem auto;padding:0 1rem;line-height:1.45}
button{margin-right:.5rem;padding:.5rem 1rem}
</style></head><body>
<h1>Permitir ${name}?</h1>
${err}
<p>${origin} O acesso será enviado a <strong>${escapeHtml(details.redirectHost)}</strong>.</p>
${loopback}
<p>Só contas com <code>privateMetadata.superadmin === true</code> podem consentir (DEC-159).</p>
<form method="post">
  <input type="hidden" name="handle" value="${escapeHtml(handle)}">
  ${scopes}
  <p>
    <button name="decision" value="approve" type="submit">Permitir</button>
    <button name="decision" value="deny" type="submit">Negar</button>
  </p>
</form>
</body></html>`
}

export async function handleReviewMcpAuthorize(
  request: Request,
  env: WorkerBindings,
  services: AuthServices,
): Promise<Response> {
  if (!oauthKvConfigured(env)) {
    return new Response('OAuth MCP não configurado (falta OAUTH_KV).', {
      status: 503,
    })
  }
  const { AuthorizationError } = await loadOAuth()
  const as = await createReviewMcpAuthorizationServer(env, request.url)
  const oauth = as.getOAuthApi(env)

  try {
    if (request.method === 'GET') {
      const authRequest = await oauth.parseAuthRequest(request)
      try {
        await authenticateHumanWithOptionalSuperadmin(
          services,
          authorizeSessionRequest(request, env),
          { verifySuperadmin: true },
        )
      } catch (err) {
        const loginUrl = `${reviewMcpIssuerUrl(env, request.url)}/entrar`
        const msg = isAuthError(err)
          ? err.message
          : 'Entre no painel como superadmin (sessão Clerk) e volte a abrir este URL.'
        // Sem redirect automático ao Clerk (forceRedirect do painel não volta ao /authorize).
        // HTML com link explícito evita o stall do browser OAuth em texto «Sessão ausente».
        return new Response(authorizeLoginRequiredHtml(loginUrl, msg), {
          status: 401,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      }
      const details = await oauth.describeConsent(authRequest)
      const consent = await oauth.beginConsent(authRequest)
      consent.headers.set('Content-Type', 'text/html; charset=utf-8')
      return new Response(consentPageHtml(details, consent.handle), {
        headers: consent.headers,
      })
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 })
    }

    const form = await request.formData()
    const handle = String(form.get('handle') ?? '')
    if (form.get('decision') !== 'approve') {
      const denied = await oauth.denyConsent(request, handle)
      return new Response(null, { status: 302, headers: denied.headers })
    }

    let clerkUserId: string
    try {
      const principal = await authenticateHumanWithOptionalSuperadmin(
        services,
        request,
        { verifySuperadmin: true },
      )
      clerkUserId = principal.clerkUserId
    } catch (err) {
      const msg = isAuthError(err)
        ? err.message
        : 'É necessário estar autenticado como superadmin.'
      return new Response(msg, {
        status: 401,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }

    const approved = await oauth.approveConsent(request, handle, {
      scope: form.getAll('scope').map(String),
    })
    const scope =
      approved.request.scope.length > 0
        ? approved.request.scope.filter((s) =>
            (SCOPES as readonly string[]).includes(s),
          )
        : [REVIEW_SAMPLES_SCOPE]
    const ensured = scope.includes(REVIEW_SAMPLES_SCOPE)
      ? scope
      : [...scope, REVIEW_SAMPLES_SCOPE]
    const { redirectTo } = await oauth.completeAuthorization({
      request: approved.request,
      userId: clerkUserId,
      metadata: {},
      scope: ensured,
      props: {
        clerkUserId,
        scope: ensured,
      } satisfies ReviewMcpOAuthProps,
    })
    approved.headers.set('Location', redirectTo)
    return new Response(null, { status: 302, headers: approved.headers })
  } catch (error) {
    if (error instanceof AuthorizationError && error.redirectTo) {
      return Response.redirect(error.redirectTo, 302)
    }
    if (error instanceof AuthorizationError) {
      return new Response(error.description ?? 'invalid_request', {
        status: 400,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }
    throw error
  }
}

export async function handleReviewMcpOAuthPassthrough(
  request: Request,
  env: WorkerBindings,
): Promise<Response | null> {
  if (!oauthKvConfigured(env)) return null
  const path = new URL(request.url).pathname
  if (path === '/authorize') return null
  const oauthPaths = new Set([
    '/oauth/token',
    '/oauth/register',
    '/oauth/revoke',
    '/.well-known/oauth-authorization-server',
    '/.well-known/openid-configuration',
  ])
  if (!oauthPaths.has(path) && !path.startsWith('/oauth/')) return null
  const as = await createReviewMcpAuthorizationServer(env, request.url)
  return as.fetch(request, env, {} as ExecutionContext)
}

export async function fetchOAuthAuthorizationServerMeta(
  request: Request,
  env: WorkerBindings,
): Promise<Response> {
  if (!oauthKvConfigured(env)) {
    return Response.json({ error: 'oauth_not_configured' }, { status: 503 })
  }
  const as = await createReviewMcpAuthorizationServer(env, request.url)
  return as.fetch(request, env, {} as ExecutionContext)
}
