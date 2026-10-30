/**
 * DEC-075 / S6 — frases fixas de recusa (equipa). Sem quantidade de vagas.
 */
import type { BlockSex } from './sex-block'
import type { UnavailabilityReason } from './types'

export const REFUSAL_ROOM_FULL = 'Esse horário nesta sala já está cheio.'
export const REFUSAL_PRO_OTHER_ROOM =
  'A profissional já está noutra sala nesse horário.'
export const REFUSAL_SEX_FEMININO =
  'Nesse horário a sala está só para o público feminino.'
export const REFUSAL_SEX_MASCULINO =
  'Nesse horário a sala está só para o público masculino.'
/** Corrida entre lista e confirmação — mantém a frase já usada (DEC-075 / S6). */
export const REFUSAL_RACE =
  'Esse horário acabou de ser ocupado. Nada foi reservado. Escolha outro horário.'

/**
 * Escolhe a frase pela prioridade do motivo (sexo > outra sala > sala cheia > corrida).
 * O modelo não redige estas frases.
 */
export function refusalMessageForReasons(
  reasons: readonly UnavailabilityReason[],
  blockSex?: BlockSex | null,
): string {
  if (reasons.includes('room_sex_mismatch')) {
    if (blockSex === 'masculino') return REFUSAL_SEX_MASCULINO
    return REFUSAL_SEX_FEMININO
  }
  if (reasons.includes('professional_other_room')) {
    return REFUSAL_PRO_OTHER_ROOM
  }
  if (reasons.includes('room_at_capacity')) {
    return REFUSAL_ROOM_FULL
  }
  return REFUSAL_RACE
}
