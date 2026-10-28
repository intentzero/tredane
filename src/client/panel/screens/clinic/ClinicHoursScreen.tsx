import { ChevronLeft } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from 'react-aria-components'
import { PanelApiError, type ClinicConfigSnapshot, type PanelApi } from '../../api'
import { friendlyError } from '../../copy/errors'
import { navigatePanel } from '../../routes'
import { BlockForm } from './BlockForm'
import {
  blocksOf,
  CLINIC_SCOPE_ID,
  describeWeek,
  formatPeriod,
  fromWeekDraft,
  toWeekDraft,
  windowsOf,
  type WeekDraft,
} from './clinicHours'
import { BLOCK_REASON_LABELS } from './format'
import { WeekEditor } from './WeekEditor'

type Props = {
  tenantId: string
  snap: ClinicConfigSnapshot
  api: PanelApi
  generation: number
  onSaved: () => Promise<void>
}

const same = (a: WeekDraft, b: WeekDraft) => JSON.stringify(a) === JSON.stringify(b)

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
  const fo = { generation, expectGeneration: () => generation }
  const tz = snap.settings.timezone

  const professionals = snap.resources.filter((r) => r.kind === 'professional' && r.active)
  const followers = professionals.filter((p) => p.hoursMode === 'clinic')
  const own = professionals.filter((p) => p.hoursMode !== 'clinic')
  const closures = blocksOf(snap, CLINIC_SCOPE_ID)
  const dirty = !same(draft, saved)

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
          onPress={() => navigatePanel({ kind: 'area', area: 'clinica', tenantId, section: 'hub' })}
        >
          <ChevronLeft aria-hidden size={18} strokeWidth={2} /> Clínica
        </Button>
      </div>
      <h2 className="panel-title clinic-h2">Horário da clínica</h2>
      <p className="clinic-footnote">
        Profissionais seguem este horário, a não ser que tenham um horário próprio. Horários em múltiplos de 15 min,
        no fuso de {tz === 'America/Sao_Paulo' ? 'Brasília' : tz}.
      </p>

      <WeekEditor value={draft} onChange={setDraft} label="Horário da clínica" />
      {followers.length > 0 ? (
        <p className="clinic-footnote">
          {followers.length === 1 ? '1 profissional segue' : `${followers.length} profissionais seguem`} este horário.
        </p>
      ) : null}
      {error ? (
        <p className="clinic-form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="clinic-footer-actions">
        <Button className="panel-btn panel-btn-primary" isDisabled={!dirty || saving} onPress={() => void saveHours()}>
          {saving ? 'Salvando…' : dirty ? 'Salvar horário' : 'Horário salvo'}
        </Button>
      </div>

      <section className="clinic-section" aria-labelledby="closed-h">
        <h3 id="closed-h" className="panel-legend">
          Clínica fechada
        </h3>
        <p className="clinic-footnote">Feriados e dias sem atendimento, para todos.</p>
        {closing ? (
          <BlockForm
            tenantId={tenantId}
            api={api}
            generation={generation}
            timezone={tz}
            scopes={[{ id: CLINIC_SCOPE_ID, label: 'Clínica inteira' }]}
            reasons={['feriado', 'manutencao', 'outro']}
            initialReason="feriado"
            saveLabel="Fechar a clínica"
            onCancel={() => setClosing(false)}
            onSaved={async () => {
              setClosing(false)
              await onSaved()
            }}
          />
        ) : (
          <>
            <ul className="clinic-rows">
              {closures.length === 0 ? <li className="clinic-empty">Nenhum fechamento marcado.</li> : null}
              {closures.map((b) => (
                <li key={b.id} className="clinic-row">
                  <span className="clinic-row-main">
                    <strong>{formatPeriod(b.startsAt, b.endsAt, tz)}</strong>
                    <span>{BLOCK_REASON_LABELS[b.reason] ?? b.reason}</span>
                  </span>
                  <Button
                    className="clinic-row-x"
                    aria-label={`Remover fechamento de ${formatPeriod(b.startsAt, b.endsAt, tz)}`}
                    onPress={() => void removeClosure(b.id)}
                  >
                    ×
                  </Button>
                </li>
              ))}
            </ul>
            <Button className="panel-btn panel-btn-secondary" onPress={() => setClosing(true)}>
              + Fechar a clínica
            </Button>
          </>
        )}
      </section>

      <section className="clinic-section" aria-labelledby="own-h">
        <h3 id="own-h" className="panel-legend">
          Com horário próprio
        </h3>
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
                  {own.length === 1 ? 'Esta profissional passa' : `Estas ${own.length} profissionais passam`} a seguir o
                  horário da clínica. O horário próprio {own.length === 1 ? 'deixa' : 'deixam'} de valer; os horários já
                  marcados continuam.
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
    </div>
  )
}
