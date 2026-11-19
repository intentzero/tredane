/**
 * Vínculo da ficha de profissional (recurso da agenda no DO) com o login (D1).
 * DEC-204 / REQ-118.
 */
import type { Clock } from '../db/clock'
import {
  ConflictError,
  getMembership,
  requireActiveOwner,
  revokeMembership,
  upsertMembershipInTx,
  writeAudit,
} from '../db/admin'
import { normalizeEmail } from '../db/admin/ids'
import type { MembershipRole } from '../db/schema'
import type { AdminDb } from '../db/admin/store'
import type { EmailTransport } from '../email'

export type ProfessionalLoginRow = {
  tenantId: string
  resourceId: string
  email: string
  clerkUserId: string | null
  alsoAttendant: boolean
}

type LoginSql = {
  tenant_id: string
  resource_id: string
  normalized_email: string
  clerk_user_id: string | null
  also_attendant: number
}

function mapRow(row: LoginSql): ProfessionalLoginRow {
  return {
    tenantId: row.tenant_id,
    resourceId: row.resource_id,
    email: row.normalized_email,
    clerkUserId: row.clerk_user_id,
    alsoAttendant: row.also_attendant === 1,
  }
}

export function getProfessionalLogin(
  db: AdminDb,
  tenantId: string,
  resourceId: string,
): ProfessionalLoginRow | null {
  const row = db.get<LoginSql>(
    `SELECT tenant_id, resource_id, normalized_email, clerk_user_id, also_attendant
     FROM professional_logins WHERE tenant_id = ? AND resource_id = ?`,
    tenantId,
    resourceId,
  )
  return row ? mapRow(row) : null
}

export function professionalResourceIdForUser(
  db: AdminDb,
  tenantId: string,
  clerkUserId: string,
): string | null {
  const row = db.get<{ resource_id: string }>(
    `SELECT resource_id FROM professional_logins
     WHERE tenant_id = ? AND clerk_user_id = ?`,
    tenantId,
    clerkUserId,
  )
  return row?.resource_id ?? null
}

/** Vínculos ficha↔login desta clínica, indexados por clerkUserId (Equipe / DEC-204). */
export function listProfessionalLoginsByUser(
  db: AdminDb,
  tenantId: string,
): Map<string, { resourceId: string; alsoAttendant: boolean }> {
  const rows = db.all<LoginSql>(
    `SELECT tenant_id, resource_id, normalized_email, clerk_user_id, also_attendant
     FROM professional_logins
     WHERE tenant_id = ? AND clerk_user_id IS NOT NULL`,
    tenantId,
  )
  const map = new Map<string, { resourceId: string; alsoAttendant: boolean }>()
  for (const row of rows) {
    if (!row.clerk_user_id) continue
    map.set(row.clerk_user_id, {
      resourceId: row.resource_id,
      alsoAttendant: row.also_attendant === 1,
    })
  }
  return map
}

function desiredRole(alsoAttendant: boolean): 'attendant' | 'professional' {
  return alsoAttendant ? 'attendant' : 'professional'
}

/**
 * Ao mudar o e-mail da ficha, o utilizador antigo deixa de estar ligado a ela.
 * Revoga `professional`; se o papel era `attendant` só via alsoAttendant nesta
 * ficha (sem outro vínculo), também revoga — evita WhatsApp órfão (DEC-204).
 */
function revokeOrphanedLoginMembership(
  db: AdminDb,
  clock: Clock,
  input: {
    tenantId: string
    resourceId: string
    clerkUserId: string
    alsoAttendant: boolean
    actorClerkUserId: string
  },
): void {
  const old = getMembership(db, input.tenantId, input.clerkUserId)
  if (!old || old.status !== 'active') return
  if (old.role === 'professional') {
    revokeMembership(db, clock, {
      tenantId: input.tenantId,
      clerkUserId: input.clerkUserId,
      actorClerkUserId: input.actorClerkUserId,
    })
    return
  }
  if (old.role !== 'attendant' || !input.alsoAttendant) return
  const otherLink = db.get<{ resource_id: string }>(
    `SELECT resource_id FROM professional_logins
     WHERE tenant_id = ? AND clerk_user_id = ? AND resource_id <> ?`,
    input.tenantId,
    input.clerkUserId,
    input.resourceId,
  )
  if (otherLink) return
  revokeMembership(db, clock, {
    tenantId: input.tenantId,
    clerkUserId: input.clerkUserId,
    actorClerkUserId: input.actorClerkUserId,
  })
}

function alignMembership(
  db: AdminDb,
  clock: Clock,
  input: {
    tenantId: string
    clerkUserId: string
    alsoAttendant: boolean
    actorClerkUserId: string
  },
): MembershipRole {
  const desired = desiredRole(input.alsoAttendant)
  return db.immediate(() => {
    const current = getMembership(db, input.tenantId, input.clerkUserId)
    if (!current || current.status !== 'active') {
      const row = upsertMembershipInTx(db, clock, {
        tenantId: input.tenantId,
        clerkUserId: input.clerkUserId,
        role: desired,
        actorClerkUserId: input.actorClerkUserId,
      })
      return row.role
    }
    if (current.role === 'owner' || current.role === desired) return current.role
    db.run(
      `UPDATE tenant_memberships SET role = ?
       WHERE tenant_id = ? AND clerk_user_id = ? AND status = 'active'`,
      desired,
      input.tenantId,
      input.clerkUserId,
    )
    writeAudit(db, clock, {
      actorClerkUserId: input.actorClerkUserId,
      subjectClerkUserId: input.clerkUserId,
      tenantId: input.tenantId,
      action: 'membership.role',
      objectType: 'tenant_membership',
      objectId: `${input.tenantId}:${input.clerkUserId}`,
      outcome: 'success',
      metadata: { from: current.role, to: desired, via: 'professional_login' },
    })
    return desired
  })
}

/**
 * Liga a ficha a um **membro activo** da Equipe (DEC-204 revista 19/11/2026).
 * Não envia convite: a pessoa já entrou pelo convite da Equipe.
 */
export async function linkProfessionalLogin(
  db: AdminDb,
  clock: Clock,
  _emailTransport: EmailTransport,
  _appBaseUrl: string,
  input: {
    tenantId: string
    resourceId: string
    email: string
    alsoAttendant: boolean
    actorClerkUserId: string
    boundClerkUserId?: string | null
  },
): Promise<{
  login: ProfessionalLoginRow
  invitationSent: boolean
  membershipRole: MembershipRole | null
}> {
  requireActiveOwner(db, input.tenantId, input.actorClerkUserId)
  const email = normalizeEmail(input.email)
  if (!email.includes('@')) {
    throw new ConflictError('email_invalid', 'E-mail inválido')
  }
  const bound = input.boundClerkUserId?.trim() || null
  if (!bound) {
    throw new ConflictError(
      'membership_required',
      'Convide a pessoa na Equipe antes de ligar a ficha',
    )
  }
  const membership = getMembership(db, input.tenantId, bound)
  if (!membership || membership.status !== 'active') {
    throw new ConflictError(
      'membership_required',
      'Convide a pessoa na Equipe antes de ligar a ficha',
    )
  }
  const other = db.get<{ resource_id: string }>(
    `SELECT resource_id FROM professional_logins
     WHERE tenant_id = ? AND normalized_email = ? AND resource_id <> ?`,
    input.tenantId,
    email,
    input.resourceId,
  )
  if (other) {
    throw new ConflictError(
      'professional_email_taken',
      'Este e-mail já está ligado a outra profissional',
    )
  }
  const otherUser = db.get<{ resource_id: string }>(
    `SELECT resource_id FROM professional_logins
     WHERE tenant_id = ? AND clerk_user_id = ? AND resource_id <> ?`,
    input.tenantId,
    bound,
    input.resourceId,
  )
  if (otherUser) {
    throw new ConflictError(
      'professional_user_taken',
      'Esta pessoa já está ligada a outra ficha de profissional',
    )
  }

  const previous = getProfessionalLogin(db, input.tenantId, input.resourceId)
  if (previous?.clerkUserId && previous.clerkUserId !== bound) {
    revokeOrphanedLoginMembership(db, clock, {
      tenantId: input.tenantId,
      resourceId: input.resourceId,
      clerkUserId: previous.clerkUserId,
      alsoAttendant: previous.alsoAttendant,
      actorClerkUserId: input.actorClerkUserId,
    })
  }

  db.run(
    `INSERT INTO professional_logins (
       tenant_id, resource_id, normalized_email, clerk_user_id, also_attendant
     ) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (tenant_id, resource_id) DO UPDATE SET
       normalized_email = excluded.normalized_email,
       clerk_user_id = excluded.clerk_user_id,
       also_attendant = excluded.also_attendant`,
    input.tenantId,
    input.resourceId,
    email,
    bound,
    input.alsoAttendant ? 1 : 0,
  )

  const membershipRole = alignMembership(db, clock, {
    tenantId: input.tenantId,
    clerkUserId: bound,
    alsoAttendant: input.alsoAttendant,
    actorClerkUserId: input.actorClerkUserId,
  })

  return {
    login: getProfessionalLogin(db, input.tenantId, input.resourceId)!,
    invitationSent: false,
    membershipRole,
  }
}

/**
 * Desativar/apagar a ficha: apaga o vínculo em `professional_logins` (e-mail
 * fica livre) e revoga membership só quando o papel é `professional` (REQ-118).
 */
export function releaseProfessionalLogin(
  db: AdminDb,
  clock: Clock,
  input: { tenantId: string; resourceId: string; actorClerkUserId: string },
): { revoked: boolean } {
  requireActiveOwner(db, input.tenantId, input.actorClerkUserId)
  const row = getProfessionalLogin(db, input.tenantId, input.resourceId)
  if (!row) return { revoked: false }
  let revoked = false
  if (row.clerkUserId) {
    const membership = getMembership(db, input.tenantId, row.clerkUserId)
    if (membership?.status === 'active' && membership.role === 'professional') {
      revokeMembership(db, clock, {
        tenantId: input.tenantId,
        clerkUserId: row.clerkUserId,
        actorClerkUserId: input.actorClerkUserId,
      })
      revoked = true
    }
  }
  db.run(
    `DELETE FROM professional_logins WHERE tenant_id = ? AND resource_id = ?`,
    input.tenantId,
    input.resourceId,
  )
  return { revoked }
}
