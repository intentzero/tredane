import { useState } from 'react'
import { Button, Input, Label, TextArea, TextField } from 'react-aria-components'
import { ClinicCheck } from './ClinicCheck'
import { PanelSelect } from '../../ui/PanelSelect'
import type { ClinicConfigSnapshot, PanelApi, ServiceUpsertBody } from '../../api'
import { PanelApiError } from '../../api'
import { navigatePanel } from '../../routes'
import {
  bufferOptions,
  durationOptions,
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
  return (
    <div className="clinic-stack">
      <div className="clinic-toolbar">
        <Button
          className="panel-btn panel-btn-ghost"
          onPress={() =>
            navigatePanel({ kind: 'area', area: 'clinica', tenantId, section: 'hub' })
          }
        >
          Voltar
        </Button>
        <Button
          className="panel-btn panel-btn-primary"
          onPress={() =>
            navigatePanel({
              kind: 'area',
              area: 'clinica',
              tenantId,
              section: 'servico',
              entityId: 'novo',
            })
          }
        >
          Adicionar serviço
        </Button>
      </div>
      <ul className="clinic-nav-list">
        {snap.services.map((svc) => (
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
                <span>
                  {svc.durationMinutes}+{svc.bufferMinutes} min ·{' '}
                  {svc.active ? 'Ativo' : 'Inativo'}
                </span>
              </span>
            </Button>
          </li>
        ))}
        {snap.services.length === 0 ? (
          <li className="clinic-empty">Nenhum serviço cadastrado ainda.</li>
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
  const rooms = snap.resources.filter(
    (r) => r.kind === 'room' || r.kind === 'equipment',
  )

  const [name, setName] = useState(existing?.name ?? '')
  const [duration, setDuration] = useState(existing?.durationMinutes ?? 60)
  const [buffer, setBuffer] = useState(existing?.bufferMinutes ?? 15)
  const [price, setPrice] = useState(
    existing?.priceCents != null ? formatPriceCents(existing.priceCents) : '',
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
  // DEC-051 (Confirmado, card t1868s7504): só a owner marca «duração ajustável».
  const [adjustable, setAdjustable] = useState(existing?.durationAdjustable ?? false)
  const [durMin, setDurMin] = useState(existing?.durationMinMinutes ?? 30)
  const [durMax, setDurMax] = useState(existing?.durationMaxMinutes ?? 120)
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
    adjustable ? 'duração ajustável' : null,
    requiresSignal ? 'exige sinal' : 'sem sinal',
    explanation.trim() ? 'com explicação' : null,
  ]
    .filter(Boolean)
    .join(' · ')

  async function save() {
    setSaving(true)
    setFormError(null)
    const priceCents = parsePriceToCents(price)
    const body: ServiceUpsertBody = {
      name,
      durationMinutes: duration,
      bufferMinutes: buffer,
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
      durationAdjustable: adjustable,
      durationMinMinutes: adjustable ? Math.min(durMin, duration) : null,
      durationMaxMinutes: adjustable ? Math.max(durMax, duration) : null,
      weeklyWindows: fromWeekDraft(hoursDraft),
    }
    try {
      await api.upsertService(tenantId, body, {
        serviceId: existing?.id,
        generation,
        expectGeneration: () => generation,
      })
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
        <PanelSelect
          className="clinic-field"
          label="Duração"
          value={String(duration)}
          onChange={(v) => setDuration(Number(v))}
          options={durationOptions().map((m) => ({ id: String(m), label: `${m} min` }))}
        />
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
              <legend>Duração ao agendar</legend>
              <ClinicCheck className="clinic-check" isSelected={adjustable} onChange={setAdjustable}>
                A equipe pode ajustar a duração
              </ClinicCheck>
              {adjustable ? (
                <div className="clinic-field-row">
                  <PanelSelect
                    className="clinic-field"
                    label="Mínimo"
                    value={String(Math.min(durMin, duration))}
                    onChange={(v) => setDurMin(Number(v))}
                    options={durationOptions()
                      .filter((m) => m <= duration)
                      .map((m) => ({ id: String(m), label: `${m} min` }))}
                  />
                  <PanelSelect
                    className="clinic-field"
                    label="Máximo"
                    value={String(Math.max(durMax, duration))}
                    onChange={(v) => setDurMax(Number(v))}
                    options={durationOptions()
                      .filter((m) => m >= duration)
                      .map((m) => ({ id: String(m), label: `${m} min` }))}
                  />
                </div>
              ) : null}
              <p className="clinic-footnote">
                A equipe escolhe em passos de 15 min entre o mínimo e o máximo. O intervalo é somado
                depois; preço e sinal não mudam.
              </p>
            </fieldset>
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
