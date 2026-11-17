/**
 * Overlay de sessão de suporte nas rotas da clínica (#853 PR 2, ADR-0017 §1–§2, DEC-195).
 *
 * `requireTenantAccess` passa a aceitar, no lugar do membership real, uma sessão de suporte **só de leitura**:
 *  - vale para UMA clínica (a da sessão) e só enquanto todas as condições se verificarem **no pedido atual**
 *    (Bearer Clerk do actor, flag de superadmin agora, sessão Clerk, hash do cookie, prazo, clínica e membership do subject);
 *  - só deixa passar `GET` a rotas de uma lista **explícita** (deny-by-default, independente do que cada handler verifica);
 *  - corta telefones das respostas (só os 4 últimos dígitos, consequência de Q-SUP-01);
 *  - audita cada leitura (`support.access`, agregada por sessão, rota e minuto, Q-SUP-02) e cada tentativa bloqueada.
 * `superadmin` continua sem abrir nada por si: sem cookie válido, o comportamento é o de sempre (membership real).
 */
import type { AsyncAdminDb } from '../db/admin/async-store'
import type { Clock } from '../db/clock'
import { ForbiddenError } from '../db/admin/errors'
import type { SupportSessionRow } from '../db/admin/support'
import { requireVerifiedSuperadmin } from '../auth/superadmin'
import { AuthError, type AuthErrorCode } from '../auth/errors'
import type { AuthorityReader } from '../auth/superadmin'
import type { HumanPrincipal, Permission, TenantContext } from '../auth/types'
import { permissionsForClinicRole } from '../auth/permissions'
import { resolveSupportSessionByTokenAsync } from './d1-session'

/** Permissões que uma sessão de suporte pode exercer (ADR-0017 §2, Q-SUP-01 = ler conversas). Nunca escrita. */
export const SUPPORT_READ_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
  'clinic.context.read',
  'clinic.inbox.read',
])

/**
 * Rotas de leitura que uma sessão de suporte pode chamar. **Deny-by-default**: o que não está aqui responde 403,
 * mesmo que o handler só verifique uma permissão de leitura (várias rotas de escrita partilham `clinic.inbox.read`).
 * Pipeline, agenda e configuração ficam de fora até terem permissões de leitura próprias (ADR-0017 §2).
 */
export const SUPPORT_READ_ROUTES: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'context', re: /^\/api\/tenants\/[^/]+\/context$/ },
  { name: 'inbox.conversations', re: /^\/api\/tenants\/[^/]+\/inbox\/conversations$/ },
  { name: 'inbox.conversation', re: /^\/api\/tenants\/[^/]+\/inbox\/conversations\/[^/]+$/ },
  { name: 'inbox.contacts', re: /^\/api\/tenants\/[^/]+\/inbox\/contacts$/ },
  { name: 'inbox.contact', re: /^\/api\/tenants\/[^/]+\/inbox\/contacts\/[^/]+$/ },
]

export function matchSupportReadRoute(method: string, pathname: string): string | null {
  if (method !== 'GET') return null
  return SUPPORT_READ_ROUTES.find((r) => r.re.test(pathname))?.name ?? null
}

/** Único `POST` que a sessão de suporte pode fazer: pedir o bilhete do WebSocket de leitura (ADR-0017 §4). */
const SUPPORT_TICKET_RE = /^\/api\/tenants\/[^/]+\/realtime\/ticket$/
export function matchSupportTicketRoute(method: string, pathname: string): string | null {
  return method === 'POST' && SUPPORT_TICKET_RE.test(pathname) ? 'realtime.ticket' : null
}

export type SupportOverlayServices = {
  adminDb: AsyncAdminDb
  authority: AuthorityReader
  clock?: Clock
}

const MINUTE = 60_000

/** Uma entrada por (sessão, rota, minuto, resultado): auditoria útil sem inundar o `central_audit_events`. */
export async function recordSupportAccess(
  db: AsyncAdminDb,
  input: {
    session: Pick<SupportSessionRow, 'id' | 'tenantId' | 'actorClerkUserId' | 'subjectClerkUserId'>
    route: string
    method: string
    outcome: 'success' | 'denied'
    nowMs: number
  },
): Promise<void> {
  const minute = Math.floor(input.nowMs / MINUTE)
  const id = `aud_sac_${input.session.id}_${input.outcome}_${input.method}_${input.route}_${minute}`.slice(0, 190)
  await db.run(
    `INSERT INTO central_audit_events (
       id, occurred_at, actor_clerk_user_id, subject_clerk_user_id, tenant_id,
       action, object_type, object_id, outcome, support_session_id, metadata_json
     ) VALUES (?, ?, ?, ?, ?, ?, 'support_session', ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
    id,
    input.nowMs,
    input.session.actorClerkUserId,
    input.session.subjectClerkUserId,
    input.session.tenantId,
    input.outcome === 'success' ? 'support.access' : 'support.access.denied',
    input.session.id,
    input.outcome,
    input.session.id,
    JSON.stringify({ route: input.route, method: input.method }),
  )
}

/**
 * Resolve o contexto de clínica de uma sessão de suporte. Qualquer falha lança `AuthError` (403); o chamador limpa o cookie.
 * O papel do contexto é o **papel atual do subject** nessa clínica (ADR-0007 §3).
 */
export async function resolveSupportTenantContext(
  services: SupportOverlayServices,
  principal: HumanPrincipal,
  tenantId: string,
  sessionToken: string,
  clock: Clock,
): Promise<{ ctx: TenantContext; session: SupportSessionRow }> {
  // A flag de superadmin é lida agora, a cada pedido: retirá-la corta a sessão (ADR-0006 §2).
  await requireVerifiedSuperadmin(services.authority, principal.clerkUserId)
  let session: SupportSessionRow
  try {
    session = await resolveSupportSessionByTokenAsync(services.adminDb, clock, {
      sessionToken,
      actorClerkUserId: principal.clerkUserId,
      actorClerkSessionId: principal.sessionId,
      // O tenant do caminho tem de ser o da sessão: cookie de outra clínica é recusado, nunca ignorado.
      claimedTenantId: tenantId,
    })
  } catch (err) {
    if (err instanceof ForbiddenError) throw new AuthError(err.code as AuthErrorCode, err.message, 403)
    throw err
  }
  const subject = await services.adminDb.get<{ role: string }>(
    `SELECT role FROM tenant_memberships WHERE tenant_id = ? AND clerk_user_id = ? AND status = 'active'`,
    session.tenantId,
    session.subjectClerkUserId,
  )
  const tenant = await services.adminDb.get<{ name: string }>(`SELECT name FROM tenants WHERE id = ?`, session.tenantId)
  if (!subject || !tenant) throw new AuthError('support_session_not_active', 'Sessão de suporte inativa', 403)
  const role = subject.role === 'owner' ? 'owner' : 'attendant'
  return {
    session,
    ctx: {
      tenantId: session.tenantId,
      role,
      tenantName: tenant.name,
      tenantStatus: 'active',
      support: {
        sessionId: session.id,
        actorClerkUserId: session.actorClerkUserId,
        subjectClerkUserId: session.subjectClerkUserId,
        expiresAt: session.expiresAt,
      },
    },
  }
}

/** Permissão efetiva em sessão de suporte = a do papel do subject ∩ lista de leitura (ADR-0017 §2). */
export function supportPermissionAllowed(role: TenantContext['role'], permission: Permission): boolean {
  return permissionsForClinicRole(role).has(permission) && SUPPORT_READ_PERMISSIONS.has(permission)
}

const PHONE_KEYS = new Set(['waid', 'contactwaid', 'towaid', 'phone', 'phonenumber', 'displayphone', 'contactphone'])

/** Só os 4 últimos dígitos (Q-SUP-01, consequência aprovada): a sessão de suporte não vê o número inteiro. */
export function maskDigits(value: string): string {
  const digits = value.replace(/\D/g, '')
  return digits.length <= 4 ? '••••' : `••••${digits.slice(-4)}`
}

export function redactPhones<T>(value: T): T {
  if (Array.isArray(value)) return value.map(redactPhones) as unknown as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = PHONE_KEYS.has(k.toLowerCase()) && typeof v === 'string' ? maskDigits(v) : redactPhones(v)
    }
    return out as T
  }
  return value
}
