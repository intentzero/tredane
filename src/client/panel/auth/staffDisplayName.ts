/**
 * Nome de apresentação do membro da equipa para DEC-088 (`[Nome]` no WhatsApp).
 * Nunca devolver o rótulo do papel (Responsável / Atendente).
 */
import { SYNTH_PERSONAS } from './session'

const ROLE_ONLY = new Set([
  'responsavel',
  'responsável',
  'atendente',
  'owner',
  'attendant',
])

function fold(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
}

function firstToken(name: string | null | undefined): string | null {
  const part = (name ?? '').trim().split(/\s+/)[0]
  return part && part.length > 0 ? part : null
}

function isRoleOnly(name: string | null | undefined): boolean {
  const raw = (name ?? '').trim()
  if (!raw) return false
  const key = fold(raw)
  return ROLE_ONLY.has(key) || [...ROLE_ONLY].some((r) => fold(r) === key)
}

/** Primeiro nome a partir do label da persona sintética («Bruno (responsável Aurora)»). */
export function synthStaffFirstName(clerkUserId: string | null | undefined): string | null {
  if (!clerkUserId) return null
  const persona = SYNTH_PERSONAS.find((p) => p.clerkUserId === clerkUserId)
  const first = firstToken(persona?.label)
  if (!first || isRoleOnly(first)) return null
  return first
}

/** Normaliza um nome Clerk / membership para o prefixo WhatsApp. */
export function staffFirstNameFromDisplay(
  ...candidates: Array<string | null | undefined>
): string | null {
  for (const c of candidates) {
    if (isRoleOnly(c)) continue
    const first = firstToken(c)
    if (!first || isRoleOnly(first)) continue
    return first
  }
  return null
}
