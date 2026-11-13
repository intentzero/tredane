/**
 * Opções agrupadas por nome na ficha do serviço (DEC-176).
 * Cada par nome + público continua a ser uma variante gravada (DEC-079); a
 * ficha só as mostra juntas e grava nome e sinônimos em todas as do grupo.
 * Puro, sem React.
 */
import type { ClinicService } from '../../api'
import { formatPriceCents, parsePriceToCents } from './format'
import type { VariantAudience, ZoneDraft } from './VariantCatalog'

/** Igual ao `foldSynonym` do servidor: sem acentos, minúsculas, sem espaços nas pontas. */
export function foldWord(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

export type VariantGroup = {
  /** Nome dobrado; identifica o grupo dentro do serviço. */
  key: string
  name: string
  members: ZoneDraft[]
}

const AUDIENCE_ORDER: Record<VariantAudience, number> = { ambos: 0, feminino: 1, masculino: 2 }

/** Agrupa pelo nome, na ordem em que cada nome aparece pela primeira vez. */
export function groupZones(zones: readonly ZoneDraft[]): VariantGroup[] {
  const groups: VariantGroup[] = []
  const byKey = new Map<string, VariantGroup>()
  for (const zone of zones) {
    const key = foldWord(zone.name) || `#${zone.key}`
    let group = byKey.get(key)
    if (!group) {
      group = { key, name: zone.name.trim(), members: [] }
      byKey.set(key, group)
      groups.push(group)
    }
    group.members.push(zone)
  }
  for (const group of groups) {
    group.members.sort((a, b) => AUDIENCE_ORDER[a.audience] - AUDIENCE_ORDER[b.audience])
  }
  return groups
}

/** Sinônimos do grupo, sem repetir (as variantes do grupo costumam ter os mesmos). */
export function groupSynonyms(group: VariantGroup): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const member of group.members) {
    for (const syn of member.synonyms) {
      const key = foldWord(syn)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(syn)
    }
  }
  return out
}

const SHORT: Record<VariantAudience, string> = { ambos: 'Todos', feminino: 'Fem.', masculino: 'Masc.' }

function timeAndPrice(zone: ZoneDraft): string {
  const cents = parsePriceToCents(zone.price)
  return `${zone.durationMinutes} min · ${cents != null ? formatPriceCents(cents) : 'sem preço'}`
}

/** «10 min · R$ 50,00», «Fem. 10 min · R$ 50,00; Masc. 10 min · R$ 50,00» ou «Só fem. …». */
export function groupPriceLine(group: VariantGroup): string {
  const { members } = group
  if (members.length === 1) {
    const only = members[0]!
    const base = timeAndPrice(only)
    const lead = only.audience === 'ambos' ? base : `Só ${SHORT[only.audience].toLowerCase()} ${base}`
    return only.active ? lead : `${lead} · inativa`
  }
  return members
    .map((m) => `${SHORT[m.audience]} ${m.active ? timeAndPrice(m) : 'inativa'}`)
    .join('; ')
}

/** Todas as variantes do grupo estão fora de uso. */
export function groupInactive(group: VariantGroup): boolean {
  return group.members.every((m) => !m.active)
}

/** Uma palavra (nome ou sinônimo) que a IA liga a um sítio do catálogo. */
export type WordClaim = {
  folded: string
  word: string
  /** «Depilação» ou «Depilação › Axila». */
  owner: string
  /** Serviço + grupo; duas palavras do mesmo dono não colidem. */
  ownerKey: string
  /** Nome do catálogo (true) ou sinônimo (false). */
  isName: boolean
}

type ServiceLike = Pick<ClinicService, 'id' | 'name' | 'synonyms'> & {
  zones?: { name: string; synonyms?: string[] | null }[]
}

/** Nomes e sinônimos de um serviço e das suas opções, agrupadas pelo nome. */
export function serviceClaims(svc: ServiceLike): WordClaim[] {
  const claims: WordClaim[] = []
  const svcKey = `${svc.id}:`
  claims.push({ folded: foldWord(svc.name), word: svc.name, owner: svc.name, ownerKey: svcKey, isName: true })
  for (const syn of svc.synonyms ?? []) {
    claims.push({ folded: foldWord(syn), word: syn, owner: svc.name, ownerKey: svcKey, isName: false })
  }
  for (const zone of svc.zones ?? []) {
    const ownerKey = `${svc.id}:${foldWord(zone.name)}`
    const owner = `${svc.name} › ${zone.name.trim()}`
    claims.push({ folded: foldWord(zone.name), word: zone.name, owner, ownerKey, isName: true })
    for (const syn of zone.synonyms ?? []) {
      claims.push({ folded: foldWord(syn), word: syn, owner, ownerKey, isName: false })
    }
  }
  return claims
}

/**
 * Onde mais a palavra já está, para avisar antes de gravar. Igual à regra do
 * servidor: sinônimo não repete nome nem sinônimo de outro dono; o próprio
 * nome do dono não conta.
 */
export function claimedElsewhere(
  word: string,
  ownerKey: string,
  claims: readonly WordClaim[],
): string | null {
  const key = foldWord(word)
  if (!key) return null
  const hit = claims.find((c) => c.folded === key && c.ownerKey !== ownerKey)
  return hit ? hit.owner : null
}

/** Palavra que aparece em dois donos (pelo menos um como sinônimo). */
export function collisionsOf(
  ownerKey: string,
  claims: readonly WordClaim[],
): { word: string; other: string }[] {
  const mine = claims.filter((c) => c.ownerKey === ownerKey)
  const out: { word: string; other: string }[] = []
  const seen = new Set<string>()
  for (const claim of mine) {
    if (seen.has(claim.folded)) continue
    const other = claims.find(
      (c) =>
        c.folded === claim.folded && c.ownerKey !== ownerKey && !(c.isName && claim.isName),
    )
    if (other) {
      seen.add(claim.folded)
      out.push({ word: claim.word, other: other.owner })
    }
  }
  return out
}
