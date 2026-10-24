import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Lista migrações SQL versionadas (ignora meta/). */
export function listMigrationFiles(migrationsDir: string): string[] {
  return readdirSync(migrationsDir)
    .filter((name) => /^\d+.*\.sql$/i.test(name))
    .sort()
    .map((name) => join(migrationsDir, name))
}

/** Divide ficheiro Drizzle em statements (respeita `--> statement-breakpoint`). */
export function splitSqlStatements(sql: string): string[] {
  return sql
    .split(/-->\s*statement-breakpoint\s*/i)
    .map((part) =>
      part
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter(Boolean)
}

export function applySqlFile(exec: (sql: string) => void, filePath: string): void {
  const sql = readFileSync(filePath, 'utf8')
  if (/-->\s*statement-breakpoint/i.test(sql)) {
    for (const statement of splitSqlStatements(sql)) {
      exec(statement)
    }
  } else {
    // 0001/0002 históricos: vários statements; exec() do SQLite aceita o ficheiro inteiro.
    exec(sql)
  }
}

export function applyAllMigrations(
  exec: (sql: string) => void,
  migrationsDir: string,
  opts: { untilInclusive?: string } = {},
): string[] {
  const files = listMigrationFiles(migrationsDir)
  const applied: string[] = []
  for (const file of files) {
    const base = file.split(/[/\\]/).pop()!
    applySqlFile(exec, file)
    applied.push(base)
    if (opts.untilInclusive && base.startsWith(opts.untilInclusive)) break
  }
  return applied
}
