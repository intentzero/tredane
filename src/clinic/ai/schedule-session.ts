/**
 * Linha escolhida na conversa (feminina ou masculina).
 * Não é atributo do contacto e não se infere pelo nome, pelo histórico nem por marcações.
 */
import type { Clock } from '../../db/clock'
import type { ClinicDb } from '../store'

export type ScheduleAudienceLine = 'feminino' | 'masculino'

export type ScheduleSession = {
  serviceId: string
  audienceLine: ScheduleAudienceLine | null
}

type SessionSql = {
  service_id: string
  audience_line: string | null
}

function asLine(value: string | null): ScheduleAudienceLine | null {
  return value === 'feminino' || value === 'masculino' ? value : null
}

export function getScheduleSession(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
): ScheduleSession | null {
  const row = db.get<SessionSql>(
    `SELECT service_id, audience_line FROM schedule_sessions
     WHERE tenant_id = ? AND conversation_id = ?`,
    tenantId,
    conversationId,
  )
  if (!row) return null
  return { serviceId: row.service_id, audienceLine: asLine(row.audience_line) }
}

/** Grava a linha explícita, ou null enquanto a pergunta ainda não foi respondida. */
export function saveScheduleLine(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  serviceId: string,
  audienceLine: ScheduleAudienceLine | null,
  clock: Clock,
): void {
  const now = clock.nowMs()
  db.run(
    `INSERT INTO schedule_sessions (tenant_id, conversation_id, service_id, audience_line, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (tenant_id, conversation_id) DO UPDATE SET
       service_id = excluded.service_id,
       audience_line = excluded.audience_line,
       updated_at = excluded.updated_at`,
    tenantId,
    conversationId,
    serviceId,
    audienceLine,
    now,
  )
}
