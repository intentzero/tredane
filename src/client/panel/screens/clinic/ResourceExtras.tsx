import { useState } from 'react'
import { Button, Input, Label, TextField } from 'react-aria-components'
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
    durationAdjustable: false,
    durationMinMinutes: null,
    durationMaxMinutes: null,
    weeklyWindows: s.weeklyWindows ?? [],
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

type ProDraftProps = Common & {
  resource: ClinicResource
  /** IDs dos serviços no rascunho (DEC-083). */
  draftServiceIds: string[]
  onToggleService: (serviceId: string) => void
  hoursMode: 'clinic' | 'own'
  onHoursMode: (mode: 'clinic' | 'own') => void
  ownDraft: WeekDraft
  onOwnDraft: (draft: WeekDraft) => void
}

/** Ficha da profissional em rascunho: chips e horário só gravam com Salvar (DEC-083). */
export function ProfessionalExtras({
  resource,
  draftServiceIds,
  onToggleService,
  hoursMode,
  onHoursMode,
  ownDraft,
  onOwnDraft,
  ...c
}: ProDraftProps) {
  const services = c.snap.services.filter((s) => s.active)
  const clinicWeek = toWeekDraft(windowsOf(c.snap, CLINIC_SCOPE_ID))
  const follows = hoursMode === 'clinic'
  const [tab, setTab] = useState<'servicos' | 'horario' | 'folgas'>('servicos')
  const count = draftServiceIds.length

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
                aria-pressed={draftServiceIds.includes(s.id)}
                onClick={() => onToggleService(s.id)}
              >
                {s.name}
              </button>
            ))}
          </div>
          <p className="clinic-footnote">
            {services.length === 0
              ? 'Cadastre serviços para marcar aqui. Dá para fazer isso depois.'
              : `${count} de ${services.length} serviços · toque para marcar ou desmarcar. Salvar aplica também em «Quem faz» de cada serviço.`}
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
              className="week-mode-btn"
              onClick={() => onHoursMode('clinic')}
            >
              Igual ao da clínica
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={!follows}
              className="week-mode-btn"
              onClick={() => {
                if (follows) {
                  // Ao passar a próprio, começa com cópia do da clínica se ainda vazio.
                  const empty = Object.values(ownDraft).every((d) => (d?.length ?? 0) === 0)
                  if (empty) onOwnDraft(clinicWeek)
                }
                onHoursMode('own')
              }}
            >
              Horário próprio
            </button>
          </div>
          {follows ? (
            <p className="clinic-footnote">{describeWeek(clinicWeek)}</p>
          ) : (
            <WeekEditor
              value={ownDraft}
              onChange={onOwnDraft}
              label={`Horário de ${resource.name}`}
            />
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
    </>
  )
}

type RoomDraftProps = Common & {
  resource: ClinicResource
  draftServiceIds: string[]
  onToggleService: (serviceId: string) => void
  /** Frase WhatsApp e manutenção ficam em «Mais» (DEC-084 / #336). */
  moreOpen: boolean
  onMoreOpen: (open: boolean) => void
  sharedNotice: string
  onSharedNotice: (value: string) => void
}

/** Ficha da sala em rascunho: serviços feitos aqui só gravam com Salvar (DEC-083). */
export function RoomExtras({
  resource,
  draftServiceIds,
  onToggleService,
  moreOpen,
  onMoreOpen,
  sharedNotice,
  onSharedNotice,
  ...c
}: RoomDraftProps) {
  const services = c.snap.services.filter((s) => s.active)

  return (
    <>
      {resource.kind === 'room' ? (
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
                aria-pressed={draftServiceIds.includes(s.id)}
                onClick={() => onToggleService(s.id)}
              >
                {s.name}
              </button>
            ))}
          </div>
          <p className="clinic-footnote">
            Marcar muda «Onde acontece» no serviço. Só grava ao Salvar.
          </p>
        </section>
      ) : null}

      <section className="service-more">
        <button
          type="button"
          className="service-more-head"
          aria-expanded={moreOpen}
          onClick={() => onMoreOpen(!moreOpen)}
        >
          <span className="service-more-copy">
            <strong>Mais</strong>
            <span>
              {[
                sharedNotice.trim() ? 'frase no WhatsApp' : null,
                'manutenção',
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </span>
          <span aria-hidden className="service-more-chev" data-open={moreOpen || undefined}>
            ›
          </span>
        </button>
        {moreOpen ? (
          <div className="service-more-body">
            {resource.kind === 'room' ? (
              <>
                <TextField className="clinic-field">
                  <Label>Frase para a confirmação pelo WhatsApp (opcional)</Label>
                  <Input
                    autoComplete="off"
                    maxLength={300}
                    value={sharedNotice}
                    onChange={(e) => onSharedNotice(e.target.value)}
                    placeholder="Ex.: O espaço de bronzeamento é compartilhado."
                  />
                </TextField>
                <p className="clinic-footnote">
                  Entra na mensagem de confirmação dos horários nesta sala. Não diga quantas vagas
                  restam.
                </p>
              </>
            ) : null}
            <BlocksSection
              resource={resource}
              title="Fechada para manutenção"
              addLabel="Fechar esta sala"
              reasons={['manutencao', 'outro']}
              initialReason="manutencao"
              {...c}
            />
          </div>
        ) : null}
      </section>
    </>
  )
}

/** Nomes dos serviços cujo «Quem faz» muda ao gravar a profissional. */
export function professionalEffectNames(
  snap: ClinicConfigSnapshot,
  resourceId: string,
  draftServiceIds: string[],
): string[] {
  const names: string[] = []
  for (const s of snap.services) {
    if (!s.active) continue
    const was = s.professionalIds.includes(resourceId)
    const now = draftServiceIds.includes(s.id)
    if (was !== now) names.push(s.name)
  }
  return names
}

/** Nomes dos serviços cujo «Onde acontece» muda ao gravar a sala. */
export function roomEffectNames(
  snap: ClinicConfigSnapshot,
  resourceId: string,
  draftServiceIds: string[],
): string[] {
  const names: string[] = []
  for (const s of snap.services) {
    if (!s.active) continue
    const was =
      s.roomRequirement.mode === 'rooms' && s.roomRequirement.resourceIds.includes(resourceId)
    const now = draftServiceIds.includes(s.id)
    if (was !== now) names.push(s.name)
  }
  return names
}

export { fromWeekDraft, toWeekDraft, windowsOf, CLINIC_SCOPE_ID }
export type { WeekDraft }
