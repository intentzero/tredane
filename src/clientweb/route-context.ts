/**
 * Linha e zonas reconhecidas no texto para pré-preencher o link «Abrir agenda» (DEC-202).
 */
import { explicitAudienceLine } from '../clinic/catalog/audience'
import type { ServiceRow } from '../clinic/config/types'
import { zonesChosenInClientTexts } from '../clinic/ai/schedule-choice'
import { needsAudienceLine, zonesForAudienceLine, type AudienceLine } from '../clinic/ai/variant-line'

export type ClientWebLinkFields = {
  audienceLine: AudienceLine | null
  variantIds: string[]
}

/** Extrai linha e zonas citadas para um serviço já reconhecido no turno. */
export function clientWebLinkFieldsFromText(
  text: string,
  serviceId: string | null,
  services: readonly ServiceRow[],
): ClientWebLinkFields {
  if (!serviceId) return { audienceLine: null, variantIds: [] }
  const service = services.find((s) => s.id === serviceId && s.active)
  if (!service) return { audienceLine: null, variantIds: [] }

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
  return { audienceLine, variantIds }
}