/**
 * Pergunta de linha antes das zonas (detalhe de DEC-078 / DEC-075, Paulo, 31/10/2026).
 * A linha só entra por texto explícito (feminina/masculina/feminino/masculino) ou pela sessão da conversa.
 * Copy via catálogo M4 (#448): perguntar_linha / perguntar_variantes.
 * DEC-145: modo `uma` usa o singular do cadastro e redações sem o convite multi.
 * Modo `varias` (Paulo 09/11/2026): só texto livre (ex. axila e pernas / todas); sem Opções.
 */
import { formatBRL } from '../../ai/prompt'
import { allowsMultipleVariants } from '../catalog/variant-selection'
import { variantChoiceLabel } from '../config/zones'
import type { ServiceRow, VariantAudience } from '../config/types'
import { MULTI_VARIANT_ASK_HINT, sayAct, serviceNameInProse } from './dialogue-acts'

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
  // `{serviço}` no catálogo passa por serviceNameInProse; o fallback também.
  const fallback = `${serviceNameInProse(serviceName, true)} feminina ou masculina?`
  return sayAct('perguntar_linha', conversationId, { serviço: serviceName }, fallback)
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
export function whichKind(kind: string): string {
  const word = kind.trim().toLocaleLowerCase('pt-BR') || 'zona'
  const plural = word.length > 3 && word.endsWith('s')
  return `${plural ? 'quais' : 'qual'} ${word}`
}

/** Tipo no singular/plural do cadastro, em minúsculas (placeholder `{tipo}`). */
export function variantTipoWord(variantKind: string | null | undefined): string {
  return (variantKind ?? 'zona').trim().toLocaleLowerCase('pt-BR') || 'zona'
}

/**
 * Nomes de variante na pergunta ask-tipo (frase corrida): minúsculas pt-BR.
 * Confirmado (Paulo, 08/11/2026): «Para massagem… Temos liberação miofascial, …».
 * Rótulos da lista Meta Opções e outros labels de catálogo ficam como no cadastro.
 */
export function variantListInProse(labels: readonly string[]): string {
  return labels
    .map((label) => label.trim().toLocaleLowerCase('pt-BR'))
    .filter((label) => label.length > 0)
    .join(', ')
}

/**
 * Rótulo `{tipo}` / whichKind: singular em modo `uma`, plural em `varias`.
 * DEC-145 — «qual tipo?» vs «quais tipos?».
 */
export function variantKindForAsk(
  service: Pick<ServiceRow, 'variantKind' | 'variantKindPlural' | 'variantSelection'>,
): string {
  if (!allowsMultipleVariants(service.variantSelection)) {
    return service.variantKind?.trim() || service.variantKindPlural?.trim() || 'opção'
  }
  return service.variantKindPlural?.trim() || service.variantKind?.trim() || 'opções'
}

/**
 * Linhas de preço/duração por variante (tabela de catálogo).
 * Usado na pesquisa de preço com o serviço aberto e ainda sem variante nomeada
 * («Quanto custa?», «Qual o valor…», «valores», «tabela») — não lista só os nomes.
 */
export function formatVariantPriceTable(zones: readonly ListedZone[]): string {
  const labels = stableVariantLabelList(zones)
  return zones
    .map((zone, index) => {
      const label = labels[index] ?? zone.name
      const preço =
        zone.priceCents == null ? 'a equipe confirma o valor' : formatBRL(zone.priceCents)
      return `${label} — ${preço} (${zone.durationMinutes} min)`
    })
    .join('\n')
}

export function variantListQuestion(
  serviceName: string,
  variantKind: string | null | undefined,
  zones: readonly ListedZone[],
  conversationId = '',
  opts: { assunto?: string; selectionMode?: ServiceRow['variantSelection'] } = {},
): string {
  const single = opts.selectionMode === 'uma'
  const serviçoProse = serviceNameInProse(serviceName)
  const tipo = variantTipoWord(variantKind)
  const lista = variantListInProse(stableVariantLabelList(zones))
  // DEC-145: catálogo M4 de perguntar_variantes é plural (máx. 5 redações) e inclui o
  // convite de texto livre. Modo `uma` usa a pergunta singular directa, sem o convite.
  // Paulo 08/11/2026: serviço + variantes em minúsculas; lista Opções Meta só em `uma`.
  const base = `Para ${serviçoProse}, ${whichKind(variantKind ?? '')} você quer? Temos ${lista}.`
  if (single) return base
  const fallback = `${base} ${MULTI_VARIANT_ASK_HINT}`
  const vars: Record<string, string | undefined> = {
    serviço: serviceName,
    tipo,
    lista,
  }
  if (opts.assunto?.trim()) vars.assunto = opts.assunto.trim()
  // Sem hora: não usar a redação «Para fechar às {hora}».
  return sayAct('perguntar_variantes', conversationId, vars, fallback, {
    avoidInTemplate: ['{hora}'],
  })
}
