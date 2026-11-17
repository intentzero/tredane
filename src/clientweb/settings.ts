/**
 * Interruptor da owner por clínica para a página web da cliente (DEC-199, ADR-0018).
 * Desligado por defeito: sem linha, a clínica não oferece o link e a página não abre.
 */
import type { Clock } from '../db/clock'
import { writeOperationalAudit } from '../clinic/audit'
import type { ClinicCaller } from '../clinic/envelopes'
import { assertValidCaller } from '../clinic/envelopes'
import { assertClinicSchemaReady } from '../clinic/migrations'
import type { ClinicDb } from '../clinic/store'
import { bindOrAssertTenant } from '../clinic/tenant'

export function isClientWebEnabledForClinic(db: ClinicDb, tenantId: string): boolean {
  const row = db.get<{ enabled: number }>(
    'SELECT enabled FROM clinic_client_web WHERE tenant_id = ?',
    tenantId,
  )
  return row?.enabled === 1
}

export type ClientWebClinicSetting = { enabled: boolean; updatedAt: number | null }

export function readClientWebSetting(db: ClinicDb, tenantId: string): ClientWebClinicSetting {
  const row = db.get<{ enabled: number; updated_at: number }>(
    'SELECT enabled, updated_at FROM clinic_client_web WHERE tenant_id = ?',
    tenantId,
  )
  return { enabled: row?.enabled === 1, updatedAt: row?.updated_at ?? null }
}

/** Só a owner liga ou desliga (a permissão é verificada na rota); fica na auditoria. */
export function setClientWebEnabledOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: { enabled: boolean },
  clock: Clock,
): ClientWebClinicSetting {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  const before = isClientWebEnabledForClinic(db, meta.tenantId)
  const now = clock.nowMs()
  db.transactionSync(() => {
    db.run(
      `INSERT INTO clinic_client_web (tenant_id, enabled, updated_by, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (tenant_id) DO UPDATE SET enabled = excluded.enabled, updated_by = excluded.updated_by,
         updated_at = excluded.updated_at`,
      meta.tenantId,
      input.enabled ? 1 : 0,
      caller.actorId ?? caller.kind,
      now,
    )
    writeOperationalAudit(
      db,
      {
        tenantId: meta.tenantId,
        actor: caller.actorId ?? caller.kind,
        action: 'config.client_web_updated',
        objectType: 'clinic_client_web',
        objectId: meta.tenantId,
        detail: { before, after: input.enabled },
      },
      clock,
    )
  })
  return readClientWebSetting(db, meta.tenantId)
}
