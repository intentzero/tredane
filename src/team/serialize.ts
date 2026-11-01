import type { InvitationRow } from '../db/admin/invitations'
import type { MembershipRow } from '../db/admin/memberships'
import {
  INVITATION_RESEND_COOLDOWN_MS,
  INVITATION_RESEND_MAX,
  INVITATION_RESEND_WINDOW_MS,
} from '../db/admin/constants'

/** Membro na visão Equipe — ações conforme DEC-103. */
export function serializeTeamMember(
  member: MembershipRow,
  opts: {
    callerIsOwner: boolean
    activeOwnerCount: number
    /** DEC-102: nome e e-mail resolvidos no Worker (Clerk / sintético). */
    displayName?: string | null
    email?: string | null
  },
) {
  const isOwner = member.role === 'owner'
  const isActive = member.status === 'active'
  const canTouchOwners = opts.callerIsOwner && opts.activeOwnerCount > 1
  const canRevoke =
    opts.callerIsOwner
    && isActive
    && (member.role === 'attendant' || (isOwner && canTouchOwners))
  const canPromote =
    opts.callerIsOwner && isActive && member.role === 'attendant'
  const canDemote =
    opts.callerIsOwner && isActive && isOwner && canTouchOwners

  return {
    clerkUserId: member.clerkUserId,
    /** Nome de apresentação — nunca o id como rótulo principal na UI. */
    displayName: opts.displayName ?? null,
    email: opts.email ?? null,
    role: member.role,
    status: member.status,
    createdAt: member.createdAt,
    revokedAt: member.revokedAt,
    manageActions: {
      canRevoke,
      canInvite: false,
      canPromote,
      canDemote,
    },
  }
}

export function serializeInvitation(
  invitation: InvitationRow,
  opts: {
    nowMs: number
    resendCountInWindow?: number
    callerIsOwner: boolean
  },
) {
  const cooldownRemainingMs =
    invitation.lastResentAt !== null
      ? Math.max(0, INVITATION_RESEND_COOLDOWN_MS - (opts.nowMs - invitation.lastResentAt))
      : 0
  const resendsUsed = opts.resendCountInWindow ?? 0
  const resendsRemaining = Math.max(0, INVITATION_RESEND_MAX - resendsUsed)
  return {
    id: invitation.id,
    tenantId: invitation.tenantId,
    email: invitation.normalizedEmail,
    role: invitation.role,
    status: invitation.status,
    issuedAt: invitation.issuedAt,
    expiresAt: invitation.expiresAt,
    issuedByClerkUserId: invitation.issuedByClerkUserId,
    lastResentAt: invitation.lastResentAt,
    acceptedAt: invitation.acceptedAt,
    cancelledAt: invitation.cancelledAt,
    /** Nunca incluir token. */
    manageActions: opts.callerIsOwner && invitation.status === 'pending'
      ? {
          canResend: cooldownRemainingMs === 0 && resendsRemaining > 0,
          canCancel: true,
        }
      : { canResend: false, canCancel: false },
    resend: {
      cooldownMs: INVITATION_RESEND_COOLDOWN_MS,
      cooldownRemainingMs,
      windowMs: INVITATION_RESEND_WINDOW_MS,
      maxPerWindow: INVITATION_RESEND_MAX,
      usedInWindow: resendsUsed,
      remainingInWindow: resendsRemaining,
    },
  }
}

export function conflictRetryHints(code: string, nowMs: number, invitation?: InvitationRow) {
  if (code === 'invitation_resend_cooldown' && invitation?.lastResentAt != null) {
    return {
      retryAfterMs: Math.max(
        0,
        INVITATION_RESEND_COOLDOWN_MS - (nowMs - invitation.lastResentAt),
      ),
      cooldownMs: INVITATION_RESEND_COOLDOWN_MS,
    }
  }
  if (code === 'invitation_resend_quota') {
    return {
      windowMs: INVITATION_RESEND_WINDOW_MS,
      maxPerWindow: INVITATION_RESEND_MAX,
    }
  }
  return {}
}
