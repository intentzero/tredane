import type { AdminDb, SqlValue } from './store'

/**
 * Adaptador D1 assíncrono para o caminho HTTP do Worker (#21).
 * Repositórios sync (`AdminDb`) continuam para testes com node:sqlite.
 */
export type AsyncAdminDb = {
  run(sql: string, ...params: SqlValue[]): Promise<{ changes: number }>
  get<T extends Record<string, unknown>>(
    sql: string,
    ...params: SqlValue[]
  ): Promise<T | undefined>
  all<T extends Record<string, unknown>>(sql: string, ...params: SqlValue[]): Promise<T[]>
}

export function fromD1(db: D1Database): AsyncAdminDb {
  return {
    async run(sql, ...params) {
      const result = await db
        .prepare(sql)
        .bind(...params)
        .run()
      return { changes: result.meta.changes ?? 0 }
    },
    async get<T extends Record<string, unknown>>(sql: string, ...params: SqlValue[]) {
      const row = await db
        .prepare(sql)
        .bind(...params)
        .first<T>()
      return row ?? undefined
    },
    async all<T extends Record<string, unknown>>(sql: string, ...params: SqlValue[]) {
      const result = await db
        .prepare(sql)
        .bind(...params)
        .all<T>()
      return result.results ?? []
    },
  }
}

/** Permite reutilizar SQL async nos testes com o adaptador sync. */
export function asyncFromSync(db: AdminDb): AsyncAdminDb {
  return {
    async run(sql, ...params) {
      return db.run(sql, ...params)
    },
    async get<T extends Record<string, unknown>>(sql: string, ...params: SqlValue[]) {
      return db.get<T>(sql, ...params)
    },
    async all<T extends Record<string, unknown>>(sql: string, ...params: SqlValue[]) {
      return db.all<T>(sql, ...params)
    },
  }
}
