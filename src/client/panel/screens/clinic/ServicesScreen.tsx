import { useState } from 'react'
import { Button, Input, Label, NumberField, Radio, RadioGroup, TextArea, TextField } from 'react-aria-components'
import { ChevronRight, TriangleAlert } from 'lucide-react'
import { suggestVariantKindPlural } from '../../../../clinic/catalog/variant-kind'
import { ComboCatalog, type ComboDraft } from './ComboCatalog'
import { VariantCatalog, type ZoneDraft } from './VariantCatalog'
import { Badge } from '../../states/Badge'
import { ClinicCheck } from './ClinicCheck'
import { ClinicListHeader } from './ClinicListHeader'
import { serviceRow } from './resourceRows'
import { PanelSelect } from '../../ui/PanelSelect'
import type {
  ClinicConfigSnapshot,
  ClinicService,
  PanelApi,
  ServiceUpsertBody,
  ServiceZoneInput,
} from '../../api'
import { PanelApiError } from '../../api'
import { navigatePanel } from '../../routes'
import {
  bufferOptions,
  formatPriceCents,
  parsePriceToCents,
} from './format'
import { friendlyError } from '../../copy/errors'
import { DeleteServiceDialog } from './ResourceLifecycleDialogs'
import { fromWeekDraft, toWeekDraft, type WeekDraft } from './clinicHours'
import { WeekEditor } from './WeekEditor'
import { RuleRow } from './RuleRow'
import { TempoSheet, tempoSummary } from './TempoSheet'

/** Preço que o sinal percentual enxerga: a linha, ou a soma das variantes em uso. */
function signalBaseCents(withVariants: boolean, price: string, zones: ZoneDraft[]): number | null {
  if (!withVariants) {
    const cents = parsePriceToCents(price)
    return cents != null && cents > 0 ? cents : null
  }
  const active = zones.filter((z) => z.active)
  if (active.length === 0) return null
  let sum = 0
  for (const zone of active) {
    const cents = parsePriceToCents(zone.price)
    if (cents == null) return null
    sum += cents
  }
  return sum > 0 ? sum : null
}

type ListProps = {
  tenantId: string
  snap: ClinicConfigSnapshot
}

export function ServicesList({ tenantId, snap }: ListProps) {
  const [showInactive, setShowInactive] = useState(false)
  const inactiveCount = snap.services.filter((s) => !s.active).length
  const activeCount = snap.services.length - inactiveCount
  const items = showInactive ? snap.services : snap.services.filter((s) => s.active)
  return (
    <div className="clinic-stack">
      <div className="clinic-toolbar clinic-desktop-hide">
        <Button
          className="panel-btn panel-btn-ghost"
          onPress={() =>
            navigatePanel({ kind: 'area', area: 'clinica', tenantId, section: 'hub' })
          }
        >
          Voltar
        </Button>
      </div>
      <ClinicListHeader
        count={`${activeCount} ${activeCount === 1 ? 'serviço ativo' : 'serviços ativos'}`}
        switchLabel={`Mostrar inativos${inactiveCount > 0 ? ` (${inactiveCount})` : ''}`}
        showInactive={showInactive}
        onShowInactive={setShowInactive}
        addLabel="Adicionar serviço"
        onAdd={() =>
          navigatePanel({
            kind: 'area',
            area: 'clinica',
            tenantId,
            section: 'servico',
            entityId: 'novo',
          })
        }
      />
      <ul className="clinic-nav-list">
        {items.map((svc) => {
          const row = serviceRow(snap, svc)
          return (
            <li key={svc.id}>
              <Button
                className="clinic-nav-row"
                onPress={() =>
                  navigatePanel({
                    kind: 'area',
                    area: 'clinica',
                    tenantId,
                    section: 'servico',
                    entityId: svc.id,
                  })
                }
              >
                <span className="clinic-nav-copy">
                  <strong>{svc.name}</strong>
                  <span>{row.occupies}</span>
                  <span>{row.detail}</span>
                </span>
                {!svc.active ? <Badge tone="closed">Inativo</Badge> : null}
                {svc.active && row.warning ? <Badge tone="wait">{row.warning}</Badge> : null}
                <ChevronRight aria-hidden size={18} />
              </Button>
            </li>
          )
        })}
        {items.length === 0 ? (
          <li className="clinic-empty">
            {inactiveCount > 0 && !showInactive
              ? 'Nenhum serviço ativo. Ligue «Mostrar inativos» para ver o histórico.'
              : 'Nenhum serviço cadastrado ainda.'}
          </li>
        ) : null}
      </ul>
    </div>
  )
}

type FormProps = {
  tenantId: string
  entityId: string
  snap: ClinicConfigSnapshot
  api: PanelApi
  generation: number
  onSaved: () => Promise<void>
}

export function ServiceForm({
  tenantId,
  entityId,
  snap,
  api,
  generation,
  onSaved,
}: FormProps) {
  const existing = entityId === 'novo' ? null : snap.services.find((s) => s.id === entityId)
  const professionals = snap.resources.filter((r) => r.kind === 'professional')
  const rooms = snap.resources.filter((r) => r.kind === 'room')
  const equipment = snap.resources.filter((r) => r.kind === 'equipment' && r.active)

  const [name, setName] = useState(existing?.name ?? '')
  const [duration, setDuration] = useState(existing?.durationMinutes ?? 60)
  const [buffer, setBuffer] = useState(existing?.bufferMinutes ?? 15)
  const [audiencia, setAudiencia] = useState<'feminino' | 'masculino' | 'qualquer'>(
    existing?.audiencia === 'feminino' || existing?.audiencia === 'masculino'
      ? existing.audiencia
      : 'qualquer',
  )
  const [tempoCeu, setTempoCeu] = useState<'tanto_faz' | 'sol' | 'chuva'>(
    existing?.tempoCeu === 'sol' || existing?.tempoCeu === 'chuva' ? existing.tempoCeu : 'tanto_faz',
  )
  const [tempoTemperatura, setTempoTemperatura] = useState<'tanto_faz' | 'acima' | 'abaixo'>(
    existing?.tempoTemperatura === 'acima' || existing?.tempoTemperatura === 'abaixo'
      ? existing.tempoTemperatura
      : 'tanto_faz',
  )
  const [tempoCelsius, setTempoCelsius] = useState<number | null>(existing?.tempoCelsius ?? null)
  const [price, setPrice] = useState(
    existing?.priceCents != null ? formatPriceCents(existing.priceCents) : '',
  )
  const [variantKind, setVariantKind] = useState(existing?.variantKind ?? '')
  const [variantKindPlural, setVariantKindPlural] = useState(
    existing?.variantKindPlural ?? (existing?.variantKind ? suggestVariantKindPlural(existing.variantKind) : ''),
  )
  const [pluralTouched, setPluralTouched] = useState(Boolean(existing?.variantKindPlural))
  const [zones, setZones] = useState<ZoneDraft[]>(() =>
    (existing?.zones ?? []).map((z) => ({
      key: z.id,
      id: z.id,
      name: z.name,
      durationMinutes: z.durationMinutes,
      price: z.priceCents != null ? formatPriceCents(z.priceCents) : '',
      audience: z.audience === 'feminino' || z.audience === 'masculino' ? z.audience : 'ambos',
      active: z.active,
    })),
  )
  const [combos, setCombos] = useState<ComboDraft[]>(() =>
    (existing?.combos ?? []).map((c) => ({
      key: c.id,
      id: c.id,
      name: c.name,
      price: formatPriceCents(c.priceCents),
      zoneKeys: c.zoneIds,
      active: c.active,
    })),
  )
  const [withVariants, setWithVariants] = useState((existing?.zones?.length ?? 0) > 0)
  const [explanation, setExplanation] = useState(existing?.clientExplanation ?? '')
  const [active, setActive] = useState(existing?.active ?? true)
  const [requiresSignal, setRequiresSignal] = useState(existing?.requiresSignal ?? false)
  const [signalKind, setSignalKind] = useState<'fixed' | 'percent'>(
    existing?.signalKind === 'percent' ? 'percent' : 'fixed',
  )
  const [signalFixed, setSignalFixed] = useState(
    existing?.signalFixedCents != null
      ? formatPriceCents(existing.signalFixedCents)
      : '',
  )
  const [signalPercent, setSignalPercent] = useState(
    existing?.signalPercent != null ? String(existing.signalPercent) : '30',
  )
  // Serviço novo: todas as profissionais ativas fazem, até a dona desmarcar.
  const [proIds, setProIds] = useState<string[]>(
    existing?.professionalIds ?? professionals.filter((p) => p.active).map((p) => p.id),
  )
  const [space, setSpace] = useState<'unset' | 'none' | 'rooms'>(
    !existing ? 'unset' : existing.roomRequirement.mode === 'rooms' ? 'rooms' : 'none',
  )
  const [roomIds, setRoomIds] = useState<string[]>(
    existing?.roomRequirement.mode === 'rooms' ? existing.roomRequirement.resourceIds : [],
  )
  const [equipmentId, setEquipmentId] = useState<string | null>(
    existing?.equipmentResourceId ?? null,
  )
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [hoursDraft, setHoursDraft] = useState<WeekDraft>(() =>
    toWeekDraft(
      (existing?.weeklyWindows ?? []).map((w, i) => ({
        id: `sw${i}`,
        resourceId: '',
        dayOfWeek: w.dayOfWeek,
        startMinute: w.startMinute,
        endMinute: w.endMinute,
      })),
    ),
  )

  async function confirmDelete() {
    if (!existing) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await api.deleteService(tenantId, existing.id, {
        generation,
        expectGeneration: () => generation,
      })
      setDeleteOpen(false)
      await onSaved()
      navigatePanel({ kind: 'area', area: 'clinica', tenantId, section: 'servicos' })
    } catch (err) {
      if (err instanceof PanelApiError && err.message === 'stale_tenant_response') return
      setDeleteError(friendlyError(err, 'Não foi possível apagar. Tente de novo.'))
    } finally {
      setDeleting(false)
    }
  }

  const occupied = duration + buffer
  const signalBase = signalBaseCents(withVariants, price, zones)
  const hasFemale = zones.some((z) => z.active && z.audience === 'feminino')
  const hasMale = zones.some((z) => z.active && z.audience === 'masculino')
  const audienceConflict =
    withVariants && ((audiencia === 'masculino' && hasFemale) || (audiencia === 'feminino' && hasMale))
  const [spaceError, setSpaceError] = useState<string | null>(null)
  const [tempoOpen, setTempoOpen] = useState(false)
  const [openRule, setOpenRule] = useState<
    null | 'intervalo' | 'audiencia' | 'sinal' | 'horas' | 'explicacao' | 'equipamento'
  >(null)
  const roomNames = roomIds
    .map((id) => rooms.find((r) => r.id === id)?.name)
    .filter((name): name is string => Boolean(name))
    .sort((a, b) => a.localeCompare(b, 'pt-BR'))
  const audienciaLabel =
    audiencia === 'feminino' ? 'Feminino' : audiencia === 'masculino' ? 'Masculino' : 'Qualquer'
  const signalLabel = !requiresSignal
    ? 'Sem sinal'
    : signalKind === 'percent'
      ? `${signalPercent}% do preço`
      : signalFixed.trim()
        ? `Fixo ${signalFixed}`
        : 'Valor fixo'
  const hoursOpenCount = Object.values(hoursDraft).filter((d) => (d?.length ?? 0) > 0).length
  const hoursLabel =
    hoursOpenCount === 0 ? 'Qualquer dia com profissional livre' : `${hoursOpenCount} dia(s) com janela`
  const toggleRule = (
    id: 'intervalo' | 'audiencia' | 'sinal' | 'horas' | 'explicacao' | 'equipamento',
  ) => setOpenRule((cur) => (cur === id ? null : id))

  async function save() {
    setFormError(null)
    setSpaceError(null)
    if (
      tempoTemperatura !== 'tanto_faz' &&
      (tempoCelsius == null || !Number.isInteger(tempoCelsius))
    ) {
      setFormError('Informe os graus em número inteiro.')
      setTempoOpen(true)
      return
    }
    if (space === 'unset' || (space === 'rooms' && roomIds.length === 0)) {
      setSpaceError('Escolha uma ou mais salas, ou Sem espaço definido. O que você digitou continua aqui.')
      return
    }
    setSaving(true)
    // Com variantes o preço da linha fica escondido; a marcação usa a soma das variantes.
    const priceCents = withVariants ? null : parsePriceToCents(price)
    const body: ServiceUpsertBody = {
      name,
      durationMinutes: duration,
      bufferMinutes: buffer,
      audiencia,
      priceCents,
      clientExplanation: explanation.trim() || null,
      active,
      professionalIds: proIds,
      roomRequirement:
        space === 'none' ? { mode: 'none' } : { mode: 'rooms', resourceIds: roomIds },
      equipmentResourceId: equipmentId,
      requiresSignal,
      signalKind: requiresSignal ? signalKind : null,
      signalFixedCents:
        requiresSignal && signalKind === 'fixed'
          ? parsePriceToCents(signalFixed)
          : null,
      signalPercent:
        requiresSignal && signalKind === 'percent'
          ? Number.parseInt(signalPercent, 10) || null
          : null,
      weeklyWindows: fromWeekDraft(hoursDraft),
      tempoCeu,
      tempoTemperatura,
      tempoCelsius: tempoTemperatura === 'tanto_faz' ? null : tempoCelsius,
      variantKind: (withVariants ? zones : []).length > 0 ? variantKind.trim() || null : null,
      variantKindPlural: (withVariants ? zones : []).length > 0 ? variantKindPlural.trim() || null : null,
    }
    const draftZones = withVariants ? zones : []
    if (withVariants && draftZones.length === 0) {
      setFormError('Adicione ao menos uma variante. O que você digitou continua aqui.')
      setSaving(false)
      return
    }
    if (draftZones.length > 0 && (!variantKind.trim() || !variantKindPlural.trim())) {
      setFormError('Dê o singular e o plural do tipo. O que você digitou continua aqui.')
      setSaving(false)
      return
    }
    if (draftZones.some((z) => !z.name.trim())) {
      setFormError('Dê um nome a cada variante. O que você digitou continua aqui.')
      setSaving(false)
      return
    }
    if (requiresSignal && signalKind === 'percent' && signalBase == null) {
      setFormError('Cadastre o preço antes do sinal percentual. O que você digitou continua aqui.')
      setSaving(false)
      return
    }
    const hadZones = (existing?.zones?.length ?? 0) > 0
    const zoneBody: ServiceZoneInput[] = draftZones.map((z) => ({
      id: z.id,
      name: z.name.trim(),
      durationMinutes: z.durationMinutes,
      priceCents: z.price.trim() ? parsePriceToCents(z.price) : null,
      audience: z.audience,
      active: z.active,
    }))
    const zoneKeys = new Set(draftZones.map((z) => z.key))
    const draftCombos = withVariants
      ? combos.map((c) => ({ ...c, zoneKeys: c.zoneKeys.filter((key) => zoneKeys.has(key)) }))
      : []
    const small = draftCombos.find((c) => c.zoneKeys.length < 2)
    if (small) {
      setFormError(
        `O combo «${small.name.trim() || 'sem nome'}» precisa de pelo menos 2 variantes. Complete ou remova. O que você digitou continua aqui.`,
      )
      setSaving(false)
      return
    }
    if (draftCombos.some((c) => !c.name.trim() || (parsePriceToCents(c.price) ?? 0) <= 0)) {
      setFormError('Dê nome e preço a cada combo. O que você digitou continua aqui.')
      setSaving(false)
      return
    }
    const hadCombos = (existing?.combos?.length ?? 0) > 0
    try {
      // Limpar o tipo com variantes ainda gravadas deixa o cadastro inconsistente.
      if (zoneBody.length === 0 && hadZones && existing) {
        await api.replaceServiceZones(tenantId, existing.id, [], {
          generation,
          expectGeneration: () => generation,
        })
      }
      const saved = await api.upsertService(tenantId, body, {
        serviceId: existing?.id,
        generation,
        expectGeneration: () => generation,
      })
      let zonesSaved: ClinicService | null = null
      if (zoneBody.length > 0) {
        try {
          zonesSaved = await api.replaceServiceZones(tenantId, saved.id, zoneBody, {
            generation,
            expectGeneration: () => generation,
          })
        } catch (zoneErr) {
          if (!hadZones) {
            await api
              .upsertService(
                tenantId,
                {
                  ...body,
                  variantKind: null,
                  variantKindPlural: null,
                  priceCents: existing?.priceCents ?? null,
                },
                {
                  serviceId: saved.id,
                  generation,
                  expectGeneration: () => generation,
                },
              )
              .catch(() => {})
          }
          throw zoneErr
        }
      }
      if (zoneBody.length > 0 && (draftCombos.length > 0 || hadCombos)) {
        const idByName = new Map(
          (zonesSaved?.zones ?? []).map((z) => [z.name.trim().toLocaleLowerCase('pt-BR'), z.id]),
        )
        const idOfKey = (key: string): string | null => {
          const draft = draftZones.find((z) => z.key === key)
          if (!draft) return null
          return draft.id ?? idByName.get(draft.name.trim().toLocaleLowerCase('pt-BR')) ?? null
        }
        await api.replaceServiceCombos(
          tenantId,
          saved.id,
          draftCombos.map((c) => ({
            id: c.id,
            name: c.name.trim(),
            priceCents: parsePriceToCents(c.price) ?? 0,
            zoneIds: c.zoneKeys.map(idOfKey).filter((id): id is string => id != null),
            active: c.active,
          })),
          { generation, expectGeneration: () => generation },
        )
      }
      await onSaved()
      navigatePanel({ kind: 'area', area: 'clinica', tenantId, section: 'servicos' })
    } catch (err) {
      if (err instanceof PanelApiError && err.message === 'stale_tenant_response') return
      // Falha não apaga o formulário (critério #28).
      setFormError(
        `${friendlyError(err, 'Não foi possível salvar.')} O que você digitou continua aqui.`,
      )
    } finally {
      setSaving(false)
    }
  }

  const serviceCount = snap.services.length

  return (
    <div className="clinic-stack clinic-form">
      <header className="clinic-page-head clinic-desktop-hide">
        <Button
          className="panel-icon-btn"
          aria-label="Voltar"
          onPress={() =>
            navigatePanel({ kind: 'area', area: 'clinica', tenantId, section: 'servicos' })
          }
        >
          ‹
        </Button>
        <div className="clinic-page-head-copy">
          <h1 className="panel-title">{existing ? 'Editar serviço' : 'Novo serviço'}</h1>
          <span className="panel-subtitle">
            Serviços · {serviceCount} {serviceCount === 1 ? 'cadastrado' : 'cadastrados'}
          </span>
        </div>
      </header>
      <TextField className="clinic-field">
        <Label>Nome</Label>
        <Input autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
      </TextField>
      <section className="clinic-stack" aria-labelledby="svc-price">
        <div className="vc-head">
          <h2 id="svc-price" className="clinic-section-title">
            Preço e duração
          </h2>
          <RadioGroup
            className="vc-seg"
            aria-label="Formato do serviço"
            orientation="horizontal"
            value={withVariants ? 'variantes' : 'unica'}
            onChange={(v) => setWithVariants(v === 'variantes')}
          >
            <Radio value="unica" className="vc-seg-item">
              Opção única
            </Radio>
            <Radio value="variantes" className="vc-seg-item">
              Com variantes
            </Radio>
          </RadioGroup>
        </div>
        {withVariants ? (
          <>
          <VariantCatalog
            singular={variantKind}
            plural={variantKindPlural}
            pluralTouched={pluralTouched}
            onSingular={(value) => {
              setVariantKind(value)
              if (!pluralTouched) setVariantKindPlural(suggestVariantKindPlural(value))
            }}
            onPlural={(value) => {
              setVariantKindPlural(value)
              setPluralTouched(true)
            }}
            zones={zones}
            onZones={(update) => setZones(update)}
            seed={{ durationMinutes: duration, price }}
          />
          <ComboCatalog
            singular={variantKind}
            plural={variantKindPlural}
            zones={zones}
            combos={combos}
            onCombos={(update) => setCombos(update)}
          />
          </>
        ) : (
          <>
            <div className="clinic-field-row">
              <NumberField
                className="clinic-field"
                minValue={1}
                maxValue={24 * 60}
                step={1}
                formatOptions={{ maximumFractionDigits: 0 }}
                value={duration}
                onChange={(value) => {
                  if (Number.isInteger(value) && value >= 1 && value <= 24 * 60) setDuration(value)
                }}
              >
                <Label>Duração (min)</Label>
                <Input />
              </NumberField>
              <TextField className="clinic-field">
                <Label>Preço (opcional)</Label>
                <Input
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  inputMode="decimal"
                  placeholder="R$ 0,00"
                />
              </TextField>
            </div>
            <p className="clinic-footnote">
              Sem preço, a IA não informa valor: sugere que a equipe vai confirmar.
            </p>
            {zones.length > 0 ? (
              <p className="clinic-hint-box">
                As variantes já cadastradas ficam guardadas, mas não valem enquanto o serviço for opção
                única. Ao salvar, elas só saem se nunca entraram numa visita.
              </p>
            ) : null}
          </>
        )}
      </section>
      {audienceConflict ? (
        <p className="clinic-warn" role="status">
          <TriangleAlert aria-hidden size={16} />
          <span>
            O serviço está como {audiencia}, e há variantes só para{' '}
            {audiencia === 'masculino' ? 'feminino' : 'masculino'}. A audiência do serviço não esconde
            essas variantes.
          </span>
        </p>
      ) : null}

      <section className="clinic-section" aria-labelledby="svc-who">
        <h2 id="svc-who" className="clinic-section-title">
          Quem faz
        </h2>
        <div className="block-form-chips" role="group" aria-label="Quem faz este serviço">
          {professionals.map((p) => (
            <button
              key={p.id}
              type="button"
              className="block-form-chip"
              aria-pressed={proIds.includes(p.id)}
              onClick={() =>
                setProIds((prev) =>
                  prev.includes(p.id) ? prev.filter((id) => id !== p.id) : [...prev, p.id],
                )
              }
            >
              {p.name}
              {!p.active ? ' (inativa)' : ''}
            </button>
          ))}
        </div>
        {professionals.length === 0 ? (
          <p className="clinic-footnote">Cadastre profissionais primeiro; dá para voltar depois.</p>
        ) : null}
      </section>

      <section className="clinic-section" aria-labelledby="svc-where">
        <h2 id="svc-where" className="clinic-section-title">
          Onde acontece <span className="clinic-required">obrigatório</span>
        </h2>
        <div className="block-form-chips" role="group" aria-label="Onde acontece">
          <button
            type="button"
            className="block-form-chip"
            aria-pressed={space === 'none'}
            onClick={() => {
              setSpaceError(null)
              if (space === 'none') {
                setSpace('unset')
              } else {
                setSpace('none')
                setRoomIds([])
              }
            }}
          >
            Sem espaço definido
          </button>
          {rooms
            .filter((r) => r.active || roomIds.includes(r.id))
            .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
            .map((r) => (
              <button
                key={r.id}
                type="button"
                className="block-form-chip"
                aria-pressed={space === 'rooms' && roomIds.includes(r.id)}
                onClick={() => {
                  setSpaceError(null)
                  const selected = space === 'rooms' && roomIds.includes(r.id)
                  const next = selected
                    ? roomIds.filter((id) => id !== r.id)
                    : [...roomIds, r.id]
                  setRoomIds(next)
                  setSpace(next.length > 0 ? 'rooms' : 'unset')
                }}
              >
                {r.active ? r.name : `${r.name} (inativa)`}
              </button>
            ))}
        </div>
        <p className="clinic-footnote">
          A marcação nova ocupa a primeira sala livre desta lista, por ordem de nome. Sem espaço
          definido não ocupa sala.
        </p>
        {spaceError ? (
          <p className="clinic-form-error" role="alert">
            {spaceError}
          </p>
        ) : null}
      </section>

      <p className="clinic-hint-box" role="status" aria-label="Como fica na agenda">
        <strong>Como fica na agenda.</strong> Ocupa {occupied} min
        {withVariants
          ? ' (soma das variantes + intervalo uma vez)'
          : `: ${duration} de atendimento + ${buffer} de intervalo`}
        . Bloqueia a profissional
        {space === 'none'
          ? ' e não ocupa sala.'
          : roomNames.length > 0
            ? ` e uma sala livre de: ${roomNames.join(', ')}.`
            : '.'}
      </p>

      <div className="rule-list" role="list">
        <RuleRow
          label="Intervalo"
          value={buffer === 0 ? 'Nenhum' : `${buffer} min`}
          onPress={() => toggleRule('intervalo')}
        >
          {openRule === 'intervalo' ? (
            <PanelSelect
              className="clinic-field"
              label="Intervalo depois"
              value={String(buffer)}
              onChange={(v) => setBuffer(Number(v))}
              options={bufferOptions().map((m) => ({
                id: String(m),
                label: m === 0 ? 'Nenhum' : `${m} min`,
              }))}
            />
          ) : null}
        </RuleRow>
        <RuleRow
          label="Para quem"
          value={audienciaLabel}
          onPress={() => toggleRule('audiencia')}
        >
          {openRule === 'audiencia' ? (
            <>
              <PanelSelect
                className="clinic-field"
                label="Audiência"
                value={audiencia}
                onChange={(v) => {
                  if (v === 'feminino' || v === 'masculino' || v === 'qualquer') setAudiencia(v)
                }}
                options={[
                  { id: 'qualquer', label: 'Qualquer' },
                  { id: 'feminino', label: 'Feminino' },
                  { id: 'masculino', label: 'Masculino' },
                ]}
              />
              <p className="clinic-footnote">
                Descreve o serviço, não a pessoa. Um nome como «Bronzeamento feminino» não preenche
                este campo.
              </p>
            </>
          ) : null}
        </RuleRow>
        <RuleRow
          label="Sinal Pix"
          value={signalLabel}
          onPress={() => toggleRule('sinal')}
        >
          {openRule === 'sinal' ? (
            <fieldset className="clinic-fieldset">
              <legend className="visually-hidden">Sinal por Pix</legend>
              <ClinicCheck
                className="clinic-check"
                isSelected={requiresSignal}
                onChange={setRequiresSignal}
              >
                Exige sinal
              </ClinicCheck>
              {requiresSignal ? (
                <>
                  <PanelSelect
                    className="clinic-field"
                    label="Tipo"
                    value={signalKind}
                    onChange={(v) => setSignalKind(v === 'percent' ? 'percent' : 'fixed')}
                    options={[
                      { id: 'fixed', label: 'Valor fixo (R$)' },
                      {
                        id: 'percent',
                        label: 'Percentual do preço',
                        hint: signalBase ? undefined : 'Cadastre o preço primeiro',
                        disabled: !signalBase,
                      },
                    ]}
                  />
                  {signalKind === 'fixed' ? (
                    <TextField className="clinic-field">
                      <Label>Valor do sinal</Label>
                      <Input
                        value={signalFixed}
                        onChange={(e) => setSignalFixed(e.target.value)}
                        inputMode="decimal"
                        placeholder="R$ 0,00"
                      />
                    </TextField>
                  ) : (
                    <TextField className="clinic-field">
                      <Label>Percentual (1–100)</Label>
                      <Input
                        value={signalPercent}
                        onChange={(e) => setSignalPercent(e.target.value)}
                        inputMode="numeric"
                      />
                    </TextField>
                  )}
                  {signalKind === 'percent' && signalBase != null ? (
                    <p className="clinic-hint-box">
                      Resumo: sinal de{' '}
                      {formatPriceCents(
                        Math.trunc((signalBase * (Number.parseInt(signalPercent, 10) || 0)) / 100),
                      )}{' '}
                      ({signalPercent}% de {formatPriceCents(signalBase)}).
                    </p>
                  ) : null}
                </>
              ) : null}
            </fieldset>
          ) : null}
        </RuleRow>
        <RuleRow
          label="Tempo"
          value={tempoSummary({
            ceu: tempoCeu,
            temperatura: tempoTemperatura,
            celsius: tempoCelsius,
          })}
          onPress={() => setTempoOpen(true)}
        />
        <RuleRow
          label="Dias e horas"
          value={hoursLabel}
          onPress={() => toggleRule('horas')}
        >
          {openRule === 'horas' ? (
            <>
              <WeekEditor
                label="Quando este serviço pode ser prestado"
                value={hoursDraft}
                onChange={setHoursDraft}
              />
              <p className="clinic-footnote">
                Com todos os dias fechados, o serviço pode ser agendado em qualquer horário em que a
                profissional (e a sala, se houver) estiverem disponíveis.
              </p>
            </>
          ) : null}
        </RuleRow>
        <RuleRow
          label="Explicação IA"
          value={explanation.trim() ? 'Com texto para a IA' : 'Sem explicação'}
          onPress={() => toggleRule('explicacao')}
        >
          {openRule === 'explicacao' ? (
            <>
              <TextField className="clinic-field">
                <Label>Explicação para clientes (opcional)</Label>
                <TextArea
                  value={explanation}
                  onChange={(e) => setExplanation(e.target.value)}
                  rows={4}
                />
              </TextField>
              <p className="clinic-footnote">
                A IA usa só este texto para explicar o serviço. Não escreva promessas de resultado.
              </p>
            </>
          ) : null}
        </RuleRow>
        {equipment.length > 0 ? (
          <RuleRow
            label="Equipamento"
            value={
              equipmentId
                ? (equipment.find((e) => e.id === equipmentId)?.name ?? 'Escolhido')
                : 'Nenhum'
            }
            onPress={() => toggleRule('equipamento')}
          >
            {openRule === 'equipamento' ? (
              <PanelSelect
                className="clinic-field"
                label="Equipamento (opcional)"
                value={equipmentId ?? ''}
                onChange={(id) => setEquipmentId(id || null)}
                options={[
                  { id: '', label: 'Nenhum' },
                  ...equipment.map((r) => ({ id: r.id, label: r.name })),
                ]}
              />
            ) : null}
          </RuleRow>
        ) : null}
      </div>

      <ClinicCheck className="clinic-check clinic-check-card" isSelected={active} onChange={setActive}>
        Serviço ativo
      </ClinicCheck>
      <p className="clinic-footnote">Desativar não apaga compromissos já marcados.</p>
      {formError ? (
        <p className="clinic-form-error" role="alert">
          {formError}
        </p>
      ) : null}
      <div className="clinic-footer-actions">
        <Button
          className="panel-btn panel-btn-ghost clinic-desktop-hide"
          isDisabled={saving}
          onPress={() =>
            navigatePanel({ kind: 'area', area: 'clinica', tenantId, section: 'servicos' })
          }
        >
          Cancelar
        </Button>
        <Button
          className="panel-btn panel-btn-primary"
          isDisabled={saving || !name.trim()}
          onPress={() => void save()}
        >
          {saving ? 'Salvando…' : 'Salvar serviço'}
        </Button>
      </div>
      {existing ? (
        <section className="clinic-stack" aria-label="Apagar serviço">
          {existing.deletable === true ? (
            <Button
              className="panel-btn-danger"
              isDisabled={saving || deleting}
              onPress={() => {
                setDeleteError(null)
                setDeleteOpen(true)
              }}
            >
              Apagar serviço
            </Button>
          ) : (
            <p className="clinic-footnote">
              Este serviço já tem marcações (ou Pix/proposta ligada), por isso não pode ser
              apagado. Basta desativá-lo: sai de novos agendamentos e o histórico fica.
            </p>
          )}
        </section>
      ) : null}
      {existing ? (
        <DeleteServiceDialog
          open={deleteOpen}
          serviceName={existing.name}
          busy={deleting}
          error={deleteError}
          onClose={() => setDeleteOpen(false)}
          onConfirm={() => void confirmDelete()}
        />
      ) : null}
      <TempoSheet
        open={tempoOpen}
        onOpenChange={setTempoOpen}
        value={{ ceu: tempoCeu, temperatura: tempoTemperatura, celsius: tempoCelsius }}
        onChange={(next) => {
          setTempoCeu(next.ceu)
          setTempoTemperatura(next.temperatura)
          setTempoCelsius(next.celsius)
        }}
      />
    </div>
  )
}
