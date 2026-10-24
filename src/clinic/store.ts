export type SqlValue = string | number | bigint | null | Uint8Array

/**
 * Adaptador síncrono sobre SQLite do Clinic DO ou node:sqlite nos testes.
 * Separado do AdminDb (D1 central) — DEC-038 / ADR-0012.
 */
export type ClinicDb = {
  run(sql: string, ...params: SqlValue[]): { changes: number }
  get<T extends Record<string, unknown>>(sql: string, ...params: SqlValue[]): T | undefined
  all<T extends Record<string, unknown>>(sql: string, ...params: SqlValue[]): T[]
  exec(sql: string): void
  /**
   * Transação síncrona. No DO usa `storage.transactionSync`;
   * em node:sqlite usa BEGIN IMMEDIATE.
   * Nunca executar I/O externo (HTTP/Queues/R2) dentro do callback.
   */
  transactionSync<T>(fn: () => T): T
}

/** node:sqlite DatabaseSync → ClinicDb (testes unitários). */
export function fromNodeSqlite(db: {
  prepare(sql: string): {
    run(...params: SqlValue[]): { changes: number | bigint }
    get(...params: SqlValue[]): unknown
    all(...params: SqlValue[]): unknown[]
  }
  exec(sql: string): void
}): ClinicDb {
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
    exec(sql: string) {
      db.exec(sql)
    },
    transactionSync<T>(fn: () => T): T {
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

type DoSqlCursor = {
  toArray(): Record<string, SqlValue>[]
  one(): Record<string, SqlValue>
}

type DoSqlStorage = {
  sql: {
    exec(query: string, ...bindings: SqlValue[]): DoSqlCursor
  }
  transactionSync<T>(fn: () => T): T
}

/**
 * Adaptador sobre `ctx.storage.sql` + `transactionSync` do Durable Object.
 * `SqlStorage` não expõe `changes` de forma uniforme — contamos via SELECT quando preciso.
 */
export function fromDurableObjectSql(storage: DoSqlStorage): ClinicDb {
  return {
    run(sql: string, ...params: SqlValue[]) {
      storage.sql.exec(sql, ...params)
      return { changes: -1 }
    },
    get<T extends Record<string, unknown>>(sql: string, ...params: SqlValue[]) {
      const rows = storage.sql.exec(sql, ...params).toArray()
      return rows[0] as T | undefined
    },
    all<T extends Record<string, unknown>>(sql: string, ...params: SqlValue[]) {
      return storage.sql.exec(sql, ...params).toArray() as T[]
    },
    exec(sql: string) {
      storage.sql.exec(sql)
    },
    transactionSync<T>(fn: () => T): T {
      return storage.transactionSync(fn)
    },
  }
}
