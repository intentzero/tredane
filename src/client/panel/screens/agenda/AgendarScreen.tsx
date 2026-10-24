import { ChevronLeft, RefreshCw, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  Button,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  Select,
  SelectValue,
} from 'react-aria-components'
import {
  PanelApiError,
  type AvailabilityResponse,
  type AvailabilitySlot,
  type ClinicConfigSnapshot,
  type PanelApi,
} from '../../api'
import { navigatePanel } from '../../routes'
import { ErrorState, LoadingState } from '../../states/StatusScreens'
import {
  formatDayLabel,
  formatSlotTime,
  reasonLabel,
  upcomingCivilDates,
} from './format'

type Props = {
  tenantId: string
  api: PanelApi
  generation: number
}

const ANY = 'any'

/**
 * TEL-05 / M-04 — seleção de horários livres (#35).
 * Confirmação atómica fica em #36; aqui só consulta + revalidação.
 */
export function AgendarScreen({ tenantId, api, generation }: Props) {
  const [config, setConfig] = useState<ClinicConfigSnapshot | null>(null)
  const [serviceId, setServiceId] = useState<string>('')
  const [professionalId, setProfessionalId] = useState<string>(ANY)
  const [date, setDate] = useState<string>('')
  const [availability, setAvailability] = useState<AvailabilityResponse | null>(
    null,
  )
  const [selected, setSelected] = useState<AvailabilitySlot | null>(null)
  const [conflict, setConflict] = useState<string | null>(null)
  const [loadingConfig, setLoadingConfig] = useState(true)
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  const timezone = config?.settings.timezone ?? 'America/Sao_Paulo'
  const days = upcomingCivilDates(timezone, Date.now(), 7)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoadingConfig(true)
      setError(null)
      try {
        const snap = await api.getClinicConfig(tenantId, {
          generation,
          expectGeneration: () => generation,
        })
        if (cancelled) return
        setConfig(snap)
        const firstSvc = snap.services.find((s) => s.active)
        setServiceId((prev) => prev || firstSvc?.id || '')
        setDate((prev) => prev || upcomingCivilDates(snap.settings.timezone, Date.now(), 1)[0]!)
      } catch (err) {
        if (cancelled) return
        if (err instanceof PanelApiError && err.message === 'stale_tenant_response') return
        setError(err instanceof Error ? err.message : 'Falha ao carregar')
      } finally {
        if (!cancelled) setLoadingConfig(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [api, tenantId, generation])

  const reloadSlots = useCallback(async () => {
    if (!serviceId || !date) return
    setLoadingSlots(true)
    setConflict(null)
    try {
      const res = await api.queryAvailability(
        tenantId,
        {
          serviceId,
          date,
          professionalId: professionalId === ANY ? undefined : professionalId,
        },
        { generation, expectGeneration: () => generation },
      )
      setAvailability(res)
      setSelected((prev) => {
        if (!prev) return null
        const still = res.slots.find(
          (s) =>
            s.startsAt === prev.startsAt
            && s.professionalId === prev.professionalId
            && s.roomResourceId === prev.roomResourceId,
        )
        if (!still) {
          setConflict(
            'Esse horário acabou de ficar indisponível. Escolha outro horário.',
          )
          return null
        }
        return still
      })
    } catch (err) {
      if (err instanceof PanelApiError && err.message === 'stale_tenant_response') return
      setError(err instanceof Error ? err.message : 'Falha na disponibilidade')
      setAvailability(null)
    } finally {
      setLoadingSlots(false)
    }
  }, [api, tenantId, generation, serviceId, date, professionalId])

  useEffect(() => {
    void reloadSlots()
  }, [reloadSlots])

  // Atualização após mudança remota — polling leve enquanto a tela está aberta.
  useEffect(() => {
    const id = window.setInterval(() => {
      void reloadSlots()
    }, 15_000)
    return () => window.clearInterval(id)
  }, [reloadSlots])

  const service = config?.services.find((s) => s.id === serviceId)
  const professionals =
    config?.resources.filter(
      (r) =>
        r.kind === 'professional'
        && r.active
        && (!service || service.professionalIds.length === 0
          || service.professionalIds.includes(r.id)),
    ) ?? []

  async function handleRevalidate() {
    if (!selected || !serviceId) return
    setChecking(true)
    setConflict(null)
    try {
      const check = await api.checkAvailabilitySlot(
        tenantId,
        {
          serviceId,
          professionalId: selected.professionalId,
          roomResourceId: selected.roomResourceId,
          startsAt: selected.startsAt,
        },
        { generation, expectGeneration: () => generation },
      )
      if (!check.available) {
        const detail = check.reasons.map(reasonLabel).join(' · ')
        setConflict(
          `Esse horário acabou de ser ocupado${detail ? ` (${detail})` : ''}. Nada foi reservado. Escolha outro horário.`,
        )
        setSelected(null)
        await reloadSlots()
        return
      }
      setConflict(
        'Horário ainda livre. A confirmação atómica do compromisso chega na fatia #36.',
      )
    } catch (err) {
      setConflict(err instanceof Error ? err.message : 'Falha ao revalidar')
    } finally {
      setChecking(false)
    }
  }

  if (loadingConfig && !config) {
    return <LoadingState label="A carregar agenda…" />
  }
  if (error && !config) {
    return (
      <ErrorState
        title="Agenda indisponível"
        description={error}
        actionLabel="Voltar"
        onAction={() =>
          navigatePanel({ kind: 'area', area: 'agenda', tenantId, section: 'dia' })
        }
      />
    )
  }
  if (!config) return null

  if (!config.readiness.schedulingAllowed) {
    return (
      <div className="agenda-agendar">
        <header className="panel-header">
          <Button
            className="panel-icon-btn"
            aria-label="Fechar sem agendar"
            onPress={() =>
              navigatePanel({ kind: 'area', area: 'agenda', tenantId, section: 'dia' })
            }
          >
            <ChevronLeft aria-hidden size={22} strokeWidth={2} />
          </Button>
          <div>
            <h1 className="panel-title">Agendar horário</h1>
          </div>
        </header>
        <div className="panel-scroll">
          <p className="clinic-banner" role="status">
            A agenda desta clínica ainda não foi configurada. O responsável precisa
            de serviços, profissionais, salas e expediente antes de marcar horários.
          </p>
        </div>
      </div>
    )
  }

  const confirmLabel = selected
    ? `Revalidar ${formatSlotTime(selected.startsAt, timezone)}`
    : 'Escolha um horário'

  return (
    <div className="agenda-agendar" data-screen="m04-agendar">
      <header className="panel-header">
        <Button
          className="panel-icon-btn"
          aria-label="Fechar sem agendar"
          onPress={() =>
            navigatePanel({ kind: 'area', area: 'agenda', tenantId, section: 'dia' })
          }
        >
          <ChevronLeft aria-hidden size={22} strokeWidth={2} />
        </Button>
        <div>
          <h1 className="panel-title">Agendar horário</h1>
          <span className="panel-subtitle">Consulta de disponibilidade</span>
        </div>
        <Button
          className="panel-icon-btn"
          aria-label="Atualizar horários"
          onPress={() => void reloadSlots()}
          isDisabled={loadingSlots}
        >
          <RefreshCw aria-hidden size={20} strokeWidth={2} />
        </Button>
      </header>

      <div className="panel-scroll">
        {conflict ? (
          <div className="panel-banner" role="alert">
            <TriangleAlert aria-hidden size={20} strokeWidth={2} />
            <span>{conflict}</span>
          </div>
        ) : null}

        <Select
          className="panel-field"
          selectedKey={serviceId || null}
          onSelectionChange={(key) => {
            if (typeof key === 'string') {
              setServiceId(key)
              setSelected(null)
            }
          }}
        >
          <Label>Serviço</Label>
          <Button className="panel-select-trigger">
            <SelectValue />
          </Button>
          <Popover className="panel-popover">
            <ListBox className="panel-listbox">
              {config.services
                .filter((s) => s.active)
                .map((s) => (
                  <ListBoxItem
                    key={s.id}
                    id={s.id}
                    className="panel-select-item"
                    textValue={s.name}
                  >
                    {s.name}
                  </ListBoxItem>
                ))}
            </ListBox>
          </Popover>
        </Select>
        {service ? (
          <span className="panel-field-hint">
            {service.durationMinutes} min
            {service.bufferMinutes > 0
              ? ` + ${service.bufferMinutes} min de intervalo`
              : ''}
            {' · '}
            {service.occupiedMinutes} min de ocupação
          </span>
        ) : null}

        <Select
          className="panel-field"
          selectedKey={professionalId}
          onSelectionChange={(key) => {
            if (typeof key === 'string') {
              setProfessionalId(key)
              setSelected(null)
            }
          }}
        >
          <Label>Profissional</Label>
          <Button className="panel-select-trigger">
            <SelectValue />
          </Button>
          <Popover className="panel-popover">
            <ListBox className="panel-listbox">
              <ListBoxItem id={ANY} className="panel-select-item" textValue="Qualquer disponível">
                Qualquer disponível
              </ListBoxItem>
              {professionals.map((p) => (
                <ListBoxItem
                  key={p.id}
                  id={p.id}
                  className="panel-select-item"
                  textValue={p.name}
                >
                  {p.name}
                </ListBoxItem>
              ))}
            </ListBox>
          </Popover>
        </Select>

        <fieldset className="panel-fieldset">
          <legend className="panel-legend">Dia</legend>
          <div className="panel-day-row" role="group" aria-label="Dia">
            {days.map((d) => {
              const label = formatDayLabel(d, timezone)
              return (
                <button
                  key={d}
                  type="button"
                  className="panel-day"
                  aria-pressed={date === d}
                  onClick={() => {
                    setDate(d)
                    setSelected(null)
                  }}
                >
                  <span>{label.weekday}</span>
                  <span>{label.day}</span>
                </button>
              )
            })}
          </div>
        </fieldset>

        <fieldset className="panel-fieldset">
          <legend className="panel-legend">
            Horários livres para profissional e sala
          </legend>
          {loadingSlots && !availability ? (
            <p className="panel-meta">A carregar horários…</p>
          ) : null}
          {availability && availability.slots.length === 0 ? (
            <p className="panel-meta" role="status">
              Sem horários livres neste dia para a combinação escolhida.
            </p>
          ) : null}
          {availability?.slots.map((slot) => {
            const pressed =
              selected?.startsAt === slot.startsAt
              && selected.professionalId === slot.professionalId
              && selected.roomResourceId === slot.roomResourceId
            return (
              <button
                key={`${slot.startsAt}:${slot.professionalId}:${slot.roomResourceId ?? ''}`}
                type="button"
                className="panel-slot"
                aria-pressed={pressed}
                onClick={() => {
                  setSelected(slot)
                  setConflict(null)
                }}
              >
                <span>{formatSlotTime(slot.startsAt, timezone)}</span>
                <span>
                  {slot.professionalName}
                  {slot.roomResourceName ? ` · ${slot.roomResourceName}` : ''}
                </span>
              </button>
            )
          })}
        </fieldset>
      </div>

      <div className="panel-footer">
        <Button
          className="panel-btn-primary"
          isDisabled={!selected || checking}
          onPress={() => void handleRevalidate()}
        >
          {checking ? 'A revalidar…' : confirmLabel}
        </Button>
      </div>
    </div>
  )
}
