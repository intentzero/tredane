import type { InvitationRow } from '../db/admin/invitations'
import type { MembershipRow } from '../db/admin/memberships'
import {
  INVITATION_RESEND_COOLDOWN_MS,
  INVITATION_RESEND_MAX,
  INVITATION_RESEND_WINDOW_MS,
} from '../db/admin/constants'

/** Membro na visão Equipe — owners sem ações de gestão pela clínica. */
export function serializeTeamMember(
  member: MembershipRow,
  opts: { callerIsOwner: boolean },
) {
  const isOwner = member.role === 'owner'
  const canRevoke =
    opts.callerIsOwner && member.role === 'attendant' && member.status === 'active'
  return {
    clerkUserId: member.clerkUserId,
    role: member.role,
    status: member.status,
    createdAt: member.createdAt,
    revokedAt: member.revokedAt,
    /** Owners listados sem ações de gestão (só superadmin gere owners). */
    manageActions: isOwner
      ? { canRevoke: false, canInvite: false }
      : { canRevoke, canInvite: false },
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
