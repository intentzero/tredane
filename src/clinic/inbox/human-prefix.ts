/**
 * DEC-088 — prefixo `[Nome]` no texto livre enviado à cliente no WhatsApp.
 * Não altera o body persistido/API do painel. Não aplica a templates,
 * interactivos, IA nem actors `system:*`.
 *
 * O nome é o da **pessoa** (apresentação / primeiro nome), nunca o rótulo
 * do papel («Responsável», «Atendente», …). Sem nome útil → «Equipe».
 */

const SYSTEM_AUTHOR_PREFIX = 'system:'

/** Fallback DEC-088 quando não há nome humano utilizável. */
export const HUMAN_OUTBOUND_FALLBACK_NAME = 'Equipe'

/**
 * Rótulos de papel / cargo — nunca entram sozinhos entre `[…]` no WhatsApp.
 * Comparação sem acentos e em minúsculas.
 */
const ROLE_ONLY_LABELS = new Set([
  'responsavel',
  'responsável',
  'atendente',
  'owner',
  'attendant',
  'admin',
  'administrator',
  'administrador',
  'administradora',
])

/** Personas sintéticas (seed / AUTH_MODE=synthetic) → primeiro nome. */
export const SYNTH_STAFF_FIRST_NAMES: Readonly<Record<string, string>> = {
  user_synth_owner_a: 'Bruno',
  user_synth_owner_a2: 'Bruno',
  user_synth_attendant_a: 'Carla',
  user_synth_multi: 'Renata',
  user_synth_owner_b: 'Diego',
}

function foldKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
}

export function isHumanStaffAuthor(authorClerkUserId: string | null | undefined): boolean {
  if (!authorClerkUserId?.trim()) return false
  return !authorClerkUserId.startsWith(SYSTEM_AUTHOR_PREFIX)
}

/** True se o valor é só um rótulo de papel (ex.: «Responsável»). */
export function isRoleOnlyDisplayName(name: string | null | undefined): boolean {
  const raw = (name ?? '').trim()
  if (!raw) return false
  const key = foldKey(raw)
  if (ROLE_ONLY_LABELS.has(key)) return true
  // Também rejeita a forma dobrada se o Set tiver a versão com acento.
  return [...ROLE_ONLY_LABELS].some((label) => foldKey(label) === key)
}

/** Primeiro token do nome de apresentação (ex.: «Maria Silva» → «Maria»). */
export function firstNameFromStaffDisplayName(name: string | null | undefined): string | null {
  const part = (name ?? '').trim().split(/\s+/)[0]
  return part && part.length > 0 ? part : null
}

/**
 * Escolhe o nome humano para o prefixo WhatsApp.
 * Ordem: candidatos (body, Clerk, membership, …); ignora vazios e papéis;
 * usa o primeiro token; senão «Equipe».
 */
export function resolveHumanOutboundDisplayName(
  ...candidates: Array<string | null | undefined>
): string {
  for (const candidate of candidates) {
    if (isRoleOnlyDisplayName(candidate)) continue
    const first = firstNameFromStaffDisplayName(candidate)
    if (!first) continue
    if (isRoleOnlyDisplayName(first)) continue
    return first
  }
  return HUMAN_OUTBOUND_FALLBACK_NAME
}

/**
 * Precede o corpo com `[Nome] ` uma vez. Idempotente se o prefixo já existir.
 * Papéis sozinhos são substituídos por «Equipe».
 */
export function applyHumanOutboundPrefix(
  body: string,
  authorDisplayName: string | null | undefined,
): string {
  const name = resolveHumanOutboundDisplayName(authorDisplayName)
  const prefix = `[${name}]`
  const trimmed = body.trimStart()
  if (trimmed.startsWith(`${prefix} `) || trimmed === prefix || trimmed.startsWith(`${prefix}\n`)) {
    return body
  }
  return `${prefix} ${body}`
}

export function shouldPrefixHumanOutbound(input: {
  kind: 'text' | 'template' | 'interactive'
  authorClerkUserId: string | null | undefined
  authorDisplayName?: string | null | undefined
}): boolean {
  if (input.kind !== 'text') return false
  if (!isHumanStaffAuthor(input.authorClerkUserId)) return false
  // Sempre há nome utilizável (Equipe no mínimo) para humano em texto livre.
  return true
}
