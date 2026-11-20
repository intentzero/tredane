/**
 * Pergunta «atendem no domingo?» / «você atende segunda?» / «abrem amanhã?» —
 * expediente, não marcação.
 * rsamp_1241995755: «atende» no singular não casava em HOURS (só «atendem»).
 *
 * Casa sobre texto sem acentos: `\b` do JS não trata «ã» como letra, e
 * «amanhã?» falhava o fecho da palavra.
 */
const WEEKDAY = 'domingo|segunda|terca|quarta|quinta|sexta|sabado'

const RELATIVE_DAY = 'hoje|amanha|depois\\s+de\\s+amanha'

/** Inclui gerúndio («está atendendo hoje?») e «aberto/a» — sem isso cai no LLM com só o expediente. */
const OPEN_VERB = 'atend(?:e|em|endo)|abre(?:m)?|abert[oa]s?|funciona(?:m|ndo)?'

/** Dia (semana ou relativo) + verbo de funcionamento (ordem flexível, até ~60 chars). */
export const OPENING_DAY_ASK_RE = new RegExp(
  String.raw`\b(?:${OPEN_VERB})\b[\s\S]{0,60}\b(?:${WEEKDAY}|${RELATIVE_DAY})\b` +
    String.raw`|\b(?:${WEEKDAY}|${RELATIVE_DAY})\b[\s\S]{0,60}\b(?:${OPEN_VERB})\b`,
  'i',
)

function foldPt(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

export function isOpeningDayAsk(text: string): boolean {
  const body = text.trim()
  if (!body) return false
  return OPENING_DAY_ASK_RE.test(foldPt(body))
}
