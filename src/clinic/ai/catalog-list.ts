/**
 * Lista de serviços como informação (DEC-142, DEC-202).
 * Frase determinística do backend (DEC-104): o modelo não escreve a lista. Não marca nada e não
 * guarda estado; antes abria uma lista interativa e prendia a conversa num funil.
 */
import {
  explicitAudienceLine,
  filterServicesForLine,
  type ServiceAudience,
} from '../catalog/audience'
import type { ServiceRow } from '../config/types'

/** Texto de escolha de serviço usado na clarificação do catálogo. */
export const SERVICE_PICK_BODY = 'Qual serviço você quer?'
/** A partir deste número de serviços a prosa já não cabe numa mensagem curta. */
export const SERVICE_PICK_LIST_MIN = 4

export type CatalogAudience = 'feminino' | 'masculino'

const SWITCH_FEM = /\b(?:servicos?|ver)\s+(?:o\s+|os\s+|a\s+|as\s+)?feminin|\bfemininos\b/
const SWITCH_MASC = /\b(?:servicos?|ver)\s+(?:o\s+|os\s+|a\s+|as\s+)?masculin|\bmasculinos\b/

const CATALOG_ASK: readonly RegExp[] = [
  /\bquais\s+(?:sao\s+)?(?:os\s+)?(?:servicos|procedimentos|tratamentos)\b/,
  /\bque\s+(?:servicos|procedimentos|tratamentos)\b/,
  /\b(?:lista|listar|mostra|mostrar)\s+(?:os\s+|me\s+os\s+|me\s+)?(?:servicos|procedimentos|tratamentos)\b/,
  /\bver\s+(?:os\s+)?(?:servicos|procedimentos|tratamentos)\b/,
  /\b(?:servicos|procedimentos|tratamentos)\s+(?:que\s+)?(?:voce|voces)\s+(?:tem|oferece|oferecem|faz|fazem)\b/,
  /\bo que (?:voce|voces) (?:tem|oferece|oferecem)\b/,
  /\bquais\s+(?:os\s+)?servicos\s+oferecem?\b/,
]

function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/** `ask` (sem audiência) ou `switch` (com audiência explícita); `null` se não é consulta. */
export function catalogListIntent(
  text: string,
): { kind: 'ask' } | { kind: 'switch'; line: CatalogAudience } | null {
  const folded = fold(text)
  if (!folded.trim()) return null
  const fem = SWITCH_FEM.test(folded)
  const masc = SWITCH_MASC.test(folded)
  if (fem && masc) return { kind: 'ask' }
  if (fem) return { kind: 'switch', line: 'feminino' }
  if (masc) return { kind: 'switch', line: 'masculino' }
  if (CATALOG_ASK.some((re) => re.test(folded))) return { kind: 'ask' }
  return null
}

function activeNames(services: readonly ServiceRow[], line: CatalogAudience | null): string[] {
  const active = services.filter((service) => service.active)
  const pool = line
    ? filterServicesForLine(active as Array<ServiceRow & { audiencia: ServiceAudience }>, line)
    : active
  return pool.map((service) => service.name.trim()).filter((name) => name.length > 0)
}

/** Texto da lista, ou `null` se o texto não é consulta de catálogo. */
export function catalogListReply(text: string, services: readonly ServiceRow[]): string | null {
  const intent = catalogListIntent(text)
  if (!intent) return null
  const line: CatalogAudience | null =
    intent.kind === 'switch' ? intent.line : (explicitAudienceLine(text) as CatalogAudience | null)
  const names = activeNames(services, line)
  if (names.length === 0) {
    if (line) return `Não tenho serviços no ${line}.`
    return 'Ainda não tenho serviços cadastrados; a equipe confirma.'
  }
  return `Temos:\n${names.join('\n')}\nPara agendar, é só pedir aqui.`
}
