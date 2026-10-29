import { useEffect, useState } from 'react'
import { Button } from 'react-aria-components'
import { ClinicCheck } from './ClinicCheck'
import { PanelApiError, type CreateBlockResponse, type PanelApi } from '../../api'
import { friendlyError } from '../../copy/errors'
import { PanelMultiSelect } from '../../ui/PanelMultiSelect'
import { PanelSelect } from '../../ui/PanelSelect'
import { blockRange, CLINIC_SCOPE_ID, formatPeriod, normalizeScopes } from './clinicHours'
import { BLOCK_REASON_LABELS, parseTimeToMinutes } from './format'
import { formatSlotTime } from '../agenda/format'

type Reason = 'folga' | 'ferias' | 'feriado' | 'manutencao' | 'outro'

type Props = {
  tenantId: string
  api: PanelApi
  generation: number
  timezone: string
  /** Quem pode ser escolhido em «Para». O primeiro é o padrão (ou `initialScope`). */
  scopes: Array<{ id: string; label: string; hint?: string; color?: string; mark?: string }>
  initialScope?: string
  /** Motivos oferecidos (padrão: todos). */
  reasons?: Reason[]
  initialReason?: Reason
  saveLabel?: string
  onSaved: () => Promise<void>
  onCancel: () => void
}

/**
 * Folga, férias ou fechamento: um só formulário com «quem fica fora» (várias pessoas, «Clínica
 * inteira» exclusiva), um motivo, período «de … até», dia inteiro ou horas e o impacto antes de
 * salvar. Salvar cria um bloqueio por pessoa. Os horários marcados continuam marcados.
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
  const [selected, setSelected] = useState<string[]>([initialScope ?? scopes[0]?.id ?? CLINIC_SCOPE_ID])
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [allDay, setAllDay] = useState(true)
  const [start, setStart] = useState('09:00')
  const [end, setEnd] = useState('12:00')
  const [reason, setReason] = useState<Reason>(initialReason ?? reasons[0] ?? 'folga')
  const [impact, setImpact] = useState<Record<string, CreateBlockResponse['affectedAppointments']> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const sm = parseTimeToMinutes(start) ?? 0
  const em = parseTimeToMinutes(end) ?? 0
  const range = blockRange(from, to || from, allDay, sm, em, timezone)
  const fo = { generation, expectGeneration: () => generation }

  // Impacto antes de salvar: consulta (dryRun) por pessoa sempre que o período muda.
  const selectedKey = selected.join('|')
  useEffect(() => {
    if (!range || selected.length === 0) {
      setImpact(null)
      return
    }
    let cancelled = false
    Promise.all(
      selected.map((scope) =>
        api
          .createBlock(tenantId, { resourceId: scope, startsAt: range.startsAt, endsAt: range.endsAt, reason, dryRun: true }, fo)
          .then((res) => [scope, res.affectedAppointments] as const),
      ),
    )
      .then((pairs) => {
        if (!cancelled) setImpact(Object.fromEntries(pairs))
      })
      .catch(() => {
        if (!cancelled) setImpact(null)
      })
    return () => {
      cancelled = true
    }
  }, [api, tenantId, selectedKey, range?.startsAt, range?.endsAt, reason])

  async function save() {
    if (!range) {
      setError('Escolha o período: «de» e «até» (até não pode ser antes de de).')
      return
    }
    setSaving(true)
    setError(null)
    const pending = [...selected]
    try {
      while (pending.length > 0) {
        await api.createBlock(tenantId, { resourceId: pending[0]!, startsAt: range.startsAt, endsAt: range.endsAt, reason }, fo)
        pending.shift()
      }
      await onSaved()
    } catch (err) {
      if (err instanceof PanelApiError && err.message === 'stale_tenant_response') return
      const done = selected.length - pending.length
      if (done > 0) {
        // Uma parte já foi salva: tentar de novo só cria o que faltou.
        setSelected(pending)
        setError(
          `Salvamos para ${done} ${done === 1 ? 'pessoa' : 'pessoas'}. Não foi possível salvar para ${labelOf(pending[0]!)}: ${friendlyError(err, 'tente de novo.')}`,
        )
      } else {
        setError(friendlyError(err, 'Não foi possível salvar. O que você preencheu continua aqui.'))
      }
    } finally {
      setSaving(false)
    }
  }

  const labelOf = (id: string) => scopes.find((s) => s.id === id)?.label ?? 'a pessoa'
  const byPerson = Object.entries(impact ?? {}).map(([id, list]) => ({ id, label: labelOf(id), list }))
  const merged = new Map<string, CreateBlockResponse['affectedAppointments'][number]>()
  for (const p of byPerson) for (const a of p.list) merged.set(a.id, a)
  const affected = [...merged.values()].sort((x, y) => x.startsAt - y.startsAt)

  const count = affected.length

  return (
    <section className="block-form" aria-label="Folga, férias ou fechamento">
      {scopes.length > 1 ? (
        <PanelMultiSelect
          className="clinic-field"
          label="Quem fica fora"
          placeholder="Escolha quem"
          value={selected}
          onChange={(next) => setSelected((prev) => normalizeScopes(prev, next))}
          options={scopes}
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
      <ClinicCheck className="clinic-check" isSelected={allDay} onChange={setAllDay}>
        Dia inteiro
      </ClinicCheck>
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
      <PanelSelect<Reason>
        className="clinic-field"
        label="Motivo"
        value={reason}
        onChange={setReason}
        options={reasons.map((r) => ({ id: r, label: BLOCK_REASON_LABELS[r] ?? r }))}
      />
      {selected.length > 1 ? (
        <p className="clinic-footnote">Um motivo para todos os selecionados. Para motivos diferentes, salve uma folga de cada vez.</p>
      ) : null}

      {range && impact && selected.length > 0 ? (
        <div className={`block-form-impact${count > 0 ? ' block-form-impact--warn' : ''}`} role="status">
          {count === 0 ? (
            <strong>Nenhum horário marcado em {formatPeriod(range.startsAt, range.endsAt, timezone)}.</strong>
          ) : (
            <>
              <strong>
                {count} {count === 1 ? 'horário marcado' : 'horários marcados'} nesse período
              </strong>
              {byPerson.filter((p) => p.list.length > 0).length > 1 ? (
                <span>{byPerson.filter((p) => p.list.length > 0).map((p) => `${p.label} (${p.list.length})`).join(' e ')}</span>
              ) : null}
              <ul>
                {affected.slice(0, 5).map((a) => (
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
        <Button
          className="panel-btn panel-btn-primary"
          onPress={() => void save()}
          isDisabled={saving || !range || selected.length === 0}
        >
          {saving
            ? 'Salvando…'
            : selected.length === 0
              ? 'Escolha quem fica fora'
              : selected.length > 1
                ? `${saveLabel} para ${selected.length} pessoas`
                : saveLabel}
        </Button>
      </div>
    </section>
  )
}
