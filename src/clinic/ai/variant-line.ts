/**
 * Pergunta de linha antes das zonas (detalhe de DEC-078 / DEC-075, Paulo, 31/10/2026).
 * A linha só entra por texto explícito (feminina/masculina/feminino/masculino) ou pela sessão da conversa.
 * Copy via catálogo M4 (#448): perguntar_linha / perguntar_variantes.
 */
import { variantChoiceLabel } from '../config/zones'
import type { VariantAudience } from '../config/types'
import { sayAct } from './dialogue-acts'

export type AudienceLine = 'feminino' | 'masculino'

type ListedZone = {
  id?: string
  name: string
  audience?: string | null
  durationMinutes: number
  priceCents?: number | null
}

function asAudience(value: string | null | undefined): VariantAudience {
  return value === 'feminino' || value === 'masculino' || value === 'ambos' ? value : 'ambos'
}

/** Há variantes femininas e masculinas ativas ao mesmo tempo. */
export function needsAudienceLine(zones: readonly { audience?: string | null }[]): boolean {
  let feminino = false
  let masculino = false
  for (const zone of zones) {
    if (zone.audience === 'feminino') feminino = true
    if (zone.audience === 'masculino') masculino = true
  }
  return feminino && masculino
}

/** Linha escolhida, mais as variantes «ambos». Sem linha, devolve a lista inteira. */
export function zonesForAudienceLine<T extends { audience?: string | null }>(
  zones: readonly T[],
  line: AudienceLine | null,
): T[] {
  if (line == null) return [...zones]
  return zones.filter((zone) => zone.audience === line || zone.audience === 'ambos')
}

export function audienceLineQuestion(serviceName: string, conversationId = ''): string {
  const serviço = serviceName.trim()
  const fallback = `${serviço} feminina ou masculina?`
  return sayAct('perguntar_linha', conversationId, { serviço }, fallback)
}

function zoneKey(zone: ListedZone): string {
  if (zone.id) return `id:${zone.id}`
  const name = zone.name.trim().toLocaleLowerCase('pt-BR')
  return `k:${name}\0${zone.audience ?? ''}\0${zone.durationMinutes}\0${zone.priceCents ?? ''}`
}

/** Uma entrada por id. O mesmo nome na mesma audiência leva rótulo estável (género, duração, preço). */
export function stableVariantLabelList(zones: readonly ListedZone[]): string[] {
  const seen = new Set<string>()
  const unique: ListedZone[] = []
  for (const zone of zones) {
    const key = zoneKey(zone)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(zone)
  }
  const peers = unique.map((zone) => ({
    name: zone.name,
    audience: asAudience(zone.audience),
    durationMinutes: zone.durationMinutes,
    priceCents: zone.priceCents ?? null,
  }))
  return unique.map((zone, index) => variantChoiceLabel(peers[index]!, peers))
}

/** «zona» → qual zona; «zonas» → quais zonas. ponytail: plural pelo «s» final; «lápis» cai em quais. */
function whichKind(kind: string): string {
  const word = kind.trim().toLocaleLowerCase('pt-BR') || 'zona'
  const plural = word.length > 3 && word.endsWith('s')
  return `${plural ? 'quais' : 'qual'} ${word}`
}

/** Tipo no singular/plural do cadastro, em minúsculas (placeholder `{tipo}`). */
export function variantTipoWord(variantKind: string | null | undefined): string {
  return (variantKind ?? 'zona').trim().toLocaleLowerCase('pt-BR') || 'zona'
}

export function variantListQuestion(
  serviceName: string,
  variantKind: string | null | undefined,
  zones: readonly ListedZone[],
  conversationId = '',
  opts: { assunto?: string } = {},
): string {
  const serviço = serviceName.trim()
  const tipo = variantTipoWord(variantKind)
  const lista = stableVariantLabelList(zones).join(', ')
  const fallback = `Para ${serviço}, ${whichKind(variantKind ?? '')} você quer? Temos ${lista}.`
  const vars: Record<string, string | undefined> = { serviço, tipo, lista }
  if (opts.assunto?.trim()) vars.assunto = opts.assunto.trim()
  // Sem hora: não usar a redação «Para fechar às {hora}».
  return sayAct('perguntar_variantes', conversationId, vars, fallback, {
    avoidInTemplate: ['{hora}'],
  })
}
