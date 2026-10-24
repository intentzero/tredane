import type { MembershipRole } from '../db/schema'

/** Principal humano autenticado via sessão Clerk (sem Organizations). */
export type HumanPrincipal = {
  kind: 'human'
  clerkUserId: string
  sessionId: string
  /** true somente após verificação backend de privateMetadata.superadmin === true. */
  isSuperadmin: boolean
}

/**
 * Integração verificada (webhook/queue) — placeholder estrutural para F3.
 * Nunca confiar em tenant declarado pelo payload sem verificação de origem.
 */
export type IntegrationPrincipal = {
  kind: 'integration'
  integrationId: string
  tenantId: string
  verified: true
}

export type Principal = HumanPrincipal | IntegrationPrincipal

export type TenantContext = {
  tenantId: string
  role: MembershipRole
  tenantName: string
  tenantStatus: 'active'
}

/**
 * Capacidades do painel clínico / platform (matriz #21).
 * Deny-by-default: ausência na matriz = negado.
 */
export type Permission =
  | 'clinic.context.read'
  | 'clinic.inbox.read'
  | 'clinic.inbox.reply'
  | 'clinic.pipeline.move'
  | 'clinic.agenda.operate'
  | 'clinic.config.write'
  | 'clinic.contacts.delete'
  | 'clinic.members.invite_attendant'
  | 'clinic.members.revoke_attendant'
  | 'clinic.support.decide'
  | 'platform.tenants.read'
  | 'platform.tenants.write'
  | 'platform.owners.manage'
  | 'platform.support.request'

export type SessionAuthResult =
  | {
      ok: true
      clerkUserId: string
      sessionId: string
      /** Origem do transporte: bearer evita CSRF de cookie; cookie exige Origin. */
      transport: 'bearer' | 'cookie'
    }
  | {
      ok: false
      reason: 'missing' | 'expired' | 'invalid' | 'origin_rejected'
    }

export type UserAuthoritySnapshot = {
  clerkUserId: string
  /** Valor bruto de privateMetadata.superadmin — só true booleano autoriza. */
  privateSuperadmin: unknown
  /** Nunca usar publicMetadata para privilégio. */
  publicSuperadmin: unknown
}
