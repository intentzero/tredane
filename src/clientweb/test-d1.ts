/** Adaptador de teste: AdminDb (SQLite em memória) → interface D1 mínima. */
import type { bootAdminDb } from '../db/test-db'

type SqlParam = string | number | null | Uint8Array

/** Adaptador mínimo AdminDb → interface D1 prepare/bind/first/run (mesmo padrão do Flow). */
export function adminDbAsD1(admin: ReturnType<typeof bootAdminDb>['db']): D1Database {
  return {
    prepare(sql: string) {
      const binds: SqlParam[] = []
      const stmt = {
        bind(...args: SqlParam[]) {
          binds.push(...args)
          return stmt
        },
        async first<T>() {
          return (admin.get(sql, ...binds) as T | undefined) ?? null
        },
        async run() {
          admin.run(sql, ...binds)
          return { success: true, meta: {} }
        },
        async all() {
          return { results: admin.all(sql, ...binds), success: true, meta: {} }
        },
      }
      return stmt
    },
  } as unknown as D1Database
}
