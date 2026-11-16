/**
 * Pergunta «atendem no domingo?» / «você atende segunda?» — expediente, não marcação.
 * rsamp_1241995755: «atende» no singular não casava em HOURS (só «atendem»).
 */
const WEEKDAY =
  'domingo|segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado'

/** Dia da semana + verbo de funcionamento (ordem flexível, até ~60 chars). */
export const OPENING_DAY_ASK_RE = new RegExp(
  String.raw`\b(?:atend(?:e|em)|abre|funciona(?:m)?)\b[\s\S]{0,60}\b(?:${WEEKDAY})\b` +
    String.raw`|\b(?:${WEEKDAY})\b[\s\S]{0,60}\b(?:atend(?:e|em)|abre|funciona(?:m)?)\b`,
  'i',
)

export function isOpeningDayAsk(text: string): boolean {
  const body = text.trim()
  if (!body) return false
  return OPENING_DAY_ASK_RE.test(body)
}