import type { Clock } from '../../db/clock'
import { NotFoundError } from '../errors'
import { newId } from '../ids'
import type { ClinicDb } from '../store'
import { listAffectedAppointments } from './appointments'
import { getResource } from './resources'
import type {
  CreateBlockInput,
  CreateBlockResult,
  ResourceBlockRow,
} from './types'
import { CLINIC_SCOPE_ID } from './types'
import {
  assertBlockReason,
  assertTimeRange,
} from './validation'

type BlockSql = {
  id: string
  tenant_id: string
  resource_id: string
  starts_at: number
  ends_at: number
  reason: string
  note: string | null
  created_at: number
}

function toBlock(row: BlockSql): ResourceBlockRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    resourceId: row.resource_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    reason: row.reason as ResourceBlockRow['reason'],
    note: row.note,
    createdAt: row.created_at,
  }
}

export function listBlocks(
  db: ClinicDb,
  tenantId: string,
  resourceId?: string,
): ResourceBlockRow[] {
  if (resourceId) {
    return db
      .all<BlockSql>(
        `SELECT * FROM resource_blocks
         WHERE tenant_id = ? AND resource_id = ?
         ORDER BY starts_at, id`,
        tenantId,
        resourceId,
      )
      .map(toBlock)
  }
  return db
    .all<BlockSql>(
      `SELECT * FROM resource_blocks WHERE tenant_id = ?
       ORDER BY starts_at, id`,
      tenantId,
    )
    .map(toBlock)
}

/**
 * Cria bloqueio pontual. Lista compromissos afectados sem cancelá-los (DEC-008 / #28).
 * dryRun=true só devolve a lista (pré-visualização na UI).
 */
export function createResourceBlock(
  db: ClinicDb,
  tenantId: string,
  input: CreateBlockInput,
  clock: Clock,
): CreateBlockResult {
  const resource =
    input.resourceId === CLINIC_SCOPE_ID ? true : getResource(db, tenantId, input.resourceId, clock)
  if (!resource) {
    throw new NotFoundError(
      'resource_not_found',
      `recurso ${input.resourceId} não encontrado`,
    )
  }
  assertTimeRange(input.startsAt, input.endsAt)
  assertBlockReason(input.reason)

  const affected = listAffectedAppointments(
    db,
    tenantId,
    input.resourceId,
    input.startsAt,
    input.endsAt,
  )

  if (input.dryRun) {
    return { created: false, block: null, affectedAppointments: affected }
  }

  const id = newId('blk')
  const now = clock.nowMs()
  const note = input.note?.trim() ? input.note.trim() : null
  db.run(
    `INSERT INTO resource_blocks (
      id, tenant_id, resource_id, starts_at, ends_at, reason, note, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    tenantId,
    input.resourceId,
    input.startsAt,
    input.endsAt,
    input.reason,
    note,
    now,
  )

  const block = toBlock(
    db.get<BlockSql>(
      `SELECT * FROM resource_blocks WHERE tenant_id = ? AND id = ?`,
      tenantId,
      id,
    )!,
  )

  return { created: true, block, affectedAppointments: affected }
}

export function deleteResourceBlock(
  db: ClinicDb,
  tenantId: string,
  blockId: string,
): void {
  const existing = db.get<{ id: string }>(
    `SELECT id FROM resource_blocks WHERE tenant_id = ? AND id = ?`,
    tenantId,
    blockId,
  )
  if (!existing) {
    throw new NotFoundError('block_not_found', `bloqueio ${blockId} não encontrado`)
  }
  db.run(
    `DELETE FROM resource_blocks WHERE tenant_id = ? AND id = ?`,
    tenantId,
    blockId,
  )
}
