/**
 * Linha e zonas reconhecidas no texto para pré-preencher o link «Abrir agenda» (DEC-202).
 */
import { explicitAudienceLine } from '../clinic/catalog/audience'
import type { ServiceRow } from '../clinic/config/types'
import { zonesChosenInClientTexts } from '../clinic/ai/schedule-choice'
import { needsAudienceLine, zonesForAudienceLine, type AudienceLine } from '../clinic/ai/variant-line'
import { parseTemporal, type Period } from '../clinic/ai/nlu/temporal'
import { addCivilDays } from '../clinic/ai/slot-offer'
import { CLIENT_WEB_HORIZON_DAYS } from './booking'

export type ClientWebDayPart = Period

export type ClientWebLinkFields = {
  audienceLine: AudienceLine | null
  variantIds: string[]
  /** Dia civil YYYY-MM-DD quando só há uma data clara no texto. */
  preferredDate: string | null
  dayPart: ClientWebDayPart | null
}

const CIVIL = /^\d{4}-\d{2}-\d{2}$/

/** Data e período do texto, limitados ao horizonte da página (DEC-201). */
export function clientWebSchedulePrefsFromText(text: string, today: string): {
  preferredDate: string | null
  dayPart: ClientWebDayPart | null
} {
  const parsed = parseTemporal(text, today)
  let preferredDate: string | null = null
  if (
    parsed.dates.length === 1 &&
    !parsed.dateConflict &&
    !parsed.invalidDateMention &&
    CIVIL.test(parsed.dates[0]!)
  ) {
    const d = parsed.dates[0]!
    const last = addCivilDays(today, CLIENT_WEB_HORIZON_DAYS - 1)
    if (d >= today && d <= last) preferredDate = d
  }
  const dayPart = parsed.periods.length === 1 ? parsed.periods[0]! : null
  return { preferredDate, dayPart }
}

/** Extrai linha, zonas, data e período citados para um serviço já reconhecido no turno. */
export function clientWebLinkFieldsFromText(
  text: string,
  serviceId: string | null,
  services: readonly ServiceRow[],
  today: string,
): ClientWebLinkFields {
  const schedule = clientWebSchedulePrefsFromText(text, today)
  if (!serviceId) return { audienceLine: null, variantIds: [], ...schedule }
  const service = services.find((s) => s.id === serviceId && s.active)
  if (!service) return { audienceLine: null, variantIds: [], ...schedule }

  const activeZones = service.zones.filter((z) => z.active)
  const mixed = needsAudienceLine(activeZones)
  const audienceLine = mixed ? explicitAudienceLine(text) : null
  let scoped = activeZones
  if (audienceLine) scoped = zonesForAudienceLine(activeZones, audienceLine)

  const { zones, ambiguous } = zonesChosenInClientTexts([text], scoped, {
    selectionMode: service.variantSelection,
  })
  const variantIds =
    !ambiguous && zones.length > 0 ? zones.map((z) => z.id) : []
  return { audienceLine, variantIds, ...schedule }
}