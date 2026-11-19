/**
 * DEC-210: resposta única «Remarcar e cancelar».
 * Parte A = texto do sinal (Recebimento, só com o sinal ligado) + parte B = regras gerais
 * da clínica (Assistente). A cliente recebe as duas juntas, A primeiro; uma nunca esconde a outra.
 */
import type { Clock } from '../../db/clock'
import type { ClinicDb } from '../store'
import { effectiveSignalCancellationPolicy } from '../pix/signal-settings'
import { ensureClinicSettings } from '../config/settings'

export function buildCancellationPolicyReply(db: ClinicDb, tenantId: string, clock: Clock): string {
  const settings = ensureClinicSettings(db, tenantId, clock)
  const signalOn =
    (db.get<{ signal_enabled: number | null }>(
      `SELECT signal_enabled FROM clinic_settings WHERE id = 1 AND tenant_id = ?`,
      tenantId,
    )?.signal_enabled ?? 0) === 1
  const a = signalOn ? effectiveSignalCancellationPolicy(db, tenantId, clock).trim() : ''
  const b = settings.reschedulePolicy.trim()
  if (a && b && !a.includes(b) && !b.includes(a)) return `${a}\n\n${b}`
  // Um contém o outro (texto copiado): fica o mais completo, sem repetir.
  if (a && b) return a.length >= b.length ? a : b
  return a || b
}
