import { useMemo, useState, type ReactNode } from 'react'
import { Button, Input, SearchField } from 'react-aria-components'
import { Search, TriangleAlert } from 'lucide-react'
import { variantKindLabels } from '../../../../clinic/catalog/variant-kind'
import type { ClinicConfigSnapshot, ClinicService } from '../../api'
import { navigatePanel } from '../../routes'
import { formatPriceCents } from './format'
import type { ZoneDraft } from './VariantCatalog'
import {
  collisionsOf,
  foldWord,
  groupSynonyms,
  groupZones,
  serviceClaims,
} from './variantGroups'

type Row = {
  ownerKey: string
  serviceId: string
  title: string
  kind: string
  words: string[]
  warnings: { word: string; other: string }[]
}

function zoneDrafts(svc: ClinicService): ZoneDraft[] {
  return (svc.zones ?? []).map((z) => ({
    key: z.id,
    id: z.id,
    name: z.name,
    durationMinutes: z.durationMinutes,
    price: z.priceCents != null ? formatPriceCents(z.priceCents) : '',
    audience: z.audience,
    active: z.active,
    synonyms: z.synonyms ?? [],
  }))
}

/** Linhas da vista: cada serviço ativo e as suas opções, agrupadas pelo nome. */
export function wordRows(services: readonly ClinicService[]): Row[] {
  const claims = services.flatMap((s) => serviceClaims(s))
  const rows: Row[] = []
  for (const svc of services) {
    if (!svc.active) continue
    const svcKey = `${svc.id}:`
    rows.push({
      ownerKey: svcKey,
      serviceId: svc.id,
      title: svc.name,
      kind: 'Serviço',
      words: svc.synonyms ?? [],
      warnings: collisionsOf(svcKey, claims),
    })
    const kind = variantKindLabels(svc, 'Opção').singular
    for (const group of groupZones(zoneDrafts(svc).filter((z) => z.active))) {
      const ownerKey = `${svc.id}:${group.key}`
      rows.push({
        ownerKey,
        serviceId: svc.id,
        title: `${svc.name} › ${group.name}`,
        kind,
        words: groupSynonyms(group),
        warnings: collisionsOf(ownerKey, claims),
      })
    }
  }
  return rows
}

type Props = {
  tenantId: string
  snap: ClinicConfigSnapshot
  /** Palavras que clientes escreveram e a IA não reconheceu (DEC-141), só da responsável. */
  suggestions?: ReactNode
}

/**
 * «O que a IA reconhece» (DEC-176): todos os nomes do catálogo e as palavras
 * que a cliente pode usar para cada um, com aviso quando a mesma palavra está
 * em dois sítios.
 */
export function ServiceWords({ tenantId, snap, suggestions }: Props) {
  const [query, setQuery] = useState('')
  const rows = useMemo(() => wordRows(snap.services), [snap.services])
  const needle = foldWord(query)
  const shown = needle
    ? rows.filter(
        (r) => foldWord(r.title).includes(needle) || r.words.some((w) => foldWord(w).includes(needle)),
      )
    : rows
  const empty = rows.filter((r) => r.words.length === 0).length
  const clashes = rows.filter((r) => r.warnings.length > 0).length

  return (
    <div className="clinic-stack words">
      <header className="words-head">
        <div className="words-head-copy">
          <h2 className="clinic-section-title words-title">O que a IA reconhece</h2>
          <p className="clinic-footnote">
            Cada linha é um nome do catálogo e as palavras que a cliente pode usar para ele. A resposta
            usa sempre o nome do catálogo.
          </p>
        </div>
        <SearchField
          className="inbox-search clinic-search words-search"
          aria-label="Procurar palavra"
          value={query}
          onChange={setQuery}
        >
          <Search aria-hidden size={18} strokeWidth={2} className="inbox-search-icon" />
          <Input className="inbox-search-input" placeholder="Procurar uma palavra" autoComplete="off" />
        </SearchField>
      </header>
      {suggestions ?? null}
      <p className="words-count" role="status">
        {rows.length} {rows.length === 1 ? 'nome' : 'nomes'}
        {empty > 0 ? ` · ${empty} sem outras palavras` : ''}
        {clashes > 0 ? ` · ${clashes} com palavra repetida` : ''}
      </p>
      <ul className="words-list" aria-label="Nomes e palavras">
        {shown.map((row) => (
          <li
            key={row.ownerKey}
            className="words-row"
            data-kind={row.kind === 'Serviço' ? 'service' : 'option'}
            data-warn={row.warnings.length > 0 || undefined}
          >
            <span className="words-name">
              <strong>{row.title}</strong>
              <span>{row.kind}</span>
            </span>
            <span className="words-syn">
              <span data-empty={row.words.length === 0 || undefined}>
                {row.words.length > 0 ? row.words.join(', ') : 'Sem outras palavras'}
              </span>
              {row.warnings.map((w) => (
                <span key={w.word} className="words-warn">
                  <TriangleAlert aria-hidden size={14} />
                  «{w.word}» também está em {w.other}. Deixe a palavra num sítio só.
                </span>
              ))}
            </span>
            <Button
              className="panel-link-btn words-edit"
              aria-label={`Editar ${row.title}`}
              onPress={() =>
                navigatePanel({
                  kind: 'area',
                  area: 'clinica',
                  tenantId,
                  section: 'servico',
                  entityId: row.serviceId,
                })
              }
            >
              Editar
            </Button>
          </li>
        ))}
        {shown.length === 0 ? (
          <li className="clinic-empty">
            {needle ? 'Nenhum nome ou palavra com esse texto.' : 'Nenhum serviço ativo ainda.'}
          </li>
        ) : null}
      </ul>
    </div>
  )
}
