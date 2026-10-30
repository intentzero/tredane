/**
 * Aviso da marcação manual (DEC-077 S6).
 * A hora continua selecionável. O aviso não é gravado no compromisso.
 */
import type { Clock } from '../../db/clock'
import type { TempoCeu, TempoTemperatura } from '../config/types'
import { getService } from '../config/services'
import type { ClinicDb } from '../store'
import type { AvailabilityQueryResult } from '../scheduling/types'
import { memoAdapter } from './automatic'
import { evaluateServiceTempo, type ForecastAdapter, type TempoVerdict } from './evaluate'

const UNCONFIRMED = 'Não deu para confirmar o tempo'

export function tempoWarningPhrases(
  verdict: TempoVerdict,
  rule: { tempoCeu: TempoCeu; tempoTemperatura: TempoTemperatura; tempoCelsius: number | null },
): string[] {
  if (verdict.outcome === 'serve') return []
  if (verdict.outcome === 'indisponivel') return [UNCONFIRMED]
  const phrases: string[] = []
  if (verdict.reasons.includes('ceu')) {
    if (rule.tempoCeu === 'sol') phrases.push('Sol fraco neste horário')
    if (rule.tempoCeu === 'chuva') phrases.push('Sem chuva neste horário')
  }
  if (verdict.reasons.includes('temperatura') && rule.tempoCelsius != null) {
    if (rule.tempoTemperatura === 'acima') {
      phrases.push(`Abaixo de ${rule.tempoCelsius} °C neste horário`)
    }
    if (rule.tempoTemperatura === 'abaixo') {
      phrases.push(`Acima de ${rule.tempoCelsius} °C neste horário`)
    }
  }
  return phrases
}

/** Avisos de uma hora. Vazio quando o serviço não restringe o tempo. */
export async function tempoWarningsAt(
  db: ClinicDb,
  tenantId: string,
  serviceId: string,
  startsAt: number,
  adapter: ForecastAdapter,
  clock: Clock,
): Promise<string[]> {
  const service = getService(db, tenantId, serviceId)
  if (!service) return [UNCONFIRMED]
  const verdict = await evaluateServiceTempo(
    db,
    tenantId,
    { serviceId, startsAt },
    adapter,
    clock,
  )
  return tempoWarningPhrases(verdict, service)
}

/** Grade da equipe: cada hora livre ganha o aviso, sem sair da lista. */
export async function withTempoWarnings(
  db: ClinicDb,
  tenantId: string,
  result: AvailabilityQueryResult,
  adapter: ForecastAdapter,
  clock: Clock,
): Promise<AvailabilityQueryResult> {
  const service = getService(db, tenantId, result.serviceId)
  const unrestricted = !service
    || (service.tempoCeu === 'tanto_faz' && service.tempoTemperatura === 'tanto_faz')
  if (unrestricted) {
    return {
      ...result,
      slots: result.slots.map((slot) => ({ ...slot, tempoWarnings: [] })),
    }
  }
  const memo = memoAdapter(adapter)
  const phrases = new Map<number, string[]>()
  for (const startsAt of new Set(result.slots.map((slot) => slot.startsAt))) {
    const verdict = await evaluateServiceTempo(
      db,
      tenantId,
      { serviceId: result.serviceId, startsAt },
      memo,
      clock,
    )
    phrases.set(startsAt, tempoWarningPhrases(verdict, service))
  }
  return {
    ...result,
    slots: result.slots.map((slot) => ({
      ...slot,
      tempoWarnings: phrases.get(slot.startsAt) ?? [],
    })),
  }
}
