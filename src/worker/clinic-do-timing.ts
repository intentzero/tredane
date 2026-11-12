import type { Clock } from '../db/clock'
import type { ClinicDb, SqlValue } from '../clinic'

export type DoStepPhases = Record<string, number>

export type SqlInvocationStats = {
  exec: number
  rowsWritten: number
}

/** Conta chamadas `sql.exec` no DO (e `rowsWritten` quando o runtime expõe). */
export function instrumentClinicDb(base: ClinicDb, stats: SqlInvocationStats): ClinicDb {
  return {
    run(sql: string, ...params: SqlValue[]) {
      stats.exec += 1
      return base.run(sql, ...params)
    },
    get<T extends Record<string, unknown>>(sql: string, ...params: SqlValue[]) {
      stats.exec += 1
      return base.get<T>(sql, ...params)
    },
    all<T extends Record<string, unknown>>(sql: string, ...params: SqlValue[]) {
      stats.exec += 1
      return base.all<T>(sql, ...params)
    },
    exec(sql: string) {
      stats.exec += 1
      base.exec(sql)
    },
    transactionSync<T>(fn: () => T): T {
      stats.exec += 1
      return base.transactionSync(fn)
    },
  }
}

export class DoInvocationTimer {
  readonly method: string
  readonly startedMs: number
  private handlerEntryMs: number
  readonly phases: DoStepPhases = {}

  constructor(method: string, clock: Clock) {
    this.startedMs = clock.nowMs()
    this.handlerEntryMs = this.startedMs
    this.method = method
  }

  markHandlerEntry(clock: Clock): void {
    this.handlerEntryMs = clock.nowMs()
  }

  addPhase(name: string, ms: number): void {
    if (ms <= 0) return
    this.phases[name] = (this.phases[name] ?? 0) + ms
  }

  handlerDelayMs(): number {
    return Math.max(0, this.handlerEntryMs - this.startedMs)
  }

  totalMs(clock: Clock): number {
    return clock.nowMs() - this.startedMs
  }
}

export async function syncDoStorage(
  storage: { sync?: () => Promise<void> },
  clock: Clock,
): Promise<number> {
  if (typeof storage.sync !== 'function') return 0
  const started = clock.nowMs()
  await storage.sync()
  return clock.nowMs() - started
}

export function logDoStepTiming(input: {
  method: string
  tenantId?: string
  totalMs: number
  handlerDelayMs: number
  phases: DoStepPhases
  sqlExec: number
  sqlRowsWritten: number
  storageSyncMs: number
}): void {
  console.log(
    JSON.stringify({
      level: 'info',
      event: 'do.step_timing',
      ...input,
    }),
  )
}
