/**
 * Limite diário de chamadas ao modelo por clínica (aprovado: 300/dia, aviso ao responsável).
 *
 * A coluna `drafts` conta **unidades de chamada ao modelo** que consomem o teto do produto:
 * rascunho do painel (`suggestReplyOp`), extrator restrito e redator de exceção no autodraft.
 * Não conta tokens; não inclui turnos só determinísticos (sem LLM).
 * #491 / EE-06: extrator e redator no mesmo turno incrementam uma vez cada.
 */
import { AI_DAILY_DRAFT_CAP } from '../../ai'
import type { Clock } from '../../db/clock'
import { writeOperationalAudit } from '../audit'
import { ensureClinicSettings } from '../config/settings'
import { clinicCivilDateFromUtc } from '../scheduling/timezone'
import type { ClinicDb } from '../store'

export type AiDailyUsage = {
  day: string
  drafts: number
  cap: number
  capReached: boolean
  capReachedAt: number | null
}

export function clinicToday(db: ClinicDb, tenantId: string, clock: Clock): string {
  const tz = ensureClinicSettings(db, tenantId, clock).timezone || 'America/Sao_Paulo'
  return clinicCivilDateFromUtc(tz, clock.nowMs())
}

export function getAiDailyUsage(db: ClinicDb, tenantId: string, clock: Clock): AiDailyUsage {
  const day = clinicToday(db, tenantId, clock)
  const row = db.get<{ drafts: number; cap_reached_at: number | null }>(
    `SELECT drafts, cap_reached_at FROM ai_daily_usage WHERE tenant_id = ? AND day = ?`,
    tenantId,
    day,
  )
  const drafts = row?.drafts ?? 0
  return {
    day,
    drafts,
    cap: AI_DAILY_DRAFT_CAP,
    capReached: drafts >= AI_DAILY_DRAFT_CAP,
    capReachedAt: row?.cap_reached_at ?? null,
  }
}

/** Conta uma chamada ao modelo. `justReached` na primeira vez que bate o limite no dia. */
export function incrementAiDailyUsage(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
): { drafts: number; justReached: boolean } {
  const day = clinicToday(db, tenantId, clock)
  db.run(
    `INSERT INTO ai_daily_usage (tenant_id, day, drafts) VALUES (?, ?, 1)
     ON CONFLICT (tenant_id, day) DO UPDATE SET drafts = drafts + 1`,
    tenantId,
    day,
  )
  const u = getAiDailyUsage(db, tenantId, clock)
  let justReached = false
  if (u.capReached && u.capReachedAt == null) {
    db.run(
      `UPDATE ai_daily_usage SET cap_reached_at = ? WHERE tenant_id = ? AND day = ?`,
      clock.nowMs(),
      tenantId,
      day,
    )
    justReached = true
  }
  return { drafts: u.drafts, justReached }
}

/**
 * Regista uma chamada ao modelo no teto diário (sem corpo de mensagem).
 * Emite auditoria operacional na primeira vez que o dia atinge o teto.
 */
export function recordModelCallTowardDailyCap(
  db: ClinicDb,
  tenantId: string,
  clock: Clock,
): { drafts: number; justReached: boolean } {
  const usage = incrementAiDailyUsage(db, tenantId, clock)
  if (usage.justReached) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'ai.daily_cap_reached',
        tenantId,
        drafts: usage.drafts,
      }),
    )
    writeOperationalAudit(
      db,
      {
        tenantId,
        actor: 'system',
        action: 'ai.daily_cap_reached',
        objectType: 'clinic_settings',
        objectId: '1',
        detail: { drafts: usage.drafts },
      },
      clock,
    )
  }
  return usage
}
