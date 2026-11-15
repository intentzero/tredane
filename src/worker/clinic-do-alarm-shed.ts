/**
 * Quebra espiral de CPU no alarme do Clinic DO.
 *
 * Quando o Lab (ou outra carga) deixa muitos idle/autodraft vencidos, o `alarm()`
 * tenta processá-los todos (fanout + LLM), excede o teto de CPU do isolate e o
 * runtime reentrega o alarme — `lab_status`/`lab_say` passam a falhar também.
 *
 * Se o backlog vencido passa o limiar, limpa com SQL barato e deixa a passagem
 * seguinte (já sem fila) correr o caminho normal.
 */
import type { ClinicDb } from '../clinic/store'

/** Acima disto, limpar idle vencido sem enviar prompts nesta passagem. */
export const ALARM_SHED_IDLE_THRESHOLD = 3
/** Acima disto, largar autodrafts vencidos sem chamar o modelo nesta passagem. */
export const ALARM_SHED_AUTODRAFT_THRESHOLD = 2

export type AlarmBacklogCounts = {
  idleDue: number
  autodraftDue: number
}

export type AlarmShedResult = AlarmBacklogCounts & {
  shed: boolean
  idleCleared: number
  autodraftDropped: number
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
  const shouldShed =
    counts.idleDue >= ALARM_SHED_IDLE_THRESHOLD ||
    counts.autodraftDue >= ALARM_SHED_AUTODRAFT_THRESHOLD
  if (!shouldShed) {
    return { ...counts, shed: false, idleCleared: 0, autodraftDropped: 0 }
  }

  db.run(
    `UPDATE conversations
     SET idle_due_at = NULL, idle_phase = NULL, idle_prompt_sent_at = NULL, updated_at = ?
     WHERE tenant_id = ? AND idle_due_at IS NOT NULL AND idle_due_at <= ?`,
    nowMs,
    tenantId,
    nowMs,
  )
  const idleCleared = counts.idleDue

  db.run(
    `DELETE FROM ai_autodraft_jobs
     WHERE tenant_id = ? AND (
       (state = 'queued' AND due_at <= ?)
       OR state = 'generating'
     )`,
    tenantId,
    nowMs,
  )
  const autodraftDropped = counts.autodraftDue

  return {
    ...counts,
    shed: true,
    idleCleared,
    autodraftDropped,
  }
}
