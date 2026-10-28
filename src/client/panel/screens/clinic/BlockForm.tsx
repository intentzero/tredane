import { useEffect, useState } from 'react'
import { Button, Checkbox } from 'react-aria-components'
import { PanelApiError, type CreateBlockResponse, type PanelApi } from '../../api'
import { friendlyError } from '../../copy/errors'
import { PanelSelect } from '../../ui/PanelSelect'
import { blockRange, CLINIC_SCOPE_ID, formatPeriod } from './clinicHours'
import { BLOCK_REASON_LABELS, parseTimeToMinutes } from './format'
import { formatSlotTime } from '../agenda/format'

type Reason = 'folga' | 'ferias' | 'feriado' | 'manutencao' | 'outro'

type Props = {
  tenantId: string
  api: PanelApi
  generation: number
  timezone: string
  /** Quem pode ser escolhido em «Para». O primeiro é o padrão (ou `initialScope`). */
  scopes: Array<{ id: string; label: string }>
  initialScope?: string
  /** Motivos oferecidos (padrão: todos). */
  reasons?: Reason[]
  initialReason?: Reason
  saveLabel?: string
  onSaved: () => Promise<void>
  onCancel: () => void
}

/**
 * Folga, férias ou fechamento: um só formulário com período «de … até», dia
 * inteiro ou horas e o impacto antes de salvar (substitui «Verificar impacto»
 * + «Novo bloqueio»). Os horários marcados continuam marcados.
 */
export function BlockForm({
  tenantId,
  api,
  generation,
  timezone,
  scopes,
  initialScope,
  reasons = ['folga', 'ferias', 'feriado', 'manutencao', 'outro'],
  initialReason,
  saveLabel = 'Salvar',
  onSaved,
  onCancel,
}: Props) {
  const [scope, setScope] = useState(initialScope ?? scopes[0]?.id ?? CLINIC_SCOPE_ID)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [allDay, setAllDay] = useState(true)
  const [start, setStart] = useState('09:00')
  const [end, setEnd] = useState('12:00')
  const [reason, setReason] = useState<Reason>(initialReason ?? reasons[0] ?? 'folga')
  const [impact, setImpact] = useState<CreateBlockResponse['affectedAppointments'] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const sm = parseTimeToMinutes(start) ?? 0
  const em = parseTimeToMinutes(end) ?? 0
  const range = blockRange(from, to || from, allDay, sm, em, timezone)
  const fo = { generation, expectGeneration: () => generation }

  // Impacto antes de salvar: consulta (dryRun) sempre que o período muda.
  useEffect(() => {
    if (!range) {
      setImpact(null)
      return
    }
    let cancelled = false
    api
      .createBlock(tenantId, { resourceId: scope, startsAt: range.startsAt, endsAt: range.endsAt, reason, dryRun: true }, fo)
      .then((res) => {
        if (!cancelled) setImpact(res.affectedAppointments)
      })
      .catch(() => {
        if (!cancelled) setImpact(null)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, tenantId, scope, range?.startsAt, range?.endsAt, reason])

  async function save() {
    if (!range) {
      setError('Escolha o período: «de» e «até» (até não pode ser antes de de).')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await api.createBlock(tenantId, { resourceId: scope, startsAt: range.startsAt, endsAt: range.endsAt, reason }, fo)
      await onSaved()
    } catch (err) {
      if (err instanceof PanelApiError && err.message === 'stale_tenant_response') return
      setError(friendlyError(err, 'Não foi possível salvar. O que você preencheu continua aqui.'))
    } finally {
      setSaving(false)
    }
  }

  const count = impact?.length ?? 0

  return (
    <section className="block-form" aria-label="Folga, férias ou fechamento">
      {scopes.length > 1 ? (
        <PanelSelect
          className="clinic-field"
          label="Para"
          value={scope}
          onChange={(v) => setScope(v)}
          options={scopes.map((s) => ({ id: s.id, label: s.label }))}
        />
      ) : null}
      <div className="clinic-field-row">
        <label className="block-form-date">
          <span>De</span>
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value)
              if (!to || to < e.target.value) setTo(e.target.value)
            }}
          />
        </label>
        <label className="block-form-date">
          <span>Até</span>
          <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      <Checkbox className="clinic-check" isSelected={allDay} onChange={setAllDay}>
        Dia inteiro
      </Checkbox>
      {!allDay ? (
        <div className="clinic-field-row">
          <label className="block-form-date">
            <span>Das</span>
            <input type="time" step={900} value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="block-form-date">
            <span>Às</span>
            <input type="time" step={900} value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>
      ) : null}
      <fieldset className="clinic-fieldset block-form-reasons">
        <legend>Motivo</legend>
        <div className="block-form-chips">
          {reasons.map((r) => (
            <button
              key={r}
              type="button"
              className="block-form-chip"
              aria-pressed={reason === r}
              onClick={() => setReason(r)}
            >
              {BLOCK_REASON_LABELS[r]}
            </button>
          ))}
        </div>
      </fieldset>

      {range && impact ? (
        <div className={`block-form-impact${count > 0 ? ' block-form-impact--warn' : ''}`} role="status">
          {count === 0 ? (
            <strong>Nenhum horário marcado em {formatPeriod(range.startsAt, range.endsAt, timezone)}.</strong>
          ) : (
            <>
              <strong>
                {count} {count === 1 ? 'horário marcado' : 'horários marcados'} nesse período
              </strong>
              <ul>
                {impact.slice(0, 5).map((a) => (
                  <li key={a.id}>
                    {formatPeriod(a.startsAt, a.endsAt, timezone)} · {formatSlotTime(a.startsAt, timezone)}
                    {a.contactLabel ? ` · ${a.contactLabel}` : ''}
                  </li>
                ))}
                {count > 5 ? <li>e mais {count - 5}</li> : null}
              </ul>
              <span>Eles continuam marcados. Remarque ou cancele cada um na Agenda.</span>
            </>
          )}
        </div>
      ) : null}
      {error ? (
        <p className="clinic-form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="clinic-footer-actions">
        <Button className="panel-btn panel-btn-ghost" onPress={onCancel} isDisabled={saving}>
          Cancelar
        </Button>
        <Button className="panel-btn panel-btn-primary" onPress={() => void save()} isDisabled={saving || !range}>
          {saving ? 'Salvando…' : saveLabel}
        </Button>
      </div>
    </section>
  )
}
