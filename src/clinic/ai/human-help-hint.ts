/**
 * DEC-153 — dica one-shot na 1.ª oferta de horários da sessão de booking:
 * «Se preferir falar com a equipe, escreva falar com a equipe ou use o botão quando aparecer.»
 *
 * Gatilho: resposta automática com lista Horários (slots reais) + flag ainda 0.
 * Não dispara handoff por si; o botão na proposta (DEC-083) mantém-se.
 * Ofertas seguintes na mesma sessão não repetem (schedule_sessions.human_help_hint_sent).
 *
 * A oferta WhatsApp de slots é lista (CTA «Horários»), não botões Manhã|Tarde|Outro dia
 * — esses T1 já ocupam o orçamento de 3 reply buttons; neste passo só a dica textual.
 */
import type { ClinicDb } from '../store'
import { SLOT_LIST_BUTTON_LABEL, type ChoiceInteractive } from './choice-offer'
import { sayAct } from './dialogue-acts'
import { WANTS_HUMAN_RE } from './nlu/sensitive'

/** Fallback Confirmado (Paulo, 09/11/2026, opção 3 / DEC-153 / DEC-104) — acto `orientar_ajuda_humana`. */
export const HUMAN_HELP_HINT_TEXT =
  'Se preferir falar com a equipe, escreva falar com a equipe ou use o botão quando aparecer.'

/**
 * Frase ensinada pela dica que deve continuar a casar com WANTS_HUMAN_RE (DEC-083).
 * Paridade copy↔regex no mesmo módulo.
 */
export const HUMAN_HELP_TAUGHT_PHRASE = 'falar com a equipe'

export function botTaughtHumanHelpPhraseMatchesHandoff(): boolean {
  return WANTS_HUMAN_RE.test(HUMAN_HELP_TAUGHT_PHRASE)
}

export function wasHumanHelpHintSent(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
): boolean {
  const row = db.get<{ sent: number }>(
    `SELECT human_help_hint_sent AS sent FROM schedule_sessions
     WHERE tenant_id = ? AND conversation_id = ?`,
    tenantId,
    conversationId,
  )
  return row?.sent === 1
}

export function markHumanHelpHintSent(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
): void {
  db.run(
    `UPDATE schedule_sessions
     SET human_help_hint_sent = 1
     WHERE tenant_id = ? AND conversation_id = ?`,
    tenantId,
    conversationId,
  )
}

/** Junta a dica ao corpo (uma linha nova). Idempotente se já estiver lá. */
export function appendHumanHelpHint(body: string, conversationId = ''): string {
  const hint = sayAct(
    'orientar_ajuda_humana',
    conversationId,
    {},
    HUMAN_HELP_HINT_TEXT,
  )
  const trimmed = body.trimEnd()
  if (!trimmed) return hint
  if (trimmed.includes(hint) || trimmed.includes(HUMAN_HELP_HINT_TEXT)) return trimmed
  return `${trimmed}\n\n${hint}`
}

/** Oferta de slots com lista Horários (não botões de período T1). */
export function isSlotListOfferInteractive(
  interactive: ChoiceInteractive | null | undefined,
): boolean {
  return interactive?.mode === 'list' && interactive.button === SLOT_LIST_BUTTON_LABEL
}

export function shouldAppendHumanHelpHint(input: {
  replyText: string | undefined
  interactive?: ChoiceInteractive | null
  proposalId?: string
  alreadySent: boolean
  /** DEC-155: fora do expediente não oferece a dica. Default true (compat testes). */
  teamOfferAllowed?: boolean
}): boolean {
  const body = input.replyText?.trim()
  if (!body) return false
  if (input.proposalId) return false
  if (input.alreadySent) return false
  if (input.teamOfferAllowed === false) return false
  if (!isSlotListOfferInteractive(input.interactive)) return false
  if (body.includes(HUMAN_HELP_HINT_TEXT)) return false
  if (body.includes(HUMAN_HELP_TAUGHT_PHRASE) && /escreva falar com a equipe/i.test(body)) {
    return false
  }
  return true
}
