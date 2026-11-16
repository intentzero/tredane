/**
 * Lista e integrações da Platform Admin (#829) — só metadados, nunca conteúdo clínico.
 * O mesmo SQL corre no store síncrono (testes/DO) e no D1 (produção).
 */
import type { AdminDb } from '../db/admin/store'
import type { TenantStatus } from '../db/schema'
import type { IntegrationChannelStatus, TenantIntegrationStatus } from './integration-status'

export type TenantOverviewRow = {
  id: string
  name: string
  timezone: string
  status: TenantStatus
  createdAt: number
  updatedAt: number
  suspendedAt: number | null
  pendingDeletionAt: number | null
  ownerCount: number
  memberCount: number
  whatsapp: { status: IntegrationChannelStatus }
}

type RawOverview = {
  id: string
  name: string
  timezone: string
  status: string
  created_at: number
  updated_at: number
  suspended_at: number | null
  pending_deletion_at: number | null
  owner_count: number
  member_count: number
  wa_binding_status: string | null
  wa_signup_pending: number
}

/** Uma linha por clínica; `ownerCount` e `memberCount` só contam membros ativos. */
export const TENANT_OVERVIEW_SQL = `
  SELECT t.id, t.name, t.timezone, t.status, t.created_at, t.updated_at,
         t.suspended_at, t.pending_deletion_at,
         (SELECT COUNT(*) FROM tenant_memberships m
           WHERE m.tenant_id = t.id AND m.status = 'active' AND m.role = 'owner') AS owner_count,
         (SELECT COUNT(*) FROM tenant_memberships m
           WHERE m.tenant_id = t.id AND m.status = 'active') AS member_count,
         (SELECT b.status FROM whatsapp_phone_bindings b
           WHERE b.tenant_id = t.id AND b.status IN ('active', 'interrupted')
           ORDER BY b.updated_at DESC LIMIT 1) AS wa_binding_status,
         (SELECT COUNT(*) FROM whatsapp_signup_sessions s
           WHERE s.tenant_id = t.id AND s.status = 'pending') AS wa_signup_pending
  FROM tenants t
  ORDER BY t.name COLLATE NOCASE, t.id`

/** Ligação ativa = ligado; interrompida = erro; sessão de cadastro aberta = pendente; senão não ligado. */
export function whatsappStatusFrom(
  bindingStatus: string | null,
  signupPending: number,
): IntegrationChannelStatus {
  if (bindingStatus === 'active') return 'connected'
  if (bindingStatus === 'interrupted') return 'error'
  if (signupPending > 0) return 'pending'
  return 'not_connected'
}

function mapOverview(r: RawOverview): TenantOverviewRow {
  return {
    id: r.id,
    name: r.name,
    timezone: r.timezone,
    status: r.status as TenantStatus,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    suspendedAt: r.suspended_at,
    pendingDeletionAt: r.pending_deletion_at,
    ownerCount: Number(r.owner_count),
    memberCount: Number(r.member_count),
    whatsapp: { status: whatsappStatusFrom(r.wa_binding_status, Number(r.wa_signup_pending)) },
  }
}

export function listTenantOverview(db: AdminDb): TenantOverviewRow[] {
  return db.all<RawOverview>(TENANT_OVERVIEW_SQL).map(mapOverview)
}

export async function d1ListTenantOverview(db: D1Database): Promise<TenantOverviewRow[]> {
  const result = await db.prepare(TENANT_OVERVIEW_SQL).all<RawOverview>()
  return (result.results ?? []).map(mapOverview)
}

const WA_NOTE: Record<IntegrationChannelStatus, string> = {
  connected: 'Número ligado à Meta',
  error: 'Ligação interrompida pela Meta',
  pending: 'Cadastro na Meta em curso',
  not_connected: 'Sem número ligado',
  not_configured: 'Sem número ligado',
}

type RawWhatsapp = { status: string | null; interrupt_reason: string | null; pending: number }

const WA_DETAIL_SQL = `
  SELECT
    (SELECT b.status FROM whatsapp_phone_bindings b
      WHERE b.tenant_id = ?1 AND b.status IN ('active', 'interrupted')
      ORDER BY b.updated_at DESC LIMIT 1) AS status,
    (SELECT b.interrupt_reason FROM whatsapp_phone_bindings b
      WHERE b.tenant_id = ?1 AND b.status IN ('active', 'interrupted')
      ORDER BY b.updated_at DESC LIMIT 1) AS interrupt_reason,
    (SELECT COUNT(*) FROM whatsapp_signup_sessions s
      WHERE s.tenant_id = ?1 AND s.status = 'pending') AS pending`

function integrationFrom(row: RawWhatsapp | null | undefined): TenantIntegrationStatus {
  const status = whatsappStatusFrom(row?.status ?? null, Number(row?.pending ?? 0))
  // Nunca o número de telefone nem o token (REQ-051): só o estado e, se houver, o código da interrupção.
  const note =
    status === 'error' && row?.interrupt_reason
      ? `${WA_NOTE.error} (${row.interrupt_reason})`
      : WA_NOTE[status]
  return {
    whatsapp: { status, note },
    // Pix: o adaptador real (Woovi) ainda não existe; continua a dizer a verdade.
    pix: {
      status: 'not_configured',
      note: 'Adaptador Pix simulado; conta da clínica não ligada',
    },
  }
}

export function readIntegrationStatus(db: AdminDb, tenantId: string): TenantIntegrationStatus {
  return integrationFrom(db.get<RawWhatsapp & Record<string, unknown>>(WA_DETAIL_SQL, tenantId))
}

export async function d1ReadIntegrationStatus(
  db: D1Database,
  tenantId: string,
): Promise<TenantIntegrationStatus> {
  const row = await db.prepare(WA_DETAIL_SQL).bind(tenantId).first<RawWhatsapp>()
  return integrationFrom(row)
}
