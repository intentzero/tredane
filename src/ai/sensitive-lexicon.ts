/**
 * Léxico partilhado de temas sensíveis (#409 / CF-18).
 * Usado por `rules.ts` (avisos) e `clinic/ai/nlu/sensitive.ts` (pausa).
 */

/** Saúde / clínica — união antiga HEALTH ∪ CLINICAL_RE. */
export const HEALTH_RE =
  /\b(gr[aá]vid|gestante|contraindica|\bd[oó]i\b|medicamento|rem[eé]dio|diagn[oó]stico|doen[cç]a|alergia|press[aã]o\s+alta|diabetes|posso\s+fazer\s+.*gr[aá]vid)/i

/** Ofensa — união handoff ∪ rules. */
export const OFFENSE_RE =
  /\b(idiota|estup[ií]d|merda|porra|vsf|fdp|filho\s+da\s+puta|vai\s+se\s+foder|ot[aá]ri[oa]|vagabund)\b/i
