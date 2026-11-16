import type { ClinicDb, SqlValue } from '../clinic/store'

/** Teto do SQLite do Clinic DO (100); margem para `tenant_id` e filtros extra. */
export const LAB_RESET_IN_CHUNK_SIZE = 90

export function chunkIds<T extends string>(ids: readonly T[]): T[][] {
  if (ids.length === 0) return []
  const out: T[][] = []
  for (let i = 0; i < ids.length; i += LAB_RESET_IN_CHUNK_SIZE) {
    out.push(ids.slice(i, i + LAB_RESET_IN_CHUNK_SIZE))
  }
  return out
}

export function countInList(
  db: ClinicDb,
  table: string,
  tenantId: string,
  column: string,
  ids: string[],
  extraSql = '',
  extraParams: SqlValue[] = [],
): number {
  if (ids.length === 0) return 0
  let total = 0
  for (const chunk of chunkIds(ids)) {
    const ph = chunk.map(() => '?').join(', ')
    const row = db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ${table}
       WHERE tenant_id = ? AND ${column} IN (${ph})${extraSql}`,
      tenantId,
      ...chunk,
      ...extraParams,
    )
    total += Number(row?.n ?? 0)
  }
  return total
}

export function selectIdsInList(
  db: ClinicDb,
  table: string,
  tenantId: string,
  column: string,
  ids: string[],
): string[] {
  if (ids.length === 0) return []
  const out: string[] = []
  for (const chunk of chunkIds(ids)) {
    const ph = chunk.map(() => '?').join(', ')
    const rows = db.all<{ id: string }>(
      `SELECT id FROM ${table} WHERE tenant_id = ? AND ${column} IN (${ph})`,
      tenantId,
      ...chunk,
    )
    for (const row of rows) out.push(row.id)
  }
  return out
}