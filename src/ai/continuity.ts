/**
 * Continuidade conversacional dos rascunhos (Paulo, 29/10/2026).
 *
 * Critério simples Confirmado: se já houve mensagem outbound da clínica
 * nesta conversa (no histórico enviado ao modelo), o rascunho não recomeça
 * com cumprimento («Oi», «Olá», «Oi, {nome}!», etc.).
 */
import type { AiContextMessage } from './types'

/** Conta mensagens já enviadas pela clínica (direction = outbound). */
export function countClinicOutbound(messages: AiContextMessage[]): number {
  return messages.reduce((n, m) => (m.direction === 'outbound' ? n + 1 : n), 0)
}

/** Já houve mensagem outbound da clínica nesta conversa. */
export function hasClinicOutbound(messages: AiContextMessage[]): boolean {
  return countClinicOutbound(messages) > 0
}

/**
 * Cumprimentos típicos de abertura em pt-BR (início do texto).
 * Cobre «Oi», «Olá», «Oi, Paulo!», «Bom dia, Ana 😊», etc.
 * Nome opcional: após vírgula, ou token capitalizado («Oi Paulo»).
 */
const LEADING_GREETING_RE =
  /^\s*(?:oi|ol[aá]|opa|e\s*a[ií]|ei|bom\s+dia|boa\s+tarde|boa\s+noite)(?:\s*,\s*[A-Za-zÀ-ú][\wÀ-ú'-]*|\s+[A-ZÀ-Ú][\wÀ-ú'-]*)?(?:\s*[!.…])?(?:\s*\p{Extended_Pictographic}+)?\s*/iu

/** True se o texto começa com cumprimento de abertura. */
export function startsWithGreeting(text: string): boolean {
  return LEADING_GREETING_RE.test(text)
}

/**
 * Remove cumprimento(s) de abertura no início do rascunho.
 * Só usar quando `hasClinicOutbound` — no primeiro contacto da clínica o cumprimento fica.
 * Não inventa texto; se sobrar vazio, devolve o original.
 */
export function stripLeadingGreeting(text: string): string {
  let out = text.replace(/^\uFEFF/, '')
  let changed = false
  // Uma passagem basta: o regex já engole nome, pontuação e emoji de abertura.
  const m = LEADING_GREETING_RE.exec(out)
  if (m) {
    const next = out.slice(m[0].length).replace(/^\s*\n+/, '')
    if (next.trim()) {
      out = next
      changed = true
    }
  }
  if (!changed) return text
  // Capitaliza a primeira letra útil após o corte
  const trimmed = out.replace(/^\s+/, '')
  if (!trimmed) return text
  const first = trimmed.charAt(0)
  const rest = trimmed.slice(1)
  const capped =
    /[a-zà-ú]/i.test(first) && first === first.toLowerCase()
      ? first.toLocaleUpperCase('pt-BR') + rest
      : trimmed
  return capped
}

/**
 * Aplica a regra de continuidade: com outbound já enviado, corta re-cumprimento.
 */
export function applyDraftContinuity(
  message: string,
  messages: AiContextMessage[],
): string {
  if (!hasClinicOutbound(messages)) return message
  if (!startsWithGreeting(message)) return message
  return stripLeadingGreeting(message)
}
