/**
 * Duração pedida em linguagem natural («meia hora», «30 min», «o de uma hora», «2h»).
 * Serve para escolher entre variantes com o mesmo nome e durações diferentes.
 *
 * Uma hora do relógio nunca é duração: «às 10h», «sexta 16h», «15:30», «10h30» e «uma hora»
 * no sentido de «marcar uma hora» (consulta) ficam de fora. Antes havia duas cópias desta
 * lógica (zonas e resolvedor do objeto de marcação) que liam «às 10h» como 10 horas e
 * descartavam todas as variantes (CF-24, #435).
 */

function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** «às 10h», «até 15:30», «das 9h30», «pelas 14h» — hora do relógio com unidade. */
const CLOCK_WITH_UNIT =
  /\b(?:as|a|ate|das|pelas|por volta das)\s+\d{1,2}(?:\s*:\s*\d{2}|\s*h(?:oras?)?(?:\s*\d{2})?)\b/g
/** «às 10» sem unidade (mas não «às 30 min»). */
const CLOCK_BARE = /\b(?:as|das|pelas)\s+\d{1,2}\b(?!\s*(?:min|h|:|horas?))/g
/** «15:30», «10h30». */
const CLOCK_EXACT = /\b\d{1,2}\s*(?::\s*\d{2}|h\s*\d{2})\b/g

/** «de uma hora», «com 1 hora», «uma hora de duração»: só assim «uma hora» é duração. */
const ONE_HOUR_CUE =
  /\b(?:de|com|dura(?:cao|ndo)?|sessao de|aproximadamente|cerca de)\s+(?:uma|1)\s*h(?:ora)?\b|\b(?:uma|1)\s*hora\s+de\s+(?:duracao|sessao|atendimento)\b/

export function durationMinutesFromText(text: string): number | null {
  const t = fold(text).replace(CLOCK_WITH_UNIT, ' ').replace(CLOCK_BARE, ' ').replace(CLOCK_EXACT, ' ')
  // «uma hora e meia» antes de «uma hora» (antes, o 60 escondia o 90).
  if (/\b(?:uma|1)\s+hora\s+e\s+meia\b/.test(t) || /\b90\s*min(?:utos?)?\b/.test(t)) return 90
  if (/\bmeia\s+hora\b/.test(t) || /\b30\s*min(?:utos?)?\b/.test(t)) return 30
  if (ONE_HOUR_CUE.test(t) || /\b60\s*min(?:utos?)?\b/.test(t)) return 60
  if (/\b(?:duas|2)\s*h(?:oras?)?\b/.test(t) || /\b120\s*min(?:utos?)?\b/.test(t)) return 120
  const min = t.match(/\b(\d{1,3})\s*min(?:utos?)?\b/)
  if (min) {
    const n = Number(min[1])
    return Number.isInteger(n) && n > 0 ? n : null
  }
  // «1h» a «4h» soltos: uma sessão de estética não dura mais; acima disso é hora do relógio.
  const hours = t.match(/\b([1-4])\s*h(?:oras?)?\b/)
  if (hours) return Number(hours[1]) * 60
  return null
}
