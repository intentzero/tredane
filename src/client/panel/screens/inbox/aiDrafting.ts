/**
 * Estado do rascunho automático na lista (WS `conversation.ai_draft`).
 * Confirmado (Paulo, 31/10/2026): spinner enquanto a IA prepara sugestão.
 */

/** Estados em que a row mostra o spinner. */
export const AI_DRAFTING_ACTIVE = new Set(['queued', 'generating'])

/** Outcomes que desligam o spinner (job já apagado no DO). */
export const AI_DRAFTING_TERMINAL = new Set([
  'ready',
  'failed',
  'skipped',
  'superseded',
  'cap_reached',
  'cancelled',
])

/** `true` = ligar spinner; `false` = desligar; `null` = ignorar. */
export function draftingFlagFromAiDraftState(state: unknown): boolean | null {
  if (typeof state !== 'string') return null
  if (AI_DRAFTING_ACTIVE.has(state)) return true
  if (AI_DRAFTING_TERMINAL.has(state)) return false
  return null
}

export const AI_DRAFTING_SR_LABEL = 'IA a preparar sugestão'
