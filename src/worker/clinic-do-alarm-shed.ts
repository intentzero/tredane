/**
 * Quebra espiral de CPU no alarme do Clinic DO.
 *
 * Quando o Lab (ou outra carga) deixa muitos idle/autodraft vencidos, o `alarm()`
 * tenta processá-los todos (fanout + LLM), excede o teto de CPU do isolate e o
 * runtime reentrega o alarme — `lab_status`/`lab_say` passam a falhar também.
 *
 * Se o backlog vencido passa o limiar, larga autodrafts vencidos; timers idle
 * ficam no SQLite para o sweep DEC-087 reagendar na passagem seguinte.
 */
import type { ClinicDb } from '../clinic/store'

/**
 * Acima disto, a passagem do alarme salta o idle (só autodraft é derrubado).
 * Não apagar `idle_due_at`: isso desligava o DEC-087 até nova mensagem.
 */
export const ALARM_SHED_IDLE_THRESHOLD = 3
/** Acima disto, largar autodrafts vencidos sem chamar o modelo nesta passagem. */
export const ALARM_SHED_AUTODRAFT_THRESHOLD = 2

export type AlarmBacklogCounts = {
  idleDue: number
  autodraftDue: number
}

export type AlarmShedResult = AlarmBacklogCounts & {
  shed: boolean
  /** Sempre 0 — o shed já não apaga timers idle (regressão staging). */
  idleCleared: number
  autodraftDropped: number
  /** True quando idle vencido passou o limiar; o alarme adia o sweep idle. */
  idleDeferred: boolean
}

export function countDueAlarmBacklog(
  db: ClinicDb,
  tenantId: string,
  nowMs: number,
): AlarmBacklogCounts {
  const idleDue =
    db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM conversations
       WHERE tenant_id = ? AND idle_due_at IS NOT NULL AND idle_due_at <= ?`,
      tenantId,
      nowMs,
    )?.n ?? 0
  const autodraftDue =
    db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ai_autodraft_jobs
       WHERE tenant_id = ? AND (
         (state = 'queued' AND due_at <= ?)
         OR state = 'generating'
       )`,
      tenantId,
      nowMs,
    )?.n ?? 0
  return { idleDue, autodraftDue }
}

export function shedDueAlarmBacklog(
  db: ClinicDb,
  tenantId: string,
  nowMs: number,
): AlarmShedResult {
  const counts = countDueAlarmBacklog(db, tenantId, nowMs)
  const idleDeferred = counts.idleDue >= ALARM_SHED_IDLE_THRESHOLD
  const shouldShedAutodraft = counts.autodraftDue >= ALARM_SHED_AUTODRAFT_THRESHOLD
  const shouldShed = idleDeferred || shouldShedAutodraft
  if (!shouldShed) {
    return {
      ...counts,
      shed: false,
      idleCleared: 0,
      autodraftDropped: 0,
      idleDeferred: false,
    }
  }

  let autodraftDropped = 0
  if (shouldShedAutodraft) {
    db.run(
    `DELETE FROM ai_autodraft_jobs
     WHERE tenant_id = ? AND (
       (state = 'queued' AND due_at <= ?)
       OR state = 'generating'
     )`,
      tenantId,
      nowMs,
    )
    autodraftDropped = counts.autodraftDue
  }

  return {
    ...counts,
    shed: true,
    idleCleared: 0,
    autodraftDropped,
    idleDeferred,
  }
}
