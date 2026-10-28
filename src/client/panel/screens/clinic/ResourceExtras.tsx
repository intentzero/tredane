import { useMemo, useState } from 'react'
import { Button } from 'react-aria-components'
import {
  PanelApiError,
  type ClinicConfigSnapshot,
  type ClinicResource,
  type ClinicService,
  type PanelApi,
  type ServiceUpsertBody,
} from '../../api'
import { friendlyError } from '../../copy/errors'
import { BlockForm } from './BlockForm'
import {
  blocksOf,
  CLINIC_SCOPE_ID,
  countDays,
  describeWeek,
  formatPeriod,
  fromWeekDraft,
  toWeekDraft,
  windowsOf,
  type WeekDraft,
} from './clinicHours'
import { BLOCK_REASON_LABELS } from './format'
import { Segmented } from './Segmented'
import { WeekEditor } from './WeekEditor'

type Common = {
  tenantId: string
  snap: ClinicConfigSnapshot
  api: PanelApi
  generation: number
  onSaved: () => Promise<void>
}

/** Corpo de gravação de um serviço, preservando tudo o que não muda. */
export function serviceBody(
  s: ClinicService,
  patch: Partial<ServiceUpsertBody> = {},
): ServiceUpsertBody {
  return {
    name: s.name,
    durationMinutes: s.durationMinutes,
    bufferMinutes: s.bufferMinutes,
    priceCents: s.priceCents,
    clientExplanation: s.clientExplanation,
    active: s.active,
    professionalIds: s.professionalIds,
    roomRequirement: s.roomRequirement,
    requiresSignal: s.requiresSignal,
    signalKind: s.signalKind,
    signalFixedCents: s.signalFixedCents,
    signalPercent: s.signalPercent,
    durationAdjustable: s.durationAdjustable ?? false,
    durationMinMinutes: s.durationMinMinutes ?? null,
    durationMaxMinutes: s.durationMaxMinutes ?? null,
    ...patch,
  }
}

function useGuard() {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function run(fn: () => Promise<void>, fallback: string) {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      if (!(err instanceof PanelApiError && err.message === 'stale_tenant_response')) {
        setError(friendlyError(err, fallback))
      }
    } finally {
      setBusy(false)
    }
  }
  return { error, busy, run }
}

/** Folgas e férias (profissional) ou fechamentos (sala): lista + formulário com período. */
function BlocksSection({
  resource,
  title,
  addLabel,
  reasons,
  initialReason,
  ...c
}: Common & {
  resource: ClinicResource
  title: string
  addLabel: string
  reasons: Array<'folga' | 'ferias' | 'feriado' | 'manutencao' | 'outro'>
  initialReason: 'folga' | 'ferias' | 'manutencao'
}) {
  const [adding, setAdding] = useState(false)
  const { error, run } = useGuard()
  const tz = c.snap.settings.timezone
  const fo = { generation: c.generation, expectGeneration: () => c.generation }
  const now = Date.now()
  const blocks = blocksOf(c.snap, resource.id).filter((b) => b.endsAt >= now)

  return (
    <section className="clinic-section" aria-labelledby={`blk-${resource.id}`}>
      <h3 id={`blk-${resource.id}`} className="panel-legend">
        {title}
      </h3>
      {adding ? (
        <BlockForm
          tenantId={c.tenantId}
          api={c.api}
          generation={c.generation}
          timezone={tz}
          scopes={[{ id: resource.id, label: resource.name }]}
          reasons={reasons}
          initialReason={initialReason}
          saveLabel={addLabel}
          onCancel={() => setAdding(false)}
          onSaved={async () => {
            setAdding(false)
            await c.onSaved()
          }}
        />
      ) : (
        <>
          <ul className="clinic-rows">
            {blocks.length === 0 ? (
              <li className="clinic-empty">Nada marcado daqui para a frente.</li>
            ) : null}
            {blocks.map((b) => {
              const days = countDays(b.startsAt, b.endsAt, tz)
              return (
                <li key={b.id} className="clinic-row">
                  <span className="clinic-row-main">
                    <strong>
                      {BLOCK_REASON_LABELS[b.reason] ?? b.reason} ·{' '}
                      {formatPeriod(b.startsAt, b.endsAt, tz)}
                    </strong>
                    <span>{days === 1 ? '1 dia' : `${days} dias`}</span>
                  </span>
                  <Button
                    className="clinic-row-x"
                    aria-label={`Remover ${BLOCK_REASON_LABELS[b.reason] ?? b.reason} de ${formatPeriod(b.startsAt, b.endsAt, tz)}`}
                    onPress={() =>
                      void run(async () => {
                        await c.api.deleteBlock(c.tenantId, b.id, fo)
                        await c.onSaved()
                      }, 'Não foi possível remover.')
                    }
                  >
                    ×
                  </Button>
                </li>
              )
            })}
          </ul>
          <Button className="panel-btn panel-btn-secondary" onPress={() => setAdding(true)}>
            {`+ ${addLabel}`}
          </Button>
        </>
      )}
      {error ? (
        <p className="clinic-form-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}

/** Ficha da profissional: serviços que faz, horário (clínica ou próprio) e folgas. */
export function ProfessionalExtras({ resource, ...c }: Common & { resource: ClinicResource }) {
  const { error, busy, run } = useGuard()
  const fo = { generation: c.generation, expectGeneration: () => c.generation }
  const services = c.snap.services.filter((s) => s.active)
  const clinicWeek = toWeekDraft(windowsOf(c.snap, CLINIC_SCOPE_ID))
  const ownSaved = useMemo(() => toWeekDraft(windowsOf(c.snap, resource.id)), [c.snap, resource.id])
  const [ownDraft, setOwnDraft] = useState<WeekDraft>(ownSaved)
  const follows = resource.hoursMode === 'clinic'
  const [tab, setTab] = useState<'servicos' | 'horario' | 'folgas'>('servicos')
  const dirty = JSON.stringify(ownDraft) !== JSON.stringify(ownSaved)

  const doesIt = (s: ClinicService) => s.professionalIds.includes(resource.id)
  const count = services.filter(doesIt).length

  return (
    <>
      <Segmented
        label={`Ficha de ${resource.name}`}
        value={tab}
        options={[
          { id: 'servicos', label: 'Serviços' },
          { id: 'horario', label: 'Horário' },
          { id: 'folgas', label: 'Folgas' },
        ]}
        onChange={setTab}
      />
      {tab === 'servicos' ? (
        <section className="clinic-section" aria-labelledby={`svc-${resource.id}`}>
          <h3 id={`svc-${resource.id}`} className="panel-legend">
            Serviços que faz
          </h3>
          <div
            className="block-form-chips"
            role="group"
            aria-label={`Serviços que ${resource.name} faz`}
          >
            {services.map((s) => (
              <button
                key={s.id}
                type="button"
                className="block-form-chip"
                aria-pressed={doesIt(s)}
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const next = doesIt(s)
                      ? s.professionalIds.filter((id) => id !== resource.id)
                      : [...s.professionalIds, resource.id]
                    await c.api.upsertService(
                      c.tenantId,
                      serviceBody(s, { professionalIds: next }),
                      {
                        serviceId: s.id,
                        ...fo,
                      },
                    )
                    await c.onSaved()
                  }, 'Não foi possível mudar o serviço.')
                }
              >
                {s.name}
              </button>
            ))}
          </div>
          <p className="clinic-footnote">
            {services.length === 0
              ? 'Cadastre serviços para marcar aqui. Dá para fazer isso depois.'
              : `${count} de ${services.length} serviços · toque para marcar ou desmarcar. É a mesma lista de «Quem faz» em cada serviço.`}
          </p>
        </section>
      ) : null}

      {tab === 'horario' ? (
        <section className="clinic-section" aria-labelledby={`hrs-${resource.id}`}>
          <h3 id={`hrs-${resource.id}`} className="panel-legend">
            Horário
          </h3>
          <div className="week-mode" role="radiogroup" aria-label={`Horário de ${resource.name}`}>
            <button
              type="button"
              role="radio"
              aria-checked={follows}
              disabled={busy}
              className="week-mode-btn"
              onClick={() =>
                !follows &&
                void run(async () => {
                  await c.api.upsertResource(
                    c.tenantId,
                    {
                      kind: 'professional',
                      name: resource.name,
                      active: resource.active,
                      hoursMode: 'clinic',
                    },
                    { resourceId: resource.id, ...fo },
                  )
                  await c.onSaved()
                }, 'Não foi possível mudar o horário.')
              }
            >
              Igual ao da clínica
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={!follows}
              disabled={busy}
              className="week-mode-btn"
              onClick={() =>
                follows &&
                void run(async () => {
                  // Começa de uma cópia do horário da clínica, para não ficar sem horário.
                  if (windowsOf(c.snap, resource.id).length === 0) {
                    await c.api.setWeeklyWindows(
                      c.tenantId,
                      resource.id,
                      fromWeekDraft(clinicWeek),
                      fo,
                    )
                  }
                  await c.api.upsertResource(
                    c.tenantId,
                    {
                      kind: 'professional',
                      name: resource.name,
                      active: resource.active,
                      hoursMode: 'own',
                    },
                    { resourceId: resource.id, ...fo },
                  )
                  await c.onSaved()
                }, 'Não foi possível mudar o horário.')
              }
            >
              Horário próprio
            </button>
          </div>
          {follows ? (
            <p className="clinic-footnote">{describeWeek(clinicWeek)}</p>
          ) : (
            <>
              <WeekEditor
                value={ownDraft}
                onChange={setOwnDraft}
                label={`Horário de ${resource.name}`}
              />
              <div className="clinic-footer-actions">
                <Button
                  className="panel-btn panel-btn-primary"
                  isDisabled={!dirty || busy}
                  onPress={() =>
                    void run(async () => {
                      await c.api.setWeeklyWindows(
                        c.tenantId,
                        resource.id,
                        fromWeekDraft(ownDraft),
                        fo,
                      )
                      await c.onSaved()
                    }, 'Não foi possível salvar o horário.')
                  }
                >
                  {dirty ? 'Salvar horário' : 'Horário salvo'}
                </Button>
              </div>
            </>
          )}
        </section>
      ) : null}

      {tab === 'folgas' ? (
        <BlocksSection
          resource={resource}
          title="Folgas e férias"
          addLabel="Folga ou férias"
          reasons={['folga', 'ferias', 'outro']}
          initialReason="folga"
          {...c}
        />
      ) : null}
      {error ? (
        <p className="clinic-form-error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  )
}

/** Ficha da sala: serviços feitos ali (no lugar da categoria) e fechamentos. */
export function RoomExtras({ resource, ...c }: Common & { resource: ClinicResource }) {
  const { error, busy, run } = useGuard()
  const fo = { generation: c.generation, expectGeneration: () => c.generation }
  const services = c.snap.services.filter((s) => s.active)
  const usesIt = (s: ClinicService) =>
    s.roomRequirement.mode === 'resource' && s.roomRequirement.resourceId === resource.id

  return (
    <>
      <section className="clinic-section" aria-labelledby={`rsv-${resource.id}`}>
        <h3 id={`rsv-${resource.id}`} className="panel-legend">
          Serviços feitos aqui
        </h3>
        <div
          className="block-form-chips"
          role="group"
          aria-label={`Serviços feitos em ${resource.name}`}
        >
          {services.map((s) => (
            <button
              key={s.id}
              type="button"
              className="block-form-chip"
              aria-pressed={usesIt(s)}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await c.api.upsertService(
                    c.tenantId,
                    serviceBody(s, {
                      roomRequirement: usesIt(s)
                        ? { mode: 'none' }
                        : { mode: 'resource', resourceId: resource.id },
                    }),
                    { serviceId: s.id, ...fo },
                  )
                  await c.onSaved()
                }, 'Não foi possível mudar o serviço.')
              }
            >
              {s.name}
            </button>
          ))}
        </div>
        <p className="clinic-footnote">
          Marcar um serviço aqui troca a sala que ele pedia antes. Para aceitar várias salas, use
          «Qualquer sala livre» dentro do serviço.
        </p>
      </section>
      <BlocksSection
        resource={resource}
        title="Fechada para manutenção"
        addLabel="Fechar esta sala"
        reasons={['manutencao', 'outro']}
        initialReason="manutencao"
        {...c}
      />
      {error ? (
        <p className="clinic-form-error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  )
}
