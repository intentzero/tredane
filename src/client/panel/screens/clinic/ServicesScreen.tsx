import { useState } from 'react'
import { Button, Input, Label, NumberField, Radio, RadioGroup, TextArea, TextField } from 'react-aria-components'
import { ChevronRight } from 'lucide-react'
import { Badge } from '../../states/Badge'
import { ClinicCheck } from './ClinicCheck'
import { ClinicListHeader } from './ClinicListHeader'
import { serviceRow } from './resourceRows'
import { PanelSelect } from '../../ui/PanelSelect'
import type { ClinicConfigSnapshot, PanelApi, ServiceUpsertBody, ServiceZoneInput } from '../../api'
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

type ZoneDraft = {
  key: string
  id?: string
  name: string
  durationMinutes: number
  price: string
  audience: 'feminino' | 'masculino' | 'ambos'
  active: boolean
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
  const rooms = snap.resources.filter(
    (r) => r.kind === 'room' || r.kind === 'equipment',
  )

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
  const [roomMode, setRoomMode] = useState<'none' | 'any' | 'category' | 'resource'>(
    existing?.roomRequirement.mode ?? 'none',
  )
  const [roomCategory, setRoomCategory] = useState(
    existing?.roomRequirement.mode === 'category'
      ? existing.roomRequirement.category
      : '',
  )
  const [roomResourceId, setRoomResourceId] = useState(
    existing?.roomRequirement.mode === 'resource'
      ? existing.roomRequirement.resourceId
      : rooms[0]?.id ?? '',
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
  const [moreOpen, setMoreOpen] = useState(false)
  const roomLabel =
    roomMode === 'none'
      ? 'sem sala'
      : roomMode === 'any'
        ? 'qualquer sala livre'
        : roomMode === 'category'
          ? `qualquer · ${roomCategory}`
          : (rooms.find((r) => r.id === roomResourceId)?.name ?? 'sala')
  const moreSummary = [
    roomLabel,
    buffer === 0 ? 'sem intervalo' : `intervalo ${buffer} min`,
    requiresSignal ? 'exige sinal' : 'sem sinal',
    explanation.trim() ? 'com explicação' : null,
  ]
    .filter(Boolean)
    .join(' · ')

  async function save() {
    setFormError(null)
    if (
      tempoTemperatura !== 'tanto_faz' &&
      (tempoCelsius == null || !Number.isInteger(tempoCelsius))
    ) {
      setFormError('Informe os graus em número inteiro.')
      return
    }
    setSaving(true)
    const priceCents = parsePriceToCents(price)
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
        roomMode === 'none'
          ? { mode: 'none' }
          : roomMode === 'any'
            ? { mode: 'any' }
            : roomMode === 'category'
            ? { mode: 'category', category: roomCategory }
            : { mode: 'resource', resourceId: roomResourceId },
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
      variantKind: zones.length > 0 ? variantKind.trim() || null : null,
    }
    if (zones.length > 0 && !variantKind.trim()) {
      setFormError('Dê um nome ao tipo das variantes. O que você digitou continua aqui.')
      setSaving(false)
      return
    }
    const hadZones = (existing?.zones?.length ?? 0) > 0
    const zoneBody: ServiceZoneInput[] = zones.map((z) => ({
      id: z.id,
      name: z.name.trim(),
      durationMinutes: z.durationMinutes,
      priceCents: z.price.trim() ? parsePriceToCents(z.price) : null,
      audience: z.audience,
      active: z.active,
    }))
    try {
      // Limpar o tipo com variantes ainda gravadas deixa o cadastro inconsistente.
      if (zones.length === 0 && hadZones && existing) {
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
      if (zoneBody.length > 0) {
        try {
          await api.replaceServiceZones(tenantId, saved.id, zoneBody, {
            generation,
            expectGeneration: () => generation,
          })
        } catch (zoneErr) {
          if (!hadZones) {
            await api
              .upsertService(tenantId, { ...body, variantKind: null }, {
                serviceId: saved.id,
                generation,
                expectGeneration: () => generation,
              })
              .catch(() => {})
          }
          throw zoneErr
        }
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

  return (
    <div className="clinic-stack clinic-form">
      <div className="clinic-toolbar">
        <Button
          className="panel-btn panel-btn-ghost"
          onPress={() =>
            navigatePanel({ kind: 'area', area: 'clinica', tenantId, section: 'servicos' })
          }
        >
          Cancelar
        </Button>
      </div>
      <TextField className="clinic-field">
        <Label>Nome</Label>
        <Input autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
      </TextField>
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
      <section className="clinic-stack" aria-labelledby="svc-zones">
        <h2 id="svc-zones" className="agd-label">{variantKind.trim() || 'Variantes'}</h2>
        <p className="agd-note">
          Cada uma tem duração, preço e gênero. Várias entram no mesmo horário, sem misturar masculino e feminino. Ambos combina com os dois. Sem variantes, vale a duração e o preço da linha.
        </p>
        <TextField className="clinic-field">
          <Label>Tipo</Label>
          <Input
            autoComplete="off"
            value={variantKind}
            placeholder="Zona, Técnica"
            onChange={(e) => setVariantKind(e.target.value)}
          />
        </TextField>
        {zones.map((z) => (
          <div className="clinic-field-row" key={z.key}>
            <TextField className="clinic-field">
              <Label>Nome</Label>
              <Input
                value={z.name}
                onChange={(e) =>
                  setZones((prev) => prev.map((row) => (row.key === z.key ? { ...row, name: e.target.value } : row)))
                }
              />
            </TextField>
            <NumberField
              className="clinic-field"
              minValue={1}
              maxValue={24 * 60}
              step={1}
              formatOptions={{ maximumFractionDigits: 0 }}
              value={z.durationMinutes}
              onChange={(value) => {
                if (!Number.isInteger(value) || value < 1 || value > 24 * 60) return
                setZones((prev) =>
                  prev.map((row) => (row.key === z.key ? { ...row, durationMinutes: value } : row)),
                )
              }}
            >
              <Label>Duração (min)</Label>
              <Input />
            </NumberField>
            <TextField className="clinic-field">
              <Label>Preço</Label>
              <Input
                value={z.price}
                placeholder="sem preço"
                inputMode="decimal"
                onChange={(e) =>
                  setZones((prev) => prev.map((row) => (row.key === z.key ? { ...row, price: e.target.value } : row)))
                }
              />
            </TextField>
            <PanelSelect
              className="clinic-field"
              label="Gênero"
              value={z.audience}
              onChange={(v) => {
                if (v === 'feminino' || v === 'masculino' || v === 'ambos') {
                  setZones((prev) => prev.map((row) => (row.key === z.key ? { ...row, audience: v } : row)))
                }
              }}
              options={[
                { id: 'feminino', label: 'Feminino' },
                { id: 'masculino', label: 'Masculino' },
                { id: 'ambos', label: 'Ambos' },
              ]}
            />
            <ClinicCheck
              isSelected={z.active}
              onChange={(selected) =>
                setZones((prev) => prev.map((row) => (row.key === z.key ? { ...row, active: selected } : row)))
              }
            >
              Ativa
            </ClinicCheck>
            <Button
              className="panel-btn panel-btn-ghost"
              onPress={() => setZones((prev) => prev.filter((row) => row.key !== z.key))}
            >
              Remover
            </Button>
          </div>
        ))}
        <Button
          className="panel-btn panel-btn-secondary"
          onPress={() =>
            setZones((prev) => [
              ...prev,
              {
                key: crypto.randomUUID(),
                name: '',
                durationMinutes: prev.length === 0 ? duration : 15,
                price: prev.length === 0 ? price : '',
                audience: 'ambos',
                active: true,
              },
            ])
          }
        >
          Adicionar variante
        </Button>
      </section>
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
      <fieldset className="clinic-fieldset">
        <legend>Quem faz</legend>
        {professionals.map((p) => (
          <ClinicCheck
            key={p.id}
            className="clinic-check"
            isSelected={proIds.includes(p.id)}
            onChange={(selected) => {
              setProIds((prev) =>
                selected ? [...prev, p.id] : prev.filter((id) => id !== p.id),
              )
            }}
          >
            {p.name}
            {!p.active ? ' (inativa)' : ''}
          </ClinicCheck>
        ))}
        {professionals.length === 0 ? (
          <p className="clinic-footnote">Cadastre profissionais primeiro; dá para voltar depois.</p>
        ) : null}
      </fieldset>
      <section className="clinic-fieldset" aria-labelledby="service-tempo-heading">
        <h2 id="service-tempo-heading" className="clinic-section-title">
          Tempo
        </h2>
        {tempoCeu === 'tanto_faz' && tempoTemperatura === 'tanto_faz' ? (
          <p className="clinic-footnote">Sem restrição de tempo.</p>
        ) : null}
        <RadioGroup
          className="clinic-fieldset"
          aria-label="Céu"
          value={tempoCeu}
          onChange={(value) => {
            if (value === 'tanto_faz' || value === 'sol' || value === 'chuva') setTempoCeu(value)
          }}
        >
          <span className="clinic-section-title">Céu</span>
          <Radio className="clinic-check" value="tanto_faz">
            Tanto faz
          </Radio>
          <Radio className="clinic-check" value="sol">
            Sol
          </Radio>
          <Radio className="clinic-check" value="chuva">
            Chuva
          </Radio>
        </RadioGroup>
        {tempoCeu === 'sol' ? (
          <p className="clinic-footnote">
            Na hora marcada: céu limpo, pouco nublado ou parcialmente nublado, sem chuva.
          </p>
        ) : null}
        {tempoCeu === 'chuva' ? (
          <p className="clinic-footnote">
            Na hora marcada tem de estar chovendo (chuva, garoa ou trovoada).
          </p>
        ) : null}
        <RadioGroup
          className="clinic-fieldset"
          aria-label="Temperatura"
          value={tempoTemperatura}
          onChange={(value) => {
            if (value === 'tanto_faz' || value === 'acima' || value === 'abaixo') {
              setTempoTemperatura(value)
              if (value === 'tanto_faz') setTempoCelsius(null)
            }
          }}
        >
          <span className="clinic-section-title">Temperatura</span>
          <Radio className="clinic-check" value="tanto_faz">
            Tanto faz
          </Radio>
          <Radio className="clinic-check" value="acima">
            Acima de
          </Radio>
          <Radio className="clinic-check" value="abaixo">
            Abaixo de
          </Radio>
        </RadioGroup>
        {tempoTemperatura !== 'tanto_faz' ? (
          <NumberField
            className="clinic-field"
            aria-label="Graus (°C)"
            value={tempoCelsius ?? Number.NaN}
            onChange={(value) => setTempoCelsius(Number.isNaN(value) ? null : value)}
            step={1}
          >
            <Label>Graus (°C)</Label>
            <Input />
          </NumberField>
        ) : null}
      </section>
      <p className="clinic-footnote">
        Sem preço, a IA não informa valor: sugere que a equipe vai confirmar.
      </p>

      <section className="clinic-fieldset" aria-labelledby="service-hours-heading">
        <h2 id="service-hours-heading" className="clinic-section-title">
          Quando este serviço pode ser prestado
        </h2>
        <WeekEditor
          label="Quando este serviço pode ser prestado"
          value={hoursDraft}
          onChange={setHoursDraft}
        />
        <p className="clinic-footnote">
          Com todos os dias fechados, o serviço pode ser agendado em qualquer horário em que a
          profissional (e a sala, se houver) estiverem disponíveis.
        </p>
      </section>

      <section className="service-more">
        <button
          type="button"
          className="service-more-head"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((o) => !o)}
        >
          <span className="service-more-copy">
            <strong>Mais opções</strong>
            <span>{moreSummary}</span>
          </span>
          <span aria-hidden className="service-more-chev" data-open={moreOpen || undefined}>
            ›
          </span>
        </button>
        {moreOpen ? (
          <div className="service-more-body">
            <PanelSelect
              className="clinic-field"
              label="Onde acontece"
              value={
                roomMode === 'none'
                  ? 'none'
                  : roomMode === 'any'
                    ? 'any'
                    : roomMode === 'category'
                      ? `cat:${roomCategory}`
                      : `res:${roomResourceId}`
              }
              onChange={(v) => {
                if (v === 'none') {
                  setRoomMode('none')
                  return
                }
                if (v === 'any') {
                  setRoomMode('any')
                  return
                }
                if (v.startsWith('cat:')) {
                  setRoomMode('category')
                  setRoomCategory(v.slice(4))
                  return
                }
                setRoomMode('resource')
                setRoomResourceId(v.slice(4))
              }}
              options={[
                { id: 'none', label: 'Sem sala' },
                { id: 'any', label: 'Qualquer sala livre' },
                ...[...new Set(rooms.map((r) => r.category).filter(Boolean))].map((cat) => ({
                  id: `cat:${cat}`,
                  label: `Qualquer · ${cat}`,
                })),
                ...rooms.map((r) => ({
                  id: `res:${r.id}`,
                  label: `${r.name}${r.category ? ` (${r.category})` : ''}`,
                })),
              ]}
            />
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
            <p className="clinic-hint-box">
              Ocupa {occupied} min na agenda: {duration} de atendimento + {buffer} de intervalo. O intervalo
              bloqueia a profissional e a sala.
            </p>
            <fieldset className="clinic-fieldset">
              <legend>Sinal por Pix</legend>
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
                        hint: parsePriceToCents(price) ? undefined : 'Cadastre o preço primeiro',
                        disabled: !parsePriceToCents(price),
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
                  {signalKind === 'percent' && parsePriceToCents(price) != null ? (
                    <p className="clinic-hint-box">
                      Resumo: sinal de{' '}
                      {formatPriceCents(
                        Math.trunc(
                          ((parsePriceToCents(price) ?? 0) *
                            (Number.parseInt(signalPercent, 10) || 0)) /
                            100,
                        ),
                      )}{' '}
                      ({signalPercent}% de {formatPriceCents(parsePriceToCents(price))}).
                    </p>
                  ) : null}
                </>
              ) : null}
            </fieldset>
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
          </div>
        ) : null}
      </section>

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
    </div>
  )
}
