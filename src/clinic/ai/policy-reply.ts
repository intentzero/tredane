/**
 * DEC-210: resposta única «Remarcar e cancelar».
 * Parte A = texto do sinal (Recebimento, só com o sinal ligado) + parte B = regras gerais
 * da clínica (Assistente). A cliente recebe as duas juntas, A primeiro.
 * Revisão (Q3): B legado conflituoso continua a sair até a owner editar; novas gravações
 * conflituosas são barradas em `setClinicAiProfile` / painel (U1).
 */
import type { Clock } from '../../db/clock'
import type { ClinicDb } from '../store'
import { effectiveSignalCancellationPolicy } from '../pix/signal-settings'
import { ensureClinicSettings } from '../config/settings'
import { joinPolicyParts } from './policy-join'

export {
  GENERAL_POLICY_MAX_CHARS,
  POLICY_JOIN_PHRASE,
  POLICY_OVERFLOW_PHRASE,
  POLICY_REPLY_MAX_CHARS,
} from './policy-join'

export function buildCancellationPolicyReply(db: ClinicDb, tenantId: string, clock: Clock): string {
  const settings = ensureClinicSettings(db, tenantId, clock)
  const signalOn =
    (db.get<{ signal_enabled: number | null }>(
      `SELECT signal_enabled FROM clinic_settings WHERE id = 1 AND tenant_id = ?`,
      tenantId,
    )?.signal_enabled ?? 0) === 1
  const a = signalOn ? effectiveSignalCancellationPolicy(db, tenantId, clock).trim() : ''
  const b = settings.reschedulePolicy.trim()
  return joinPolicyParts(a, b)
}
