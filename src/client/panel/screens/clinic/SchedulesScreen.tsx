import { useMemo, useState } from 'react'
import { Button, Input, Label, TextField } from 'react-aria-components'
import { PanelSelect } from '../../ui/PanelSelect'
import type { ClinicConfigSnapshot, PanelApi } from '../../api'
import { PanelApiError } from '../../api'
import { navigatePanel } from '../../routes'
import {
  BLOCK_REASON_LABELS,
  dayLabel,
  formatMinutes,
  parseTimeToMinutes,
} from './format'

type Props = {
  tenantId: string
  snap: ClinicConfigSnapshot
  api: PanelApi
  generation: number
  onSaved: () => Promise<void>
}

export function SchedulesScreen({
  tenantId,
  snap,
  api,
  generation,
  onSaved,
}: Props) {
  const resources = snap.resources.filter((r) => r.active)
  const [resourceId, setResourceId] = useState(resources[0]?.id ?? '')
  const selected = snap.resources.find((r) => r.id === resourceId)
  const windows = snap.weeklyWindows.filter((w) => w.resourceId === resourceId)
  const blocks = snap.blocks.filter((b) => b.resourceId === resourceId)

  const [editDay, setEditDay] = useState<number | null>(null)
  const [start, setStart] = useState('09:00')
  const [end, setEnd] = useState('12:00')
  const [error, setError] = useState<string | null>(null)
  const [affected, setAffected] = useState<string | null>(null)
  const [blockDate, setBlockDate] = useState('')
  const [blockStart, setBlockStart] = useState('')
  const [blockEnd, setBlockEnd] = useState('')
  const [blockReason, setBlockReason] = useState<'folga' | 'ferias' | 'feriado' | 'manutencao' | 'outro'>('folga')

  const byDay = useMemo(() => {
    const map = new Map<number, typeof windows>()
    for (let d = 1; d <= 7; d++) map.set(d, [])
    for (const w of windows) {
      const list = map.get(w.dayOfWeek) ?? []
      list.push(w)
      map.set(w.dayOfWeek, list)
    }
    return map
  }, [windows])

  async function saveDayWindows(day: number, nextWindows: Array<{ startMinute: number; endMinute: number }>) {
    setError(null)
    const all = [...windows.filter((w) => w.dayOfWeek !== day), ...nextWindows.map((w) => ({
      dayOfWeek: day,
      startMinute: w.startMinute,
      endMinute: w.endMinute,
    }))]
    try {
      await api.setWeeklyWindows(tenantId, resourceId, all, {
        generation,
        expectGeneration: () => generation,
      })
      await onSaved()
      setEditDay(null)
    } catch (err) {
      if (err instanceof PanelApiError && err.message === 'stale_tenant_response') return
      setError('Não foi possível salvar o expediente. A edição permanece aberta.')
    }
  }

  async function addWindowForDay() {
    if (editDay == null) return
    const s = parseTimeToMinutes(start)
    const e = parseTimeToMinutes(end)
    if (s == null || e == null) {
      setError('Horário inválido. Use HH:MM em múltiplos de 15.')
      return
    }
    const existing = (byDay.get(editDay) ?? []).map((w) => ({
      startMinute: w.startMinute,
      endMinute: w.endMinute,
    }))
    await saveDayWindows(editDay, [...existing, { startMinute: s, endMinute: e }])
  }

  async function clearDay(day: number) {
    await saveDayWindows(day, [])
  }

  async function createBlock(dryRun: boolean) {
    setError(null)
    setAffected(null)
    if (!blockDate) {
      setError('Informe a data do bloqueio.')
      return
    }
    const dayStart = new Date(`${blockDate}T00:00:00`)
    let startsAt = dayStart.getTime()
    let endsAt = dayStart.getTime() + 24 * 60 * 60 * 1000
    if (blockStart && blockEnd) {
      const s = parseTimeToMinutes(blockStart)
      const e = parseTimeToMinutes(blockEnd)
      if (s == null || e == null) {
        setError('Horário do bloqueio inválido.')
        return
      }
      startsAt = dayStart.getTime() + s * 60_000
      endsAt = dayStart.getTime() + e * 60_000
    }
    try {
      const result = await api.createBlock(
        tenantId,
        {
          resourceId,
          startsAt,
          endsAt,
          reason: blockReason,
          dryRun,
        },
        { generation, expectGeneration: () => generation },
      )
      if (result.affectedAppointments.length > 0) {
        setAffected(
          `${result.affectedAppointments.length} compromisso(s) no período — não foram cancelados. Decida na agenda caso a caso.`,
        )
      }
      if (!dryRun) {
        await onSaved()
        setBlockDate('')
        setBlockStart('')
        setBlockEnd('')
      }
    } catch (err) {
      if (err instanceof PanelApiError && err.message === 'stale_tenant_response') return
      setError('Não foi possível criar o bloqueio. Os campos foram mantidos.')
    }
  }

  async function removeBlock(blockId: string) {
    try {
      await api.deleteBlock(tenantId, blockId, {
        generation,
        expectGeneration: () => generation,
      })
      await onSaved()
    } catch {
      setError('Falha ao remover bloqueio.')
    }
  }

  if (!selected) {
    return (
      <div className="clinic-stack">
        <p className="clinic-empty">Cadastre um recurso ativo antes do expediente.</p>
        <Button
          className="panel-btn panel-btn-ghost"
          onPress={() =>
            navigatePanel({ kind: 'area', area: 'clinica', tenantId, section: 'hub' })
          }
        >
          Voltar
        </Button>
      </div>
    )
  }

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
      </div>

      <div
        className="clinic-tabs clinic-tabs-scroll"
        role="group"
        aria-label="Recurso do expediente"
      >
        {resources.map((r) => (
          <Button
            key={r.id}
            className={
              r.id === resourceId ? 'clinic-tab clinic-tab-active' : 'clinic-tab'
            }
            aria-pressed={r.id === resourceId}
            onPress={() => setResourceId(r.id)}
          >
            {r.name}
          </Button>
        ))}
      </div>

      <section className="clinic-section">
        <h2>Expediente semanal</h2>
        <ul className="clinic-nav-list">
          {[1, 2, 3, 4, 5, 6, 7].map((day) => {
            const dayWindows = byDay.get(day) ?? []
            return (
              <li key={day} className="clinic-day-row">
                <span className="clinic-day-name">{dayLabel(day)}</span>
                <span className="clinic-day-hours">
                  {dayWindows.length === 0
                    ? 'Não atende'
                    : dayWindows
                        .map(
                          (w) =>
                            `${formatMinutes(w.startMinute)}–${formatMinutes(w.endMinute)}`,
                        )
                        .join(' · ')}
                </span>
                <Button
                  className="panel-icon-btn"
                  aria-label={`Editar ${dayLabel(day)}`}
                  onPress={() => {
                    setEditDay(day)
                    setError(null)
                  }}
                >
                  Editar
                </Button>
                {dayWindows.length > 0 ? (
                  <Button
                    className="panel-icon-btn"
                    aria-label={`Limpar ${dayLabel(day)}`}
                    onPress={() => void clearDay(day)}
                  >
                    Limpar
                  </Button>
                ) : null}
              </li>
            )
          })}
        </ul>
        <p className="clinic-footnote">
          Os horários são de 15 em 15 minutos e seguem o {snap.settings.timezone === 'America/Sao_Paulo' ? 'horário de Brasília' : 'fuso da clínica'}.
        </p>
      </section>

      {editDay != null ? (
        <section className="clinic-banner clinic-banner-inline" aria-label="Editar dia">
          <h3>Editar {dayLabel(editDay)}</h3>
          <div className="clinic-field-row">
            <TextField className="clinic-field">
              <Label>Início</Label>
              <Input value={start} onChange={(e) => setStart(e.target.value)} />
            </TextField>
            <TextField className="clinic-field">
              <Label>Fim</Label>
              <Input value={end} onChange={(e) => setEnd(e.target.value)} />
            </TextField>
          </div>
          <div className="clinic-footer-actions">
            <Button className="panel-btn panel-btn-primary" onPress={() => void addWindowForDay()}>
              Adicionar faixa
            </Button>
            <Button className="panel-btn panel-btn-ghost" onPress={() => setEditDay(null)}>
              Fechar
            </Button>
          </div>
        </section>
      ) : null}

      <section className="clinic-section">
        <h2>Bloqueios</h2>
        <ul className="clinic-block-list">
          {blocks.map((b) => (
            <li key={b.id} className="clinic-block-item">
              <span className="clinic-nav-copy">
                <strong>{new Date(b.startsAt).toLocaleString('pt-BR')}</strong>
                <span>
                  até {new Date(b.endsAt).toLocaleString('pt-BR')} ·{' '}
                  {BLOCK_REASON_LABELS[b.reason] ?? b.reason}
                </span>
              </span>
              <Button
                className="panel-btn panel-btn-ghost"
                onPress={() => void removeBlock(b.id)}
              >
                Remover
              </Button>
            </li>
          ))}
          {blocks.length === 0 ? (
            <li className="clinic-empty">Nenhum bloqueio pontual.</li>
          ) : null}
        </ul>
        <p className="clinic-banner clinic-banner-inline" role="status">
          Se já houver compromissos no período, o sistema avisa quais são. Eles não são
          cancelados sozinhos.
        </p>

        <div className="clinic-form">
          <TextField className="clinic-field">
            <Label>Data</Label>
            <Input
              type="date"
              value={blockDate}
              onChange={(e) => setBlockDate(e.target.value)}
            />
          </TextField>
          <div className="clinic-field-row">
            <TextField className="clinic-field">
              <Label>Início (opcional)</Label>
              <Input
                value={blockStart}
                onChange={(e) => setBlockStart(e.target.value)}
                placeholder="Dia inteiro"
              />
            </TextField>
            <TextField className="clinic-field">
              <Label>Fim (opcional)</Label>
              <Input value={blockEnd} onChange={(e) => setBlockEnd(e.target.value)} />
            </TextField>
          </div>
          <PanelSelect
            className="clinic-field"
            label="Motivo"
            value={blockReason}
            onChange={(v) => setBlockReason(v as typeof blockReason)}
            options={Object.entries(BLOCK_REASON_LABELS).map(([id, label]) => ({ id, label }))}
          />
          <div className="clinic-footer-actions">
            <Button
              className="panel-btn panel-btn-ghost"
              onPress={() => void createBlock(true)}
            >
              Verificar impacto
            </Button>
            <Button
              className="panel-btn panel-btn-primary"
              onPress={() => void createBlock(false)}
            >
              Novo bloqueio
            </Button>
          </div>
        </div>
      </section>

      {affected ? (
        <p className="clinic-banner clinic-banner-inline" role="status">
          {affected}
        </p>
      ) : null}
      {error ? (
        <p className="clinic-form-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
