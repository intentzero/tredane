import { useState } from 'react'
import { Button, Checkbox, Input, Label, TextArea, TextField } from 'react-aria-components'
import type { ClinicConfigSnapshot, PanelApi, ServiceUpsertBody } from '../../api'
import { PanelApiError } from '../../api'
import { navigatePanel } from '../../routes'
import {
  bufferOptions,
  durationOptions,
  formatPriceCents,
  parsePriceToCents,
} from './format'

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
                  {svc.active ? 'Activo' : 'Inactivo'}
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
  const [proIds, setProIds] = useState<string[]>(existing?.professionalIds ?? [])
  const [roomMode, setRoomMode] = useState<'none' | 'category' | 'resource'>(
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

  const occupied = duration + buffer

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
        err instanceof PanelApiError
          ? `Não foi possível salvar (${err.code}). Os dados do formulário foram mantidos.`
          : 'Não foi possível salvar. Os dados do formulário foram mantidos.',
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
        <Label>Nome do serviço</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </TextField>

      <div className="clinic-field-row">
        <label className="clinic-field">
          Duração
          <select
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
          >
            {durationOptions().map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </select>
        </label>
        <label className="clinic-field">
          Intervalo depois
          <select value={buffer} onChange={(e) => setBuffer(Number(e.target.value))}>
            {bufferOptions().map((m) => (
              <option key={m} value={m}>
                {m === 0 ? 'Nenhum' : `${m} min`}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="clinic-hint-box">
        Ocupa {occupied} min na agenda: {duration} de atendimento + {buffer} de intervalo.
        O intervalo bloqueia o profissional e a sala. Horários em múltiplos de 15 min.
      </p>

      <fieldset className="clinic-fieldset">
        <legend>Quem pode fazer este serviço</legend>
        {professionals.map((p) => (
          <Checkbox
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
            {!p.active ? ' (inactiva)' : ''}
          </Checkbox>
        ))}
        {professionals.length === 0 ? (
          <p className="clinic-footnote">Cadastre profissionais em Recursos primeiro.</p>
        ) : null}
      </fieldset>

      <label className="clinic-field">
        Sala ou equipamento exigido
        <select
          value={
            roomMode === 'none'
              ? 'none'
              : roomMode === 'category'
                ? `cat:${roomCategory}`
                : `res:${roomResourceId}`
          }
          onChange={(e) => {
            const v = e.target.value
            if (v === 'none') {
              setRoomMode('none')
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
        >
          <option value="none">Nenhum</option>
          {[...new Set(rooms.map((r) => r.category).filter(Boolean))].map((cat) => (
            <option key={`cat-${cat}`} value={`cat:${cat}`}>
              Qualquer · {cat}
            </option>
          ))}
          {rooms.map((r) => (
            <option key={r.id} value={`res:${r.id}`}>
              {r.name}
              {r.category ? ` (${r.category})` : ''}
            </option>
          ))}
        </select>
      </label>

      <TextField className="clinic-field">
        <Label>Preço (opcional)</Label>
        <Input
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          inputMode="decimal"
          placeholder="R$ 0,00"
        />
      </TextField>
      <p className="clinic-footnote">
        Sem preço, a IA não informa valor: sugere que a equipe vai confirmar.
        Percentual de sinal exige preço cadastrado.
      </p>

      <fieldset className="clinic-fieldset">
        <legend>Sinal por Pix (REQ-076)</legend>
        <Checkbox
          className="clinic-check"
          isSelected={requiresSignal}
          onChange={setRequiresSignal}
        >
          Exige sinal
        </Checkbox>
        {requiresSignal ? (
          <>
            <label className="clinic-field">
              Tipo
              <select
                value={signalKind}
                onChange={(e) =>
                  setSignalKind(e.target.value === 'percent' ? 'percent' : 'fixed')
                }
              >
                <option value="fixed">Valor fixo (R$)</option>
                <option value="percent" disabled={!parsePriceToCents(price)}>
                  Percentual do preço
                  {!parsePriceToCents(price) ? ' — cadastre o preço' : ''}
                </option>
              </select>
            </label>
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
        A IA usa só este texto para explicar o serviço (REQ-075). Não escreva promessas de
        resultado.
      </p>

      <Checkbox className="clinic-check clinic-check-card" isSelected={active} onChange={setActive}>
        Serviço activo
      </Checkbox>
      <p className="clinic-footnote">Desactivar não apaga compromissos já marcados.</p>

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
          {saving ? 'A salvar…' : 'Salvar serviço'}
        </Button>
      </div>
    </div>
  )
}
