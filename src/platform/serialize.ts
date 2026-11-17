import type { DeletionCommandRow } from '../db/admin/deletion-commands'
import type { InvitationRow } from '../db/admin/invitations'
import { assessHealth, HEALTH_REFRESH_INTERVAL_MS, type HealthClinicRow } from '../ops/health-summary'
import type { MembershipRow } from '../db/admin/memberships'
import type { TenantRow } from '../db/admin/tenants'
import type { TenantIntegrationStatus } from './integration-status'

export function serializeTenant(t: TenantRow) {
  return {
    id: t.id,
    name: t.name,
    timezone: t.timezone,
    status: t.status,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    suspendedAt: t.suspendedAt,
    pendingDeletionAt: t.pendingDeletionAt,
  }
}

export function serializeMembership(m: MembershipRow) {
  return {
    tenantId: m.tenantId,
    clerkUserId: m.clerkUserId,
    role: m.role,
    status: m.status,
    createdAt: m.createdAt,
    revokedAt: m.revokedAt,
  }
}

/** Convite pendente visto pela Platform Admin: nunca o token, nem quem o emitiu além do id. */
export function serializePlatformInvitation(i: InvitationRow, nowMs: number) {
  return {
    id: i.id,
    email: i.normalizedEmail,
    role: i.role,
    status: i.status,
    issuedAt: i.issuedAt,
    expiresAt: i.expiresAt,
    lastResentAt: i.lastResentAt,
    /** `pending` com prazo vencido: o aceite já é recusado; falta só reenviar. */
    expired: i.status === 'pending' && nowMs >= i.expiresAt,
  }
}

export function serializeDeletionCommand(c: DeletionCommandRow) {
  return {
    id: c.id,
    tenantId: c.tenantId,
    status: c.status,
    requestedByClerkUserId: c.requestedByClerkUserId,
    requestedAt: c.requestedAt,
    updatedAt: c.updatedAt,
  }
}

export function serializeAdminTenantView(input: {
  tenant: TenantRow
  members: MembershipRow[]
  integration: TenantIntegrationStatus
  deletionCommand?: DeletionCommandRow | null
  invitations?: InvitationRow[]
  nowMs?: number
  recentAudit: Array<{
    id: string
    action: string
    outcome: string
    occurredAt: number
    actorClerkUserId: string
    subjectClerkUserId: string | null
  }>
}) {
  return {
    tenant: serializeTenant(input.tenant),
    members: input.members.map(serializeMembership),
    owners: input.members
      .filter((m) => m.role === 'owner' && m.status === 'active')
      .map(serializeMembership),
    integration: input.integration,
    deletionCommand: input.deletionCommand
      ? serializeDeletionCommand(input.deletionCommand)
      : null,
    invitations: (input.invitations ?? []).map((i) => serializePlatformInvitation(i, input.nowMs ?? Date.now())),
    recentAudit: input.recentAudit.map((e) => ({
      id: e.id,
      action: e.action,
      outcome: e.outcome,
      occurredAt: e.occurredAt,
      actorClerkUserId: e.actorClerkUserId,
      subjectClerkUserId: e.subjectClerkUserId,
    })),
    /** Explicitamente ausente: sem conversas, mensagens ou agenda. */
    clinicalAccess: false as const,
  }
}

/** Saúde de uma clínica para a Platform Admin: só contagens e estados (DEC-193). */
export function serializeHealth(row: HealthClinicRow) {
  const a = assessHealth(row.summary, row.whatsappStatus)
  const h = row.summary
  return {
    tenantId: row.tenantId,
    name: row.name,
    tenantStatus: row.tenantStatus,
    whatsapp: { status: row.whatsappStatus },
    /** Clínicas suspensas ou em exclusão não são lidas: ficam com a última leitura. */
    situation: row.tenantStatus === 'active' ? a.situation : ('inactive' as const),
    /** A última tentativa de leitura falhou: os números são da última leitura boa. */
    stale: a.stale,
    alerts: a.alerts,
    readAt: h?.readAt ?? null,
    lastOkAt: h?.lastOkAt ?? null,
    counts: h && h.lastOkAt !== null
      ? {
          pendingOutbox: h.pendingOutbox,
          failedOutbox: h.failedOutbox,
          uncertainOutbound: h.uncertainOutbound,
          llmJobsOpen: h.llmJobsOpen,
          llmJobsFailed1h: h.llmJobsFailed1h,
          /** Volume (Q-PA-04): só números, nunca conteúdo. */
          contactCount: h.contactCount,
          messageCount: h.messageCount,
          appointmentCount: h.appointmentCount,
          attachmentCount: h.attachmentCount,
          schemaVersion: h.schemaVersion,
          schemaReady: h.schemaReady,
        }
      : null,
  }
}

export function serializeHealthOverview(rows: HealthClinicRow[]) {
  const clinics = rows.map(serializeHealth)
  const active = clinics.filter((c) => c.tenantStatus === 'active')
  const count = (s: string) => active.filter((c) => c.situation === s).length
  const reads = clinics.map((c) => c.readAt).filter((v): v is number => v !== null)
  return {
    summaryAt: reads.length ? Math.max(...reads) : null,
    refreshIntervalMs: HEALTH_REFRESH_INTERVAL_MS,
    totals: {
      activeClinics: active.length,
      critical: count('critical'),
      attention: count('attention'),
      normal: count('normal'),
      noData: count('no_data'),
      unreachable: active.filter((c) => c.stale).length,
      llmJobsOpen: active.reduce((n, c) => n + (c.counts?.llmJobsOpen ?? 0), 0),
    },
    clinics,
    clinicalAccess: false as const,
  }
}
