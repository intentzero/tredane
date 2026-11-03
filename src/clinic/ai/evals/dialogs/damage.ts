/**
 * Métricas de estrago F1-0 (#506 / DEC-138 prática 12).
 * Informativas no L1; o mesmo contrato serve ao L2/L3 (#417).
 *
 * Dados fictícios. Não bloqueiam o merge (DEC-108: só INV bloqueiam).
 */
import { readZoneSnapshots } from '../../../config/zones'
import { DIALOG_TZ, type DialogScenario } from './scenario'

/** Pedido declarado no caso (o que a cliente quis). */
export type DamageRequest = {
  /** Chave em `scenario.ids` do serviço pedido. */
  serviceKey?: keyof DialogScenario['ids']
  /** Nomes das zonas pedidas (ex.: Axila, Pernas). */
  zoneNames?: string[]
  /** Data civil YYYY-MM-DD no relógio da clínica. */
  date?: string
  /** Hora HH:MM no relógio da clínica. */
  time?: string
}

export type DamageMetrics = {
  /** A proposta (ou marcação) bate com serviço, zonas e hora pedidos. null = sem proposta para julgar. */
  bookingMatchesRequest: boolean | null
  /** Quantas zonas a cliente pediu. */
  zonesRequested: number
  /** Quantas das pedidas entraram na proposta. */
  zonesInProposal: number
  /** zonesInProposal / zonesRequested; null se zonesRequested = 0. */
  zonesKeptRatio: number | null
  /** Turnos da cliente que corrigem (Corrigir, «não, …», «na verdade…», «corrigir»). */
  clientCorrections: number
  /** Turnos do agente até existir proposta com Confirmar; null se nunca houve. */
  turnsToConfirm: number | null
}

const CORRECTION_RE =
  /\bcorrigir\b|\bna verdade\b|\bnão,|\bnao,|\bmudei de ideia\b|\berrei\b/i

export function countClientCorrections(
  turns: ReadonlyArray<{ role: string; text?: string; buttonTitle?: string }>,
): number {
  let n = 0
  for (const t of turns) {
    if (t.role === 'choice' && /corrigir/i.test(t.buttonTitle ?? '')) {
      n += 1
      continue
    }
    if (t.role === 'client' && t.text && CORRECTION_RE.test(t.text)) n += 1
  }
  return n
}

export function computeDamageMetrics(input: {
  s: DialogScenario
  request?: DamageRequest
  clientCorrections: number
  /** Índice 1-based do turno do agente em que a proposta surgiu; null se nunca. */
  turnsToConfirm: number | null
}): DamageMetrics {
  const zoneNames = input.request?.zoneNames ?? []
  const zonesRequested = zoneNames.length

  const proposal = input.s.db.get<{
    id: string
    service_id: string
    starts_at: number
  }>(
    `SELECT id, service_id, starts_at FROM appointment_proposals
     WHERE tenant_id = ? AND conversation_id = ?
     ORDER BY created_at DESC, version DESC LIMIT 1`,
    input.s.tenantId,
    input.s.conversationId,
  )

  let zonesInProposal = 0
  let bookingMatchesRequest: boolean | null = null

  if (!proposal || !input.request) {
    return {
      bookingMatchesRequest: null,
      zonesRequested,
      zonesInProposal: 0,
      zonesKeptRatio: zonesRequested > 0 ? 0 : null,
      clientCorrections: input.clientCorrections,
      turnsToConfirm: input.turnsToConfirm,
    }
  }

  const snaps = readZoneSnapshots(input.s.db, input.s.tenantId, 'proposal', proposal.id)
  const snapNames = new Set(snaps.map((z) => z.name.trim().toLocaleLowerCase('pt-BR')))
  const requestedNorm = zoneNames.map((n) => n.trim().toLocaleLowerCase('pt-BR'))
  zonesInProposal = requestedNorm.filter((n) => snapNames.has(n)).length

  const serviceOk =
    !input.request.serviceKey ||
    proposal.service_id === input.s.ids[input.request.serviceKey]

  const d = new Date(proposal.starts_at)
  const date = d.toLocaleDateString('en-CA', { timeZone: DIALOG_TZ })
  const time = d.toLocaleTimeString('pt-BR', {
    timeZone: DIALOG_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const dateOk = !input.request.date || date === input.request.date
  const timeOk = !input.request.time || time === input.request.time
  const zonesOk = zonesRequested === 0 || zonesInProposal === zonesRequested

  bookingMatchesRequest = Boolean(serviceOk && dateOk && timeOk && zonesOk)

  return {
    bookingMatchesRequest,
    zonesRequested,
    zonesInProposal,
    zonesKeptRatio: zonesRequested > 0 ? zonesInProposal / zonesRequested : null,
    clientCorrections: input.clientCorrections,
    turnsToConfirm: input.turnsToConfirm,
  }
}

export function formatDamageReport(
  rows: Array<{ id: string; damage?: DamageMetrics }>,
): string {
  const withDamage = rows.filter((r) => r.damage)
  if (withDamage.length === 0) return ''
  const lines = ['  métricas de estrago (F1-0 / #506):']
  for (const r of withDamage) {
    const d = r.damage!
    const match =
      d.bookingMatchesRequest == null ? '—' : d.bookingMatchesRequest ? 'sim' : 'não'
    const kept =
      d.zonesKeptRatio == null
        ? '—'
        : `${d.zonesInProposal}/${d.zonesRequested} (${Math.round(d.zonesKeptRatio * 100)}%)`
    const turns = d.turnsToConfirm == null ? '—' : String(d.turnsToConfirm)
    lines.push(
      `  · ${r.id}: marcação=pedido ${match}; zonas ${kept}; correções ${d.clientCorrections}; voltas→Confirmar ${turns}`,
    )
  }
  return lines.join('\n')
}
