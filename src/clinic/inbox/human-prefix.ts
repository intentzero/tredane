/**
 * DEC-088 — prefixo `[Nome]` em outbound de texto livre humano.
 * Não aplica a templates, interactivos, IA nem actors `system:*`.
 */

const SYSTEM_AUTHOR_PREFIX = 'system:'

export function isHumanStaffAuthor(authorClerkUserId: string | null | undefined): boolean {
  if (!authorClerkUserId?.trim()) return false
  return !authorClerkUserId.startsWith(SYSTEM_AUTHOR_PREFIX)
}

/**
 * Precede o corpo com `[Nome] ` uma vez. Idempotente se o prefixo já existir.
 */
export function applyHumanOutboundPrefix(
  body: string,
  authorDisplayName: string | null | undefined,
): string {
  const name = (authorDisplayName ?? '').trim()
  if (!name) return body
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
  authorDisplayName: string | null | undefined
}): boolean {
  if (input.kind !== 'text') return false
  if (!isHumanStaffAuthor(input.authorClerkUserId)) return false
  return Boolean((input.authorDisplayName ?? '').trim())
}
