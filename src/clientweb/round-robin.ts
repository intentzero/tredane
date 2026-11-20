/**
 * Round-robin de profissional na página web (DEC-218).
 * Âmbito: por serviço. Seed: última atribuição «Sem preferência» nesse serviço.
 * Anel: avança entre as profissionais livres na hora pedida.
 */
import type { Clock } from '../db/clock'
import type { ClinicDb } from '../clinic/store'

export function readRrLastProfessional(
  db: ClinicDb,
  tenantId: string,
  serviceId: string,
): string | null {
  const row = db.get<{ last_professional_id: string }>(
    `SELECT last_professional_id FROM client_web_rr_cursor
      WHERE tenant_id = ? AND service_id = ?`,
    tenantId,
    serviceId,
  )
  return row?.last_professional_id ?? null
}

export function writeRrLastProfessional(
  db: ClinicDb,
  tenantId: string,
  serviceId: string,
  professionalId: string,
  clock: Clock,
): void {
  db.run(
    `INSERT INTO client_web_rr_cursor (tenant_id, service_id, last_professional_id, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(tenant_id, service_id) DO UPDATE SET
       last_professional_id = excluded.last_professional_id,
       updated_at = excluded.updated_at`,
    tenantId,
    serviceId,
    professionalId,
    clock.nowMs(),
  )
}

/**
 * Escolhe a próxima profissional livre depois de `lastId` no anel estável (ordem por nome).
 * `orderedIds` = profissionais do serviço ordenadas; `freeIds` = subset livre na hora.
 */
export function pickRoundRobinProfessional(
  orderedIds: readonly string[],
  freeIds: ReadonlySet<string>,
  lastId: string | null,
): string | null {
  if (orderedIds.length === 0 || freeIds.size === 0) return null
  const start = lastId ? orderedIds.indexOf(lastId) : -1
  for (let i = 1; i <= orderedIds.length; i++) {
    const candidate = orderedIds[(start + i) % orderedIds.length]!
    if (freeIds.has(candidate)) return candidate
  }
  return null
}
