/**
 * DEC-210: resposta única «Remarcar e cancelar».
 * Parte A = texto do sinal (Recebimento, só com o sinal ligado) + parte B = regras gerais
 * da clínica (Assistente). A cliente recebe as duas juntas, A primeiro; uma nunca esconde a outra.
 */
import type { Clock } from '../../db/clock'
import type { ClinicDb } from '../store'
import { effectiveSignalCancellationPolicy } from '../pix/signal-settings'
import { ensureClinicSettings } from '../config/settings'

/** DEC-210: frase que liga a regra do sinal (Recebimento) às regras gerais da clínica. */
export const POLICY_JOIN_PHRASE = 'Regras gerais da clínica:'
/** Limite da resposta combinada (cabe numa mensagem de WhatsApp sem cortar). */
export const POLICY_REPLY_MAX_CHARS = 1000
export const POLICY_OVERFLOW_PHRASE = 'Para as demais regras, fale com a equipe.'
/** Tamanho máximo das regras gerais (campo no painel e servidor). */
export const GENERAL_POLICY_MAX_CHARS = 500

export function buildCancellationPolicyReply(db: ClinicDb, tenantId: string, clock: Clock): string {
  const settings = ensureClinicSettings(db, tenantId, clock)
  const signalOn =
    (db.get<{ signal_enabled: number | null }>(
      `SELECT signal_enabled FROM clinic_settings WHERE id = 1 AND tenant_id = ?`,
      tenantId,
    )?.signal_enabled ?? 0) === 1
  const a = signalOn ? effectiveSignalCancellationPolicy(db, tenantId, clock).trim() : ''
  const b = settings.reschedulePolicy.trim()
  if (a && b && !a.includes(b) && !b.includes(a)) {
    const joined = `${a}\n\n${POLICY_JOIN_PHRASE}\n${b}`
    // Passa do limite: a regra do dinheiro (A) sai inteira e o resto vai para a equipe.
    return joined.length > POLICY_REPLY_MAX_CHARS ? `${a}\n\n${POLICY_OVERFLOW_PHRASE}` : joined
  }
  // Um contém o outro (texto copiado): fica o mais completo, sem repetir.
  if (a && b) return a.length >= b.length ? a : b
  return a || b
}
