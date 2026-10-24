import type { MembershipRole } from '../db/schema'
import type { Permission } from './types'

/**
 * Matriz de permissões do MVP (#21 / actors-permissions).
 * Deny-by-default: só entradas explícitas concedem.
 * Superadmin de plataforma NÃO herda capacidades clínicas (ADR-0006).
 */
const OWNER_PERMISSIONS: ReadonlySet<Permission> = new Set([
  'clinic.context.read',
  'clinic.inbox.read',
  'clinic.inbox.reply',
  'clinic.pipeline.move',
  'clinic.agenda.operate',
  'clinic.config.write',
  'clinic.members.invite_attendant',
  'clinic.members.revoke_attendant',
  'clinic.support.decide',
])

const ATTENDANT_PERMISSIONS: ReadonlySet<Permission> = new Set([
  'clinic.context.read',
  'clinic.inbox.read',
  'clinic.inbox.reply',
  'clinic.pipeline.move',
  'clinic.agenda.operate',
])

const PLATFORM_SUPERADMIN_PERMISSIONS: ReadonlySet<Permission> = new Set([
  'platform.tenants.read',
  'platform.tenants.write',
  'platform.owners.manage',
])

export function permissionsForClinicRole(role: MembershipRole): ReadonlySet<Permission> {
  return role === 'owner' ? OWNER_PERMISSIONS : ATTENDANT_PERMISSIONS
}

export function permissionsForPlatformSuperadmin(): ReadonlySet<Permission> {
  return PLATFORM_SUPERADMIN_PERMISSIONS
}

export function roleAllows(role: MembershipRole, permission: Permission): boolean {
  return permissionsForClinicRole(role).has(permission)
}

export function platformAllows(isSuperadmin: boolean, permission: Permission): boolean {
  return isSuperadmin && PLATFORM_SUPERADMIN_PERMISSIONS.has(permission)
}

/** Todas as permissões conhecidas — usado pela matriz automatizada de testes. */
export const ALL_PERMISSIONS: readonly Permission[] = [
  'clinic.context.read',
  'clinic.inbox.read',
  'clinic.inbox.reply',
  'clinic.pipeline.move',
  'clinic.agenda.operate',
  'clinic.config.write',
  'clinic.members.invite_attendant',
  'clinic.members.revoke_attendant',
  'clinic.support.decide',
  'platform.tenants.read',
  'platform.tenants.write',
  'platform.owners.manage',
]
