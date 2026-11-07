/**
 * DEC-149 / residual DEC-145 §2.4 — efeitos ao gravar `varias` → `uma`.
 * Não reescreve snapshots de marcações confirmadas.
 */
import type { Clock } from '../../db/clock'
import {
  clearBookingFrame,
  getBookingFrame,
  saveBookingFrame,
} from '../ai/schedule-session'
import { ValidationError } from '../errors'
import { retireActiveProposal } from '../proposals/proposals'
import type { ClinicDb } from '../store'
import { listCombos } from './combos'
import { readZoneSnapshots } from './zones'

/** Recusa gravar `uma` enquanto houver combo activo (P1 Confirmado Paulo 07/11/2026). */
export function assertNoActiveCombosForUma(
  db: ClinicDb,
  tenantId: string,
  serviceId: string,
): void {
  const active = listCombos(db, tenantId, serviceId).filter((c) => c.active)
  if (active.length === 0) return
  const names = active.map((c) => c.name)
  const listed =
    names.length === 1
      ? `«${names[0]}»`
      : names.slice(0, -1).map((n) => `«${n}»`).join(', ') + ` e «${names[names.length - 1]}»`
  throw new ValidationError(
    'variant_selection_combos_active',
    `Desactive ${names.length === 1 ? 'o combo' : 'os combos'} ${listed} antes de mudar para uma variante por atendimento.`,
    { serviceId, comboNames: names, comboIds: active.map((c) => c.id) },
  )
}

function parseVariantIds(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is string => typeof x === 'string')
  } catch {
    return []
  }
}

/**
 * Limpa frames abertos com N>1 variantes, retira propostas multi abertas
 * e deixa a próxima mensagem perguntar o tipo. Snapshots confirmados ficam.
 */
export function clearOpenMultiVariantStateForService(
  db: ClinicDb,
  tenantId: string,
  serviceId: string,
  clock: Clock,
): { framesCleared: number; proposalsRetired: number } {
  let framesCleared = 0
  let proposalsRetired = 0
  const conversations = new Set<string>()

  const frameRows = db.all<{ conversation_id: string; variant_ids: string | null }>(
    `SELECT conversation_id, variant_ids FROM schedule_sessions
     WHERE tenant_id = ? AND service_id = ?`,
    tenantId,
    serviceId,
  )
  for (const row of frameRows) {
    const ids = parseVariantIds(row.variant_ids)
    if (ids.length <= 1) continue
    conversations.add(row.conversation_id)
    const existing = getBookingFrame(db, tenantId, row.conversation_id)
    if (!existing) continue
    // Limpa variantes / eco / oferta / apontador de proposta; mantém serviço e linha.
    saveBookingFrame(
      db,
      tenantId,
      row.conversation_id,
      {
        serviceId,
        variantIds: null,
        pending: null,
        lastOffer: null,
        proposal: null,
        time: null,
        date: null,
        period: null,
        phase: 'coletando',
        source: 'regra',
      },
      clock,
      { emitOutbox: false },
    )
    framesCleared += 1
  }

  const openProposals = db.all<{ id: string; conversation_id: string | null; state: string }>(
    `SELECT p.id, p.conversation_id, p.state
     FROM appointment_proposals p
     WHERE p.tenant_id = ? AND p.service_id = ?
       AND p.state IN ('preparada', 'envio_pendente', 'envio_incerto', 'enviada')`,
    tenantId,
    serviceId,
  )
  for (const row of openProposals) {
    const snaps = readZoneSnapshots(db, tenantId, 'proposal', row.id)
    if (snaps.length <= 1) continue
    if (row.conversation_id) conversations.add(row.conversation_id)
  }

  for (const conversationId of conversations) {
    const retired = retireActiveProposal(db, tenantId, conversationId, clock)
    if (retired) proposalsRetired += 1
    // Se o frame ficou sem variantes mas ainda apontava proposta, já limpamos acima.
    const frame = getBookingFrame(db, tenantId, conversationId)
    if (frame?.serviceId === serviceId && (frame.variantIds?.length ?? 0) > 1) {
      clearBookingFrame(db, tenantId, conversationId, clock, { emitOutbox: false })
      framesCleared += 1
    }
  }

  return { framesCleared, proposalsRetired }
}
