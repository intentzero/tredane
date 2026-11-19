/** Rascunho ao abrir a ficha a partir do convite da Equipe (DEC-204). */
const KEY = 'tredane.professional-invite-draft'

export type ProfessionalInviteDraft = {
  email: string
  alsoAttendant: boolean
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
    return { email: parsed.email.trim(), alsoAttendant: parsed.alsoAttendant === true }
  } catch {
    return null
  }
}
