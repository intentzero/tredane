/**
 * DEC-210 (revisão): detecção determinística de conflito entre regras gerais (B)
 * e o domínio do Recebimento do sinal (A) — prazos de cancelar/remarcar, dinheiro,
 * crédito e devolução. Usada no painel (U1) e ao gravar no servidor.
 *
 * Não altera a junção enviada à cliente: B legado conflituoso continua a sair
 * até a owner editar (Q3).
 */

export type PolicyConflictKind =
  | 'lead_time'
  | 'money'
  | 'credit'
  | 'refund'

export type PolicyConflictHit = {
  kind: PolicyConflictKind
  /** Motivo curto para a owner (português). */
  reason: string
}

export type PolicyConflictResult = {
  conflicts: PolicyConflictHit[]
  /** true quando há pelo menos um conflito que bloqueia gravar com o sinal ligado. */
  blocksSave: boolean
  /** Aviso leve com o sinal desligado (Pix/crédito em B); não bloqueia. */
  softWarns: PolicyConflictHit[]
}

const MONEY_RE =
  /\b(sinal|pix|r\$|%\s*(?:do|da|de)?|percent(?:agem)?|multa)\b/i
const CREDIT_RE = /\bcr[eé]dito\b/i
const REFUND_RE =
  /\b(devolv|estorno|n[aã]o\s+se\s+devolve|fica\s+com\s+a\s+cl[ií]nica|reten(?:c|ç)[aã]o)\b/i

/**
 * Prazo de cancelar/remarcar: «avise com 24 h», «até 12 horas antes»,
 * «24h de antecedência», «remarcar com 48 h», etc.
 */
const LEAD_TIME_RE =
  /(?:avis(?:e|ar)|anteced[eê]ncia|at[eé]|com|antes)\s*(?:com\s+)?(\d+)\s*(h|hs|hora|horas|min|mins|minuto|minutos)\b|\b(\d+)\s*(h|hs|hora|horas|min|mins|minuto|minutos)\s*(?:de\s+)?(?:anteced[eê]ncia|antes)\b|\b(\d+)\s*h(?:oras?)?\s+antes\b/i

const CANCEL_RESCHEDULE_CONTEXT_RE =
  /\b(cancel|desmarc|remarc|reagend|marcar|avis)\w*/i

function pushUnique(list: PolicyConflictHit[], hit: PolicyConflictHit): void {
  if (list.some((h) => h.kind === hit.kind)) return
  list.push(hit)
}

function detectMoneyDomain(text: string): PolicyConflictHit[] {
  const hits: PolicyConflictHit[] = []
  if (MONEY_RE.test(text)) {
    pushUnique(hits, {
      kind: 'money',
      reason: 'valor, sinal, Pix ou multa',
    })
  }
  if (CREDIT_RE.test(text)) {
    pushUnique(hits, {
      kind: 'credit',
      reason: 'crédito no próximo horário',
    })
  }
  if (REFUND_RE.test(text)) {
    pushUnique(hits, {
      kind: 'refund',
      reason: 'devolução ou retenção',
    })
  }
  return hits
}

function hasLeadTimeConflict(text: string): boolean {
  if (!LEAD_TIME_RE.test(text)) return false
  // Qualquer prazo numérico de aviso/antecedência no Assistente com sinal ligado
  // invade o domínio do Recebimento (Q1). Também apanha frases com cancelar/remarcar.
  if (CANCEL_RESCHEDULE_CONTEXT_RE.test(text)) return true
  // «24 h» sozinho junto de política geral ainda é lead-time de remarcação/cancelamento.
  return LEAD_TIME_RE.test(text)
}

/**
 * Analisa o texto B das regras gerais.
 * Com `signalOn`, conflitos bloqueiam gravar (U1).
 * Com sinal desligado, linguagem de Pix/crédito só gera aviso leve.
 */
export function analyzeGeneralPolicyConflict(
  generalPolicy: string,
  opts: { signalOn: boolean },
): PolicyConflictResult {
  const text = generalPolicy.trim()
  if (!text) {
    return { conflicts: [], blocksSave: false, softWarns: [] }
  }

  const moneyHits = detectMoneyDomain(text)
  const leadHit: PolicyConflictHit | null = hasLeadTimeConflict(text)
    ? {
        kind: 'lead_time',
        reason: 'prazo de cancelar ou remarcar',
      }
    : null

  if (opts.signalOn) {
    const conflicts = [...moneyHits]
    if (leadHit) pushUnique(conflicts, leadHit)
    return {
      conflicts,
      blocksSave: conflicts.length > 0,
      softWarns: [],
    }
  }

  // Sinal desligado: B pode ter aviso prévio; Pix/crédito só aviso (residual §10).
  return {
    conflicts: [],
    blocksSave: false,
    softWarns: moneyHits,
  }
}

/** Frase única para banner / erro de API. */
export function formatPolicyConflictMessage(result: PolicyConflictResult): string {
  const hits = result.blocksSave ? result.conflicts : result.softWarns
  if (hits.length === 0) return ''
  const parts = hits.map((h) => h.reason)
  const listed =
    parts.length === 1
      ? parts[0]!
      : `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]!}`
  if (result.blocksSave) {
    return `Este texto fala de ${listed}. A cliente já recebe isso pelo Recebimento do sinal. Apague ou reescreva só atraso e falta.`
  }
  return `Este texto fala de ${listed}, mas o sinal está desligado. Ligue o sinal em Recebimento ou tire essa linguagem daqui.`
}
