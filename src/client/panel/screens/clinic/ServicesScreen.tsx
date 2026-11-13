import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button, Input, Label, NumberField, Radio, RadioGroup, SearchField, TextArea, TextField } from 'react-aria-components'
import { Check, ChevronRight, Minus, Search, TriangleAlert } from 'lucide-react'
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
import { setLeaveGuard } from '../../leaveGuard'
import { navigatePanel } from '../../routes'
import {
  bufferOptions,
  formatPriceCents,
  parsePriceToCents,
} from './format'
import { friendlyError } from '../../copy/errors'
import { useClinicPanelCloseGuard } from './ClinicPanel'
import { DeleteServiceDialog } from './ResourceLifecycleDialogs'
import { UnsavedChangesDialog } from './UnsavedChangesDialog'
import { fromWeekDraft, toWeekDraft, type WeekDraft } from './clinicHours'
import { WeekEditor } from './WeekEditor'
import { RuleRow } from './RuleRow'
import { SynonymsField } from './SynonymsField'
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

type ServiceDraftKeyInput = {
  name: string
  duration: number
  buffer: number
  audiencia: string
  tempoCeu: string
  tempoTemperatura: string
  tempoCelsius: number | null
  price: string
  variantKind: string
  variantKindPlural: string
  variantSelection: 'uma' | 'varias'
  withVariants: boolean
  zones: ZoneDraft[]
  combos: ComboDraft[]
  synonyms: string[]
  explanation: string
  active: boolean
  requiresSignal: boolean
  signalKind: string
  signalFixed: string
  signalPercent: string
  proIds: string[]
  space: string
  roomIds: string[]
  equipmentId: string | null
  hoursDraft: WeekDraft
}

/** Compara o rascunho da ficha com o que estava gravado ao abrir. */
function serviceDraftKey(input: ServiceDraftKeyInput): string {
  return JSON.stringify({
    name: input.name,
    duration: input.duration,
    buffer: input.buffer,
    audiencia: input.audiencia,
    tempoCeu: input.tempoCeu,
    tempoTemperatura: input.tempoTemperatura,
    tempoCelsius: input.tempoCelsius,
    price: input.price,
    variantKind: input.variantKind,
    variantKindPlural: input.variantKindPlural,
    variantSelection: input.variantSelection,
    withVariants: input.withVariants,
    zones: input.zones.map((z) => ({
      id: z.id ?? null,
      name: z.name,
      durationMinutes: z.durationMinutes,
      price: z.price,
      audience: z.audience,
      active: z.active,
      synonyms: z.synonyms,
    })),
    combos: input.combos.map((c) => ({
      id: c.id ?? null,
      name: c.name,
      price: c.price,
      zoneKeys: c.zoneKeys,
      active: c.active,
    })),
    synonyms: input.synonyms,
    explanation: input.explanation,
    active: input.active,
    requiresSignal: input.requiresSignal,
    signalKind: input.signalKind,
    signalFixed: input.signalFixed,
    signalPercent: input.signalPercent,
    proIds: [...input.proIds].sort(),
    space: input.space,
    roomIds: [...input.roomIds].sort(),
    equipmentId: input.equipmentId,
    hoursDraft: input.hoursDraft,
  })
}

type ListProps = {
  tenantId: string
  snap: ClinicConfigSnapshot
  /** Só a responsável: palavras não reconhecidas → sinónimo (DEC-141). */
  suggestions?: ReactNode
}

export function ServicesList({ tenantId, snap, suggestions }: ListProps) {
  const [showInactive, setShowInactive] = useState(false)
  const [query, setQuery] = useState('')
  const inactiveCount = snap.services.filter((s) => !s.active).length
  const activeCount = snap.services.length - inactiveCount
  const needle = query.trim().toLocaleLowerCase('pt-BR')
  const items = (showInactive ? snap.services : snap.services.filter((s) => s.active)).filter(
    (s) => !needle || s.name.toLocaleLowerCase('pt-BR').includes(needle),
  )
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
      {snap.services.length > 5 ? (
        // DEC-163: com muitos serviços, buscar pelo nome é mais rápido que rolar.
        <SearchField
          className="inbox-search clinic-search"
          aria-label="Buscar serviço"
          value={query}
          onChange={setQuery}
        >
          <Search aria-hidden size={18} strokeWidth={2} className="inbox-search-icon" />
          <Input className="inbox-search-input" placeholder="Buscar serviço" autoComplete="off" />
        </SearchField>
      ) : null}
      <ul className="clinic-nav-list clinic-service-list">
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
                  <span className="clinic-service-top">
                    <strong>{svc.name}</strong>
                    <b className="clinic-service-price">{row.price}</b>
                  </span>
                  <span>{row.summary}</span>
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
            {needle
              ? 'Nenhum serviço com esse nome.'
              : inactiveCount > 0 && !showInactive
              ? 'Nenhum serviço ativo. Ligue «Mostrar inativos» para ver o histórico.'
              : 'Nenhum serviço cadastrado ainda.'}
          </li>
        ) : null}
      </ul>
      {/* DEC-175: as sugestões chegam num segundo pedido; no fim, não empurram a lista. */}
      {suggestions ?? null}
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
  const [variantSelection, setVariantSelection] = useState<'uma' | 'varias'>(
    existing?.variantSelection === 'uma' ? 'uma' : 'varias',
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
      synonyms: z.synonyms ?? [],
    })),
  )
  const [synonyms, setSynonyms] = useState<string[]>(() => existing?.synonyms ?? [])
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
  const draftKey = serviceDraftKey({
    name,
    duration,
    buffer,
    audiencia,
    tempoCeu,
    tempoTemperatura,
    tempoCelsius,
    price,
    variantKind,
    variantKindPlural,
    variantSelection,
    withVariants,
    zones,
    combos,
    synonyms,
    explanation,
    active,
    requiresSignal,
    signalKind,
    signalFixed,
    signalPercent,
    proIds,
    space,
    roomIds,
    equipmentId,
    hoursDraft,
  })
  const baselineKey = useRef(draftKey)
  const dirty = draftKey !== baselineKey.current
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const pendingLeave = useRef<(() => void) | null>(null)
  const [unsavedOpen, setUnsavedOpen] = useState(false)

  useEffect(() => {
    setLeaveGuard({
      isDirty: () => dirtyRef.current,
      ask: (proceed) => {
        pendingLeave.current = proceed
        setUnsavedOpen(true)
      },
    })
    return () => {
      pendingLeave.current = null
      setLeaveGuard(null)
    }
  }, [])

  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  const panelCloseGuard = useMemo(
    () => ({
      isDirty: () => false,
      save: async () => {},
      prompt: 'delegate' as const,
    }),
    [],
  )
  useClinicPanelCloseGuard(panelCloseGuard)

  function stayOnForm() {
    pendingLeave.current = null
    setUnsavedOpen(false)
  }

  function leaveWithoutSaving() {
    const proceed = pendingLeave.current
    pendingLeave.current = null
    setUnsavedOpen(false)
    dirtyRef.current = false
    proceed?.()
  }

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
      dirtyRef.current = false
      navigatePanel({ kind: 'area', area: 'clinica', tenantId, section: 'servicos' })
    } catch (err) {
      if (err instanceof PanelApiError && err.message === 'stale_tenant_response') return
      setDeleteError(friendlyError(err, 'Não foi possível apagar. Tente de novo.'))
    } finally {
      setDeleting(false)
    }
  }

  // Alinha o checklist com o que o save aceita: preço opcional na linha, mas
  // obrigatório quando o sinal percentual precisa de base (DEC-047).
  const signalBase = signalBaseCents(withVariants, price, zones)
  const missingPrice = withVariants
    ? zones.filter((z) => z.active && parsePriceToCents(z.price) == null).length
    : 0
  const linePriceMissing = !withVariants && parsePriceToCents(price) == null
  const durationMissing = !withVariants && (!Number.isInteger(duration) || duration < 1)
  const priceRequiredForPercent =
    requiresSignal && signalKind === 'percent' && signalBase == null
  const readiness: {
    text: string
    state: 'ok' | 'warn' | 'opt'
    fix?: { label: string; run: () => void }
  }[] = [
    proIds.length > 0
      ? { state: 'ok', text: `${proIds.length} ${proIds.length === 1 ? 'profissional' : 'profissionais'}` }
      : { state: 'warn', text: 'Nenhuma profissional escolhida: ninguém recebe este serviço.' },
    space === 'unset' || (space === 'rooms' && roomIds.length === 0)
      ? { state: 'warn', text: 'Falta dizer onde acontece.' }
      : space === 'none'
        ? { state: 'ok', text: 'Não ocupa sala.' }
        : { state: 'ok', text: `${roomIds.length} ${roomIds.length === 1 ? 'sala' : 'salas'}` },
    withVariants && zones.filter((z) => z.active).length === 0
      ? { state: 'warn', text: 'Nenhuma opção em uso: não há marcação nova.' }
      : missingPrice > 0
        ? {
            state: 'warn',
            text: `${missingPrice} ${missingPrice === 1 ? 'opção sem preço' : 'opções sem preço'}: visitas com elas não têm total.`,
          }
        : durationMissing
          ? { state: 'warn', text: 'Falta a duração.' }
          : priceRequiredForPercent
            ? { state: 'warn', text: 'Falta o preço para o sinal percentual.' }
            : linePriceMissing
              ? { state: 'opt', text: 'Preço em aberto (opcional).' }
              : { state: 'ok', text: 'Preço e duração definidos.' },
    explanation.trim()
      ? { state: 'ok', text: 'Explicação para a IA escrita.' }
      : {
          state: 'opt',
          text: 'Explicação para a IA (opcional).',
          fix: { label: 'Escrever', run: () => setOpenRule('explicacao') },
        },
  ]

  const occupied = duration + buffer
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
      variantSelection: withVariants ? variantSelection : 'varias',
      synonyms,
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
      synonyms: z.synonyms,
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
      dirtyRef.current = false
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
      <SynonymsField
        label="Sinônimos"
        value={synonyms}
        onChange={setSynonyms}
        placeholder="Adicionar…"
        hint="Nomes populares do serviço. Só ajudam a entender o pedido; as respostas usam o nome do catálogo."
      />
      <ClinicCheck className="clinic-check clinic-check-card" isSelected={active} onChange={setActive}>
        Serviço ativo
      </ClinicCheck>
      <section className="clinic-stack" aria-labelledby="svc-price">
        <h2 id="svc-price" className="clinic-section-title">
          Como a cliente escolhe
        </h2>
        <RadioGroup
          className="svc-format"
          aria-label="Como a cliente escolhe"
          value={withVariants ? variantSelection : 'unica'}
          onChange={(v) => {
            if (v === 'unica') {
              setWithVariants(false)
            } else {
              setWithVariants(true)
              setVariantSelection(v === 'uma' ? 'uma' : 'varias')
            }
          }}
        >
          <Radio value="unica" className="svc-format-item">
            <strong>Um só serviço</strong>
            <span>Sempre o mesmo preço e a mesma duração.</span>
          </Radio>
          <Radio value="uma" className="svc-format-item">
            <strong>Escolhe uma opção</strong>
            <span>Ex.: tipo de massagem. Exatamente uma por visita.</span>
          </Radio>
          <Radio value="varias" className="svc-format-item">
            <strong>Pode juntar opções</strong>
            <span>Ex.: zonas de depilação. Preço e tempo somam.</span>
          </Radio>
        </RadioGroup>
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
          {variantSelection === 'varias' ? (
            <ComboCatalog
              singular={variantKind}
              plural={variantKindPlural}
              zones={zones}
              combos={combos}
              onCombos={(update) => setCombos(update)}
            />
          ) : combos.some((c) => c.active) ? (
            // DEC-149 — combos ficam ocultos em `uma`; avisar antes do Salvar.
            <p className="clinic-form-error" role="status">
              Este serviço ainda tem combo ativo. Volte a «Pode juntar opções», desative ou
              remova os combos, e só depois grave «Escolhe uma opção».
            </p>
          ) : null}
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

      <section aria-labelledby="svc-ready-t" className="clinic-stack">
        <h2 id="svc-ready-t" className="clinic-section-title">
          Pronto para atender
        </h2>
        <ul className="svc-ready">
          {readiness.map((item) => (
            <li key={item.text} data-state={item.state}>
              {item.state === 'ok' ? (
                <Check aria-hidden size={16} />
              ) : item.state === 'warn' ? (
                <TriangleAlert aria-hidden size={16} />
              ) : (
                <Minus aria-hidden size={16} />
              )}
              <span>
                {item.text}
                {item.fix ? (
                  <button type="button" className="svc-ready-fix" onClick={item.fix.run}>
                    {item.fix.label}
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </section>

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

      {formError ? (
        <p className="clinic-form-error" role="alert">
          {formError}
        </p>
      ) : null}
      <div className="clinic-footer-actions clinic-footer-sticky">
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
      <UnsavedChangesDialog
        open={unsavedOpen}
        onContinue={stayOnForm}
        onDiscard={leaveWithoutSaving}
        continueLabel="Continuar editando"
        discardLabel="Sair sem salvar"
        message="Se sair agora, as alterações deste serviço não ficam salvas."
      />
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
