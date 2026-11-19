/**
 * DEC-217 (limpeza):
 * 1. FAQ escritas à mão sobre sinal, multa, cancelar ou remarcar passam a rascunho: a resposta vem
 *    do Recebimento + regras gerais (DEC-210). A entrada sincronizada `signal_policy` não se toca.
 * 2. Saem os limites «marcações pela IA por contato / por clínica»: nenhum caminho os verifica
 *    desde que o chat deixou de marcar (DEC-202).
 */
export const MIGRATION_ID = 78
export const MIGRATION_NAME = '0078_faq_policy_and_ai_booking_limits'

export const STATEMENTS = [
  `UPDATE clinic_knowledge_entries
     SET status = 'draft', published_at = NULL
   WHERE status = 'published'
     AND source_key IS NULL
     AND (
       lower(question) LIKE '%sinal%' OR lower(match_cues_json) LIKE '%sinal%'
       OR lower(question) LIKE '%multa%' OR lower(match_cues_json) LIKE '%multa%'
       OR lower(question) LIKE '%cancel%' OR lower(match_cues_json) LIKE '%cancel%'
       OR lower(question) LIKE '%remarc%' OR lower(match_cues_json) LIKE '%remarc%'
       OR lower(question) LIKE '%reagend%' OR lower(match_cues_json) LIKE '%reagend%'
     )`,
  `ALTER TABLE clinic_settings DROP COLUMN abuse_ai_bookings_per_contact`,
  `ALTER TABLE clinic_settings DROP COLUMN abuse_ai_bookings_per_clinic`,
] as const
