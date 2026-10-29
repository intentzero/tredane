import { ChevronLeft, ChevronRight, Clock, MoreVertical, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button, Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import { PanelApiError, type ClinicConfigSnapshot, type PanelApi } from '../../api'
import { friendlyError } from '../../copy/errors'
import { navigatePanel } from '../../routes'
import { BlockForm } from './BlockForm'
import { ClinicSheet } from './ClinicSheet'
import {
  changedDays,
  civilOf,
  CLINIC_SCOPE_ID,
  describeWeek,
  formatPeriod,
  fromWeekDraft,
  openNow,
  personColor,
  personMark,
  toWeekDraft,
  windowsOf,
  type DayWindows,
  type WeekDraft,
} from './clinicHours'
import { DayEditor } from './DayEditor'
import { BLOCK_REASON_LABELS, dayLabel, formatMinutes } from './format'
import { MonthCalendar, type CalendarEntry } from './MonthCalendar'

type Props = {
  tenantId: string
  snap: ClinicConfigSnapshot
  api: PanelApi
  generation: number
  onSaved: () => Promise<void>
}

const SHORT = ['', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
const BAR_FROM = 7 * 60
const BAR_TO = 20 * 60

type Ym = { year: number; month: number }
const shiftMonth = ({ year, month }: Ym, by: number): Ym => {
  const d = new Date(Date.UTC(year, month + by, 1))
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() }
}

/** Barra fina do dia: onde a clínica atende entre 07h e 20h (decoração; o texto ao lado diz o mesmo). */
function DayBar({ windows }: { windows: DayWindows }) {
  const from = Math.min(BAR_FROM, ...windows.map((w) => Math.floor(w.startMinute / 60) * 60))
  const to = Math.max(BAR_TO, ...windows.map((w) => Math.ceil(w.endMinute / 60) * 60))
  return (
    <span className="hours-daybar" aria-hidden>
      {windows.map((w, i) => (
        <i
          key={i}
          style={{
            left: `${((w.startMinute - from) / (to - from)) * 100}%`,
            width: `${((w.endMinute - w.startMinute) / (to - from)) * 100}%`,
          }}
        />
      ))}
    </span>
  )
}

/**
 * Horário da clínica (Proposto, TEL-09; #223): resumo, os sete dias, folgas e fechamentos e quem
 * segue este horário, na mesma página. Cada dia se edita num único editor; o que muda só vale
 * depois de «Salvar horário». Profissionais que seguem o da clínica mudam junto.
 */
export function ClinicHoursScreen({ tenantId, snap, api, generation, onSaved }: Props) {
  const saved = useMemo(() => toWeekDraft(windowsOf(snap, CLINIC_SCOPE_ID)), [snap])
  const [draft, setDraft] = useState<WeekDraft>(saved)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingDay, setEditingDay] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [confirmAll, setConfirmAll] = useState(false)
  const [showMonth, setShowMonth] = useState(false)
  const fo = { generation, expectGeneration: () => generation }
  const tz = snap.settings.timezone

  const professionals = snap.resources.filter((r) => r.kind === 'professional' && r.active)
  const followers = professionals.filter((p) => p.hoursMode === 'clinic')
  const own = professionals.filter((p) => p.hoursMode !== 'clinic')
  const changed = changedDays(draft, saved)
  const dirty = changed.length > 0

  const now = Date.now()
  const todayIso = civilOf(now, tz)
  const [ym, setYm] = useState<Ym>(() => {
    const [y, m] = todayIso.split('-').map(Number)
    return { year: y!, month: m! - 1 }
  })
  const colorOf = (id: string) =>
    id === CLINIC_SCOPE_ID
      ? '#B42318'
      : personColor(
          Math.max(
            0,
            professionals.findIndex((p) => p.id === id),
          ),
        )
  const nameOf = (id: string) =>
    id === CLINIC_SCOPE_ID ? 'Clínica inteira' : (snap.resources.find((r) => r.id === id)?.name ?? 'Outro')
  const inScope = (id: string) => id === CLINIC_SCOPE_ID || professionals.some((p) => p.id === id)
  const entries: CalendarEntry[] = snap.blocks
    .filter((b) => inScope(b.resourceId))
    .map((b) => ({ id: b.id, startsAt: b.startsAt, endsAt: b.endsAt, color: colorOf(b.resourceId) }))
  const upcoming = snap.blocks
    .filter((b) => inScope(b.resourceId) && b.endsAt >= now)
    .sort((a, b) => a.startsAt - b.startsAt)
    .map((b) => ({ ...b, who: nameOf(b.resourceId), color: colorOf(b.resourceId) }))
  const nextClosure = upcoming.find((b) => b.resourceId === CLINIC_SCOPE_ID)
  const status = openNow(saved, now, tz)

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
          { kind: 'professional', name: p.name, active: p.active, hoursMode: 'clinic' },
          { resourceId: p.id, ...fo },
        )
      }
      setConfirmAll(false)
      await onSaved()
    }, 'Não foi possível mudar todas agora. Tente de novo.')
    setSaving(false)
  }

  async function removeClosure(id: string) {
    setSaving(true)
    await guard(async () => {
      await api.deleteBlock(tenantId, id, fo)
      setRemoving(null)
      await onSaved()
    }, 'Não foi possível remover. Tente de novo.')
    setSaving(false)
  }

  const removingBlock = upcoming.find((b) => b.id === removing)
  const changedLabel =
    changed.length === 1
      ? `${dayLabel(changed[0]!)} alterada`
      : `${changed.map((d) => SHORT[d]).join(', ')} alterados`

  return (
    <div className="clinic-stack clinic-form hours-screen">
      <div className="clinic-toolbar clinic-desktop-hide">
        <Button
          className="panel-btn panel-btn-ghost"
          onPress={() => navigatePanel({ kind: 'area', area: 'clinica', tenantId, section: 'hub' })}
        >
          <ChevronLeft aria-hidden size={18} strokeWidth={2} /> Clínica
        </Button>
      </div>
      <h2 className="panel-title clinic-h2">Horário</h2>

      <section className="hours-summary" aria-label="Resumo do horário">
        <span className="hours-status" data-open={status.open}>
          <Clock aria-hidden size={14} strokeWidth={2.2} />
          {status.open && status.closesAt != null
            ? `Aberta agora · fecha às ${formatMinutes(status.closesAt)}`
            : 'Fechada agora'}
        </span>
        <p className="hours-summary-week">{describeWeek(saved)}</p>
        {nextClosure ? (
          <p className="hours-summary-closure">
            <strong>Fechada {formatPeriod(nextClosure.startsAt, nextClosure.endsAt, tz)}</strong> ·{' '}
            {BLOCK_REASON_LABELS[nextClosure.reason] ?? nextClosure.reason}
          </p>
        ) : null}
      </section>

      <section className="clinic-section" aria-labelledby="week-h">
        <h3 id="week-h" className="panel-legend">
          Semana da clínica
        </h3>
        <ul className="clinic-rows hours-days">
          {[1, 2, 3, 4, 5, 6, 7].map((d) => {
            const list = draft[d] ?? []
            const isChanged = changed.includes(d)
            return (
              <li key={d}>
                <Button
                  className="clinic-row clinic-row-btn hours-day-btn"
                  aria-label={`${dayLabel(d)}, ${
                    list.length === 0
                      ? 'fechado'
                      : list.map((w) => `${formatMinutes(w.startMinute)} às ${formatMinutes(w.endMinute)}`).join(' e ')
                  }${isChanged ? ', alterado' : ''}. Editar`}
                  onPress={() => setEditingDay(d)}
                >
                  <span className="hours-day-name">{SHORT[d]}</span>
                  <span className="clinic-row-main">
                    <span className="hours-day-text" data-closed={list.length === 0}>
                      {list.length === 0
                        ? 'Fechado'
                        : list.map((w) => `${formatMinutes(w.startMinute)}–${formatMinutes(w.endMinute)}`).join(' e ')}
                      {isChanged ? <em className="hours-changed">Alterado</em> : null}
                    </span>
                    <DayBar windows={list} />
                  </span>
                  <ChevronRight aria-hidden size={18} strokeWidth={2} />
                </Button>
              </li>
            )
          })}
        </ul>
        <p className="clinic-footnote">
          Múltiplos de 15 min, no fuso de {tz === 'America/Sao_Paulo' ? 'Brasília' : tz}.
        </p>
      </section>

      <section className="clinic-section" aria-labelledby="off-h">
        <div className="hours-section-head">
          <h3 id="off-h" className="panel-legend">
            Folgas e fechamentos
          </h3>
          <Button className="panel-btn panel-btn-ghost hours-add" onPress={() => setAdding(true)}>
            <Plus aria-hidden size={16} strokeWidth={2.2} /> Adicionar
          </Button>
        </div>
        <ul className="clinic-rows">
          {upcoming.length === 0 ? <li className="clinic-empty">Nada marcado daqui para a frente.</li> : null}
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
                aria-label={`Opções de ${e.who}, ${BLOCK_REASON_LABELS[e.reason] ?? e.reason} de ${formatPeriod(e.startsAt, e.endsAt, tz)}`}
                onPress={() => setRemoving(e.id)}
              >
                <MoreVertical aria-hidden size={18} strokeWidth={2} />
              </Button>
            </li>
          ))}
        </ul>
        <Button className="panel-btn panel-btn-ghost hours-month-toggle" onPress={() => setShowMonth(!showMonth)}>
          {showMonth ? 'Esconder o mês' : 'Ver mês inteiro'}
        </Button>
        {showMonth ? (
          <MonthCalendar
            year={ym.year}
            month={ym.month}
            entries={entries}
            timezone={tz}
            todayIso={todayIso}
            onPrev={() => setYm(shiftMonth(ym, -1))}
            onNext={() => setYm(shiftMonth(ym, 1))}
          />
        ) : null}
      </section>

      <section className="clinic-section" aria-labelledby="own-h">
        <h3 id="own-h" className="panel-legend">
          Quem segue este horário
        </h3>
        {followers.length > 0 ? (
          <p className="hours-followers">
            <strong>{followers.map((p) => p.name).join(' e ')}</strong>{' '}
            {followers.length === 1 ? 'segue' : 'seguem'} o horário da clínica e{' '}
            {followers.length === 1 ? 'muda' : 'mudam'} junto.
          </p>
        ) : null}
        {own.length === 0 ? (
          <p className="clinic-footnote">Todas as profissionais seguem o horário da clínica.</p>
        ) : (
          <>
            <ul className="clinic-rows">
              {own.map((p) => (
                <li key={p.id}>
                  <Button
                    className="clinic-row clinic-row-btn"
                    onPress={() =>
                      navigatePanel({ kind: 'area', area: 'clinica', tenantId, section: 'profissional', entityId: p.id })
                    }
                  >
                    <span className="clinic-row-main">
                      <strong>{p.name} · horário próprio</strong>
                      <span>{describeWeek(toWeekDraft(windowsOf(snap, p.id)))}</span>
                    </span>
                    <ChevronRight aria-hidden size={18} strokeWidth={2} />
                  </Button>
                </li>
              ))}
            </ul>
            {confirmAll ? (
              <div className="clinic-banner clinic-banner-inline" role="alert">
                <p>
                  {own.length === 1 ? 'Esta profissional passa' : `Estas ${own.length} profissionais passam`} a seguir
                  o horário da clínica. O horário próprio {own.length === 1 ? 'deixa' : 'deixam'} de valer; os
                  horários já marcados continuam.
                </p>
                <div className="clinic-footer-actions">
                  <Button className="panel-btn panel-btn-ghost" onPress={() => setConfirmAll(false)} isDisabled={saving}>
                    Cancelar
                  </Button>
                  <Button className="panel-btn panel-btn-primary" onPress={() => void followAll()} isDisabled={saving}>
                    {saving ? 'Mudando…' : 'Confirmar'}
                  </Button>
                </div>
              </div>
            ) : (
              <Button className="panel-btn panel-btn-ghost" onPress={() => setConfirmAll(true)}>
                {own.length === 1 ? 'Passar a seguir o da clínica' : 'Todas passam a seguir o da clínica'}
              </Button>
            )}
          </>
        )}
      </section>

      {error ? (
        <p className="clinic-form-error" role="alert">
          {error}
        </p>
      ) : null}

      {dirty ? (
        <div className="hours-savebar" role="region" aria-label="Alterações no horário">
          <p>
            <strong>{changedLabel}, ainda não salva.</strong>
            {followers.length > 0 ? ` Vale também para ${followers.map((p) => p.name).join(' e ')}.` : ''}
          </p>
          <div className="clinic-footer-actions">
            <Button className="panel-btn panel-btn-ghost" isDisabled={saving} onPress={() => setDraft(saved)}>
              Descartar
            </Button>
            <Button className="panel-btn panel-btn-primary" isDisabled={saving} onPress={() => void saveHours()}>
              {saving ? 'Salvando…' : 'Salvar horário'}
            </Button>
          </div>
        </div>
      ) : null}

      <ClinicSheet
        isOpen={editingDay !== null}
        onOpenChange={(o) => (o ? undefined : setEditingDay(null))}
        title={editingDay ? dayLabel(editingDay) : ''}
      >
        {editingDay ? (
          <DayEditor
            key={editingDay}
            day={editingDay}
            value={draft[editingDay] ?? []}
            followers={followers.map((p) => p.name)}
            onCancel={() => setEditingDay(null)}
            onApply={(windows, also) => {
              const next = { ...draft }
              for (const d of [editingDay, ...also]) next[d] = windows.map((w) => ({ ...w }))
              setDraft(next)
              setEditingDay(null)
            }}
          />
        ) : null}
      </ClinicSheet>

      <ClinicSheet isOpen={adding} onOpenChange={setAdding} title="Folga ou fechamento">
        <BlockForm
          tenantId={tenantId}
          api={api}
          generation={generation}
          timezone={tz}
          scopes={[
            { id: CLINIC_SCOPE_ID, label: 'Clínica inteira', hint: 'Ninguém agenda', color: '#B42318' },
            ...professionals.map((p, i) => ({
              id: p.id,
              label: p.name,
              hint: p.hoursMode === 'clinic' ? 'Segue o horário da clínica' : 'Horário próprio',
              color: personColor(i),
              mark: personMark(i, p.name),
            })),
          ]}
          reasons={['folga', 'ferias', 'feriado', 'manutencao', 'outro']}
          initialReason="feriado"
          saveLabel="Salvar"
          onCancel={() => setAdding(false)}
          onSaved={async () => {
            setAdding(false)
            await onSaved()
          }}
        />
      </ClinicSheet>

      <ModalOverlay
        isOpen={removingBlock !== undefined}
        onOpenChange={(o) => (o ? undefined : setRemoving(null))}
        isDismissable
        className="panel-overlay panel-choice-overlay"
      >
        <Modal className="panel-choice-modal">
          <Dialog className="panel-sheet panel-choice-sheet" aria-labelledby="rm-title">
            <span className="panel-sheet-handle" aria-hidden="true" />
            <Heading slot="title" id="rm-title" className="panel-title panel-choice-title">
              Remover {removingBlock ? `${removingBlock.who} · ${BLOCK_REASON_LABELS[removingBlock.reason] ?? removingBlock.reason}` : ''}?
            </Heading>
            <p className="clinic-footnote">
              {removingBlock ? formatPeriod(removingBlock.startsAt, removingBlock.endsAt, tz) : ''}. Os horários nesse
              período voltam a ficar livres para agendar.
            </p>
            <div className="clinic-footer-actions">
              <Button className="panel-btn panel-btn-ghost" onPress={() => setRemoving(null)} isDisabled={saving}>
                Cancelar
              </Button>
              <Button
                className="panel-btn panel-btn-danger"
                isDisabled={saving}
                onPress={() => removing && void removeClosure(removing)}
              >
                {saving ? 'Removendo…' : 'Remover'}
              </Button>
            </div>
          </Dialog>
        </Modal>
      </ModalOverlay>
    </div>
  )
}
