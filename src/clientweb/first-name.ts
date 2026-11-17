/**
 * Primeiro nome para saudar na página. O `display_name` vem do perfil do WhatsApp
 * e é texto livre: remove marcação e caracteres de controlo, usa só o primeiro nome,
 * com tamanho limitado. Um telefone (nome sem nenhuma letra) não é nome.
 * A página nunca mostra o telefone.
 */
export function clientWebFirstName(displayName: string | null | undefined): string | null {
  if (!displayName) return null
  const cleaned = displayName
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\p{Cc}<>]/gu, ' ')
    .trim()
  if (!/\p{L}/u.test(cleaned)) return null
  const first = cleaned.split(/\s+/)[0] ?? ''
  return first ? first.slice(0, 40) : null
}
