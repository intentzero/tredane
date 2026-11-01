/**
 * O rascunho da IA não leva percentagem, código de símbolo nem hora filtrada (DEC-077 S7).
 * A frase fixa do WhatsApp pode repetir-se. Sem a frase, horários da lista continuam válidos.
 * DEC-118: a lista de livres vem de agendaFacts locais, não do payload ao gateway.
 */
import type { AiAgendaFacts, AiClinicContext } from '../../ai/types'
import { extractTimes } from './autobook'

const TEMPO_LEAK =
  /\d+\s*%|weather_code|precipitation|open-?meteo|ceu_limpo|pouco_nublado|parcialmente_nublado|muito_nublado/i

export function tempoDraftRejected(
  message: string,
  clinic: AiClinicContext | undefined,
  agendaFacts?: AiAgendaFacts | null,
): boolean {
  if (TEMPO_LEAK.test(message)) return true
  if (!clinic?.tempoNote) return false
  const allowed = new Set((agendaFacts?.freeSlots ?? []).flatMap((day) => day.times))
  for (const time of extractTimes(message)) {
    if (!allowed.has(time)) return true
  }
  return false
}
