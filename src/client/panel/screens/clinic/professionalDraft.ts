/** Rascunho ao abrir a ficha a partir da Equipe (DEC-204 revista). */
const KEY = 'tredane.professional-invite-draft'

export type ProfessionalInviteDraft = {
  email: string
  alsoAttendant: boolean
  /** Membro activo da Equipe a ligar (obrigatório no fluxo actual). */
  clerkUserId?: string
}

export function writeProfessionalInviteDraft(draft: ProfessionalInviteDraft): void {
  sessionStorage.setItem(KEY, JSON.stringify(draft))
}

export function takeProfessionalInviteDraft(): ProfessionalInviteDraft | null {
  const raw = sessionStorage.getItem(KEY)
  if (!raw) return null
  sessionStorage.removeItem(KEY)
  try {
    const parsed = JSON.parse(raw) as Partial<ProfessionalInviteDraft>
    if (typeof parsed.email !== 'string' || !parsed.email.trim()) return null
    return {
      email: parsed.email.trim(),
      alsoAttendant: parsed.alsoAttendant === true,
      clerkUserId:
        typeof parsed.clerkUserId === 'string' && parsed.clerkUserId.trim()
          ? parsed.clerkUserId.trim()
          : undefined,
    }
  } catch {
    return null
  }
}
