export type SqlValue = string | number | bigint | null | Uint8Array

/**
 * Adaptador mínimo sobre D1 ou node:sqlite.
 * Repositórios administrativos usam apenas este contrato — não misturar
 * com SQL operacional do Durable Object (#20).
 */
export type AdminDb = {
  run(sql: string, ...params: SqlValue[]): { changes: number }
  get<T extends Record<string, unknown>>(sql: string, ...params: SqlValue[]): T | undefined
  all<T extends Record<string, unknown>>(sql: string, ...params: SqlValue[]): T[]
  /** Transação IMMEDIATE (serializa escritores no SQLite). */
  immediate<T>(fn: () => T): T
}

/** node:sqlite DatabaseSync → AdminDb (testes unitários). */
export function fromNodeSqlite(db: {
  prepare(sql: string): {
    run(...params: SqlValue[]): { changes: number | bigint }
    get(...params: SqlValue[]): unknown
    all(...params: SqlValue[]): unknown[]
  }
  exec(sql: string): void
}): AdminDb {
  return {
    run(sql, ...params) {
      const result = db.prepare(sql).run(...params)
      return { changes: Number(result.changes) }
    },
    get<T extends Record<string, unknown>>(sql: string, ...params: SqlValue[]) {
      return db.prepare(sql).get(...params) as T | undefined
    },
    all<T extends Record<string, unknown>>(sql: string, ...params: SqlValue[]) {
      return db.prepare(sql).all(...params) as T[]
    },
    immediate<T>(fn: () => T): T {
      db.exec('BEGIN IMMEDIATE')
      try {
        const result = fn()
        db.exec('COMMIT')
        return result
      } catch (err) {
        try {
          db.exec('ROLLBACK')
        } catch {
          /* ignore */
        }
        throw err
      }
    },
  }
}

/**
 * D1Database → AdminDb síncrono via batch não é possível; use os repositórios
 * async em F1 HTTP (#21). Este helper existe para smoke local quando o runtime
 * expuser API sync de testes.
 */
export function assertAdminDb(db: AdminDb): AdminDb {
  return db
}
