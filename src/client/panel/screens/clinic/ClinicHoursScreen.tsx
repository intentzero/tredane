import { ChevronLeft } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from 'react-aria-components'
import { PanelApiError, type ClinicConfigSnapshot, type PanelApi } from '../../api'
import { friendlyError } from '../../copy/errors'
import { navigatePanel } from '../../routes'
import { civilMinuteToEpoch } from '../holds/holdFormat'
import { BlockForm } from './BlockForm'
import {
  civilOf,
  CLINIC_SCOPE_ID,
  describeWeek,
  formatPeriod,
  fromWeekDraft,
  personColor,
  toWeekDraft,
  windowsOf,
  type WeekDraft,
} from './clinicHours'
import { BLOCK_REASON_LABELS, dayLabel, formatMinutes } from './format'
import { MonthCalendar, type CalendarEntry } from './MonthCalendar'
import { Segmented } from './Segmented'
import { WeekBars, type WeekBarOverlay } from './WeekBars'
import { WeekEditor } from './WeekEditor'

type Props = {
  tenantId: string
  snap: ClinicConfigSnapshot
  api: PanelApi
  generation: number
  onSaved: () => Promise<void>
}

const same = (a: WeekDraft, b: WeekDraft) => JSON.stringify(a) === JSON.stringify(b)

type Ym = { year: number; month: number }
const shiftMonth = ({ year, month }: Ym, by: number): Ym => {
  const d = new Date(Date.UTC(year, month + by, 1))
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() }
}

/**
 * Horário da clínica (Proposto, TEL-09): expediente semanal único, dias de
 * clínica fechada e quem tem horário próprio. Profissionais que seguem o da
 * clínica mudam junto.
 */
export function ClinicHoursScreen({ tenantId, snap, api, generation, onSaved }: Props) {
  const saved = useMemo(() => toWeekDraft(windowsOf(snap, CLINIC_SCOPE_ID)), [snap])
  const [draft, setDraft] = useState<WeekDraft>(saved)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)
  const [confirmAll, setConfirmAll] = useState(false)
  const [view, setView] = useState<'semana' | 'calendario'>('semana')
  const [shown, setShown] = useState<string[]>([])
  const [selectedDay, setSelectedDay] = useState(2)
  const fo = { generation, expectGeneration: () => generation }
  const tz = snap.settings.timezone

  const professionals = snap.resources.filter((r) => r.kind === 'professional' && r.active)
  const followers = professionals.filter((p) => p.hoursMode === 'clinic')
  const own = professionals.filter((p) => p.hoursMode !== 'clinic')
  const dirty = !same(draft, saved)

  const now = Date.now()
  const todayIso = civilOf(now, tz)
  const [ym, setYm] = useState<Ym>(() => {
    const [y, m] = todayIso.split('-').map(Number)
    return { year: y!, month: m! - 1 }
  })
  const people = professionals
    .map((p, i) => ({
      id: p.id,
      name: p.name,
      color: personColor(i),
      week: toWeekDraft(windowsOf(snap, p.hoursMode === 'clinic' ? CLINIC_SCOPE_ID : p.id)),
    }))
    .filter((p) => shown.includes(p.id))
  const nameOf = (id: string) =>
    id === CLINIC_SCOPE_ID
      ? 'Clínica fechada'
      : (snap.resources.find((r) => r.id === id)?.name ?? 'Outro')
  const colorOf = (id: string) =>
    id === CLINIC_SCOPE_ID
      ? '#B42318'
      : personColor(
          Math.max(
            0,
            professionals.findIndex((p) => p.id === id),
          ),
        )
  // Folgas e fechamentos que caem na semana corrente, para desenhar sobre a grade.
  const weekDates = (() => {
    const [y, m, d] = todayIso.split('-').map(Number)
    const base = new Date(Date.UTC(y!, m! - 1, d!))
    const monday = base.getTime() - ((base.getUTCDay() + 6) % 7) * 86_400_000
    return [0, 1, 2, 3, 4, 5, 6].map((i) =>
      new Date(monday + i * 86_400_000).toISOString().slice(0, 10),
    )
  })()
  const overlays: WeekBarOverlay[] = []
  for (const b of snap.blocks) {
    const isClinic = b.resourceId === CLINIC_SCOPE_ID
    if (!isClinic && !shown.includes(b.resourceId)) continue
    weekDates.forEach((iso, i) => {
      const dayStart = civilMinuteToEpoch(iso, 0, tz)
      const dayEnd = civilMinuteToEpoch(iso, 24 * 60, tz)
      if (b.startsAt >= dayEnd || b.endsAt <= dayStart) return
      overlays.push({
        day: i + 1,
        startMinute: Math.max(0, Math.round((b.startsAt - dayStart) / 60_000)),
        endMinute: Math.min(24 * 60, Math.round((b.endsAt - dayStart) / 60_000)),
        color: isClinic ? '#B42318' : colorOf(b.resourceId),
        label: `${nameOf(b.resourceId)} · ${BLOCK_REASON_LABELS[b.reason] ?? b.reason}`,
      })
    })
  }
  const dayWorkers = (day: number) =>
    professionals
      .map((p, i) => ({
        id: p.id,
        name: p.name,
        color: personColor(i),
        week: toWeekDraft(windowsOf(snap, p.hoursMode === 'clinic' ? CLINIC_SCOPE_ID : p.id)),
      }))
      .filter((p) => (p.week[day] ?? []).length > 0)
  const entries: CalendarEntry[] = snap.blocks
    .filter(
      (b) => b.resourceId === CLINIC_SCOPE_ID || professionals.some((p) => p.id === b.resourceId),
    )
    .map((b) => ({
      id: b.id,
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      color: colorOf(b.resourceId),
    }))
  const upcoming = snap.blocks
    .filter(
      (b) =>
        (b.resourceId === CLINIC_SCOPE_ID || professionals.some((p) => p.id === b.resourceId)) &&
        b.endsAt >= now,
    )
    .sort((a, b) => a.startsAt - b.startsAt)
    .map((b) => ({
      ...b,
      who: nameOf(b.resourceId),
      color: colorOf(b.resourceId),
    }))

  async function guard(fn: () => Promise<void>, fallback: string) {
    setError(null)
    try {
      await fn()
    } catch (err) {
      if (err instanceof PanelApiError && err.message === 'stale_tenant_response') return
      setError(friendlyError(err, fallback))
    }
  }

  async function saveHours() {
    setSaving(true)
    await guard(async () => {
      await api.setWeeklyWindows(tenantId, CLINIC_SCOPE_ID, fromWeekDraft(draft), fo)
      await onSaved()
    }, 'Não foi possível salvar o horário. O que você editou continua aqui.')
    setSaving(false)
  }

  async function followAll() {
    setSaving(true)
    await guard(async () => {
      for (const p of own) {
        await api.upsertResource(
          tenantId,
          {
            kind: 'professional',
            name: p.name,
            active: p.active,
            hoursMode: 'clinic',
          },
          { resourceId: p.id, ...fo },
        )
      }
      setConfirmAll(false)
      await onSaved()
    }, 'Não foi possível mudar todas agora. Tente de novo.')
    setSaving(false)
  }

  async function removeClosure(id: string) {
    await guard(async () => {
      await api.deleteBlock(tenantId, id, fo)
      await onSaved()
    }, 'Não foi possível remover o fechamento.')
  }

  return (
    <div className="clinic-stack clinic-form">
      <div className="clinic-toolbar">
        <Button
          className="panel-btn panel-btn-ghost"
          onPress={() =>
            navigatePanel({
              kind: 'area',
              area: 'clinica',
              tenantId,
              section: 'hub',
            })
          }
        >
          <ChevronLeft aria-hidden size={18} strokeWidth={2} /> Clínica
        </Button>
      </div>
      <h2 className="panel-title clinic-h2">Horário</h2>
      <Segmented
        label="Visão do horário"
        value={view}
        options={[
          { id: 'semana', label: 'Semana' },
          { id: 'calendario', label: 'Calendário' },
        ]}
        onChange={setView}
      />

      {view === 'semana' ? (
        <div className="hours-split">
          <div className="hours-main">
            <div className="week-filters" role="group" aria-label="Mostrar na semana">
              {professionals.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  className="block-form-chip"
                  aria-pressed={shown.includes(p.id)}
                  onClick={() =>
                    setShown(
                      shown.includes(p.id) ? shown.filter((x) => x !== p.id) : [...shown, p.id],
                    )
                  }
                >
                  <i className="week-filters-dot" style={{ background: personColor(i) }} />
                  {p.name}
                </button>
              ))}
            </div>
            <WeekBars
              clinic={draft}
              people={people}
              overlays={overlays}
              label="Semana da clínica"
              onChangeClinic={setDraft}
              selectedDay={selectedDay}
              onSelectDay={setSelectedDay}
            />
            <p className="clinic-footnote">
              Horários em múltiplos de 15 min, no fuso de{' '}
              {tz === 'America/Sao_Paulo' ? 'Brasília' : tz}. Escolha pessoas acima para ver quem
              trabalha dentro do horário da clínica.
            </p>
          </div>
          <div className="hours-side">
            <section className="hours-day" aria-labelledby="day-h">
              <h3 id="day-h" className="panel-legend">
                {dayLabel(selectedDay)}
              </h3>
              <p className="clinic-footnote">
                {(draft[selectedDay] ?? []).length === 0
                  ? 'Fechado nesse dia.'
                  : (draft[selectedDay] ?? [])
                      .map((w) => `${formatMinutes(w.startMinute)} – ${formatMinutes(w.endMinute)}`)
                      .join(' · ')}
              </p>
              <ul className="clinic-rows">
                {dayWorkers(selectedDay).map((p) => (
                  <li key={p.id} className="clinic-row">
                    <i className="clinic-row-bar" style={{ background: p.color }} />
                    <span className="clinic-row-main">
                      <strong>{p.name}</strong>
                      <span>
                        {(p.week[selectedDay] ?? [])
                          .map(
                            (w) => `${formatMinutes(w.startMinute)}–${formatMinutes(w.endMinute)}`,
                          )
                          .join(' e ')}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              <Button
                className="panel-btn panel-btn-ghost"
                onPress={() => {
                  const src = draft[selectedDay] ?? []
                  setDraft({
                    ...draft,
                    1: [...src],
                    2: [...src],
                    3: [...src],
                    4: [...src],
                    5: [...src],
                  })
                }}
              >
                Copiar para segunda a sexta
              </Button>
            </section>
            <h3 className="panel-legend">Horas de atendimento</h3>
            <WeekEditor value={draft} onChange={setDraft} label="Horário da clínica" />
            {followers.length > 0 ? (
              <p className="clinic-footnote">
                {followers.length === 1
                  ? '1 profissional segue'
                  : `${followers.length} profissionais seguem`}{' '}
                este horário.
              </p>
            ) : null}
            {error ? (
              <p className="clinic-form-error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="clinic-footer-actions">
              <Button
                className="panel-btn panel-btn-primary"
                isDisabled={!dirty || saving}
                onPress={() => void saveHours()}
              >
                {saving ? 'Salvando…' : dirty ? 'Salvar horário' : 'Horário salvo'}
              </Button>
            </div>
            <section className="clinic-section" aria-labelledby="own-h">
              <h3 id="own-h" className="panel-legend">
                Com horário próprio
              </h3>
              {own.length === 0 ? (
                <p className="clinic-footnote">
                  Todas as profissionais seguem o horário da clínica.
                </p>
              ) : (
                <>
                  <ul className="clinic-rows">
                    {own.map((p) => (
                      <li key={p.id}>
                        <Button
                          className="clinic-row clinic-row-btn"
                          onPress={() =>
                            navigatePanel({
                              kind: 'area',
                              area: 'clinica',
                              tenantId,
                              section: 'profissional',
                              entityId: p.id,
                            })
                          }
                        >
                          <span className="clinic-row-main">
                            <strong>{p.name}</strong>
                            <span>{describeWeek(toWeekDraft(windowsOf(snap, p.id)))}</span>
                          </span>
                        </Button>
                      </li>
                    ))}
                  </ul>
                  {confirmAll ? (
                    <div className="clinic-banner clinic-banner-inline" role="alert">
                      <p>
                        {own.length === 1
                          ? 'Esta profissional passa'
                          : `Estas ${own.length} profissionais passam`}{' '}
                        a seguir o horário da clínica. O horário próprio{' '}
                        {own.length === 1 ? 'deixa' : 'deixam'} de valer; os horários já marcados
                        continuam.
                      </p>
                      <div className="clinic-footer-actions">
                        <Button
                          className="panel-btn panel-btn-ghost"
                          onPress={() => setConfirmAll(false)}
                          isDisabled={saving}
                        >
                          Cancelar
                        </Button>
                        <Button
                          className="panel-btn panel-btn-primary"
                          onPress={() => void followAll()}
                          isDisabled={saving}
                        >
                          {saving ? 'Mudando…' : 'Confirmar'}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      className="panel-btn panel-btn-ghost"
                      onPress={() => setConfirmAll(true)}
                    >
                      {own.length === 1
                        ? 'Passar a seguir o da clínica'
                        : 'Todas passam a seguir o da clínica'}
                    </Button>
                  )}
                </>
              )}
            </section>
          </div>
        </div>
      ) : (
        <>
          <MonthCalendar
            year={ym.year}
            month={ym.month}
            entries={entries}
            timezone={tz}
            todayIso={todayIso}
            onPrev={() => setYm(shiftMonth(ym, -1))}
            onNext={() => setYm(shiftMonth(ym, 1))}
          />
          <section className="clinic-section" aria-labelledby="next-h">
            <h3 id="next-h" className="panel-legend">
              Próximos
            </h3>
            {closing ? (
              <BlockForm
                tenantId={tenantId}
                api={api}
                generation={generation}
                timezone={tz}
                scopes={[
                  { id: CLINIC_SCOPE_ID, label: 'Clínica inteira' },
                  ...professionals.map((p) => ({ id: p.id, label: p.name })),
                ]}
                reasons={['folga', 'ferias', 'feriado', 'manutencao', 'outro']}
                initialReason="feriado"
                saveLabel="Salvar"
                onCancel={() => setClosing(false)}
                onSaved={async () => {
                  setClosing(false)
                  await onSaved()
                }}
              />
            ) : (
              <>
                <ul className="clinic-rows">
                  {upcoming.length === 0 ? (
                    <li className="clinic-empty">Nada marcado daqui para a frente.</li>
                  ) : null}
                  {upcoming.map((e) => (
                    <li key={e.id} className="clinic-row">
                      <i className="clinic-row-bar" style={{ background: e.color }} />
                      <span className="clinic-row-main">
                        <strong>
                          {e.who} · {BLOCK_REASON_LABELS[e.reason] ?? e.reason}
                        </strong>
                        <span>{formatPeriod(e.startsAt, e.endsAt, tz)}</span>
                      </span>
                      <Button
                        className="clinic-row-x"
                        aria-label={`Remover ${e.who}, ${BLOCK_REASON_LABELS[e.reason] ?? e.reason} de ${formatPeriod(e.startsAt, e.endsAt, tz)}`}
                        onPress={() => void removeClosure(e.id)}
                      >
                        ×
                      </Button>
                    </li>
                  ))}
                </ul>
                <Button className="panel-btn panel-btn-primary" onPress={() => setClosing(true)}>
                  + Folga, férias ou fechamento
                </Button>
              </>
            )}
          </section>
        </>
      )}
    </div>
  )
}
