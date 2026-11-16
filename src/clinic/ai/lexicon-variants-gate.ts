/**
 * PR-E (Paulo, 16/11/2026 — rótulo F1 «axila e pernas» = rules certas):
 * quando o léxico já leu variantes coerentes, apply/sombra não preferem o LLM
 * em `differ` de variants/service. Aplicar o modelo aqui seria risco (eco/funil
 * já certos). Não é H1 completo; FAQ/line continuam a exigir evidência.
 */
import { textCitesNameOrSynonym } from '../config/synonyms'
import type { ServiceRow, VariantAudience } from '../config/types'
import { variantAudiencesConflict } from '../config/zones'
import { zonesForAudienceLine, type AudienceLine } from './variant-line'

export function lexiconVariantsCoherent(
  variantIds: readonly string[] | null | undefined,
  opts: { turnText: string; services: readonly ServiceRow[] },
): boolean {
  if (!variantIds || variantIds.length === 0) return false
  const byId = new Map<
    string,
    { serviceId: string; name: string; synonyms: string[]; audience: VariantAudience }
  >()
  for (const s of opts.services) {
    for (const z of s.zones) {
      if (!z.active) continue
      byId.set(z.id, {
        serviceId: s.id,
        name: z.name,
        synonyms: z.synonyms ?? [],
        audience: z.audience,
      })
    }
  }
  const zones = variantIds.map((id) => byId.get(id)).filter((z): z is NonNullable<typeof z> => Boolean(z))
  if (zones.length !== variantIds.length) return false
  if (new Set(zones.map((z) => z.serviceId)).size !== 1) return false
  if (variantAudiencesConflict(zones)) return false
  for (const z of zones) {
    if (!textCitesNameOrSynonym(opts.turnText, z.name, z.synonyms)) return false
  }
  return true
}

/**
 * Catálogo visto pelo léxico da sombra: serviço e linha do quadro (funil),
 * para não misturar Axila M+F quando a cliente já escolheu a linha.
 */
export function servicesForShadowRule(
  services: readonly ServiceRow[],
  frame: { serviceId?: string | null; line?: AudienceLine | null } | null | undefined,
): ServiceRow[] {
  const serviceId = frame?.serviceId ?? null
  const line = frame?.line ?? null
  let list = [...services]
  if (serviceId) list = list.filter((s) => s.id === serviceId)
  if (!line) return list
  return list.map((s) => ({
    ...s,
    zones: zonesForAudienceLine(s.zones, line),
  }))
}
