import { CalendarClock } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from 'react-aria-components'
import type { AvailabilitySlot, ClinicService, PanelApi } from '../../api'
import { friendlyError } from '../../copy/errors'
import {
  formatDayLabel,
  formatLongDate,
  formatSlotTime,
  upcomingCivilDates,
} from '../agenda/format'

const DAYS = 5
const MAX_PICKS = 3

type Pick = { date: string; slot: AvailabilitySlot }

type Props = {
  tenantId: string
  api: PanelApi
  generation: number
  /** Texto montado para o campo de mensagem; nada é enviado daqui. */
  onPropose: (text: string) => void
}

/** «15h30» a partir de «15:30». */
function spoken(time: string): string {
  return time.replace(':', 'h').replace(/h00$/, 'h')
}

/** Mensagem de proposta, agrupada por dia civil. */
export function buildProposalText(picks: Pick[], timeZone: string): string {
  const byDate = new Map<string, string[]>()
  for (const p of picks) {
    const t = spoken(formatSlotTime(p.slot.startsAt, timeZone))
    byDate.set(p.date, [...(byDate.get(p.date) ?? []), t])
  }
  const parts = [...byDate.entries()].map(([date, times]) => {
    const when = formatLongDate(date, timeZone).toLowerCase()
    return `${when}, às ${times.join(' ou ')}`
  })
  const total = picks.length
  if (total === 1) return `Tenho ${parts[0]}. Serve para você?`
  return `Tenho ${parts.join('; ')}. Qual prefere?`
}

/**
 * Atalho de horários livres sobre o compositor. Só lê a disponibilidade e monta um
 * rascunho: quem revisa e envia é a pessoa. Horário com aviso do bloco Tempo
 * (DEC-077) não é proposto aqui; fica para o Agendar.
 */
export function FreeSlotsStrip({ tenantId, api, generation, onPropose }: Props) {
  const [open, setOpen] = useState(false)
  const [services, setServices] = useState<ClinicService[] | null>(null)
  const [timezone, setTimezone] = useState('America/Sao_Paulo')
  const [serviceId, setServiceId] = useState('')
  const [date, setDate] = useState('')
  const [slots, setSlots] = useState<AvailabilitySlot[] | null>(null)
  const [professionalId, setProfessionalId] = useState('any')
  const [picks, setPicks] = useState<Pick[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const fo = useMemo(
    () => ({ generation, expectGeneration: () => generation }),
    [generation],
  )

  // Configuração só na primeira abertura: a faixa fechada não custa uma requisição.
  useEffect(() => {
    if (!open || services) return
    let cancelled = false
    setError(null)
    api
      .getClinicConfig(tenantId, fo)
      .then((snap) => {
        if (cancelled) return
        const active = snap.services.filter((s) => s.active)
        setServices(active)
        setTimezone(snap.settings.timezone)
        setServiceId((prev) => prev || active[0]?.id || '')
        setDate((prev) => prev || upcomingCivilDates(snap.settings.timezone, Date.now(), 1)[0]!)
      })
      .catch((err) => {
        if (!cancelled) setError(friendlyError(err, 'Não conseguimos carregar os horários.'))
      })
    return () => {
      cancelled = true
    }
  }, [open, services, api, tenantId, fo])

  useEffect(() => {
    if (!open || !serviceId || !date) return
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .queryAvailability(tenantId, { serviceId, date, professionalId }, fo)
      .then((res) => {
        if (!cancelled) setSlots(res.slots)
      })
      .catch((err) => {
        if (!cancelled) {
          setSlots(null)
          setError(friendlyError(err, 'Não conseguimos carregar os horários.'))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, tenantId, serviceId, date, professionalId, api, fo])

  const days = useMemo(() => upcomingCivilDates(timezone, Date.now(), DAYS), [timezone])
  const professionals = useMemo(() => {
    const seen = new Map<string, string>()
    for (const s of slots ?? []) seen.set(s.professionalId, s.professionalName)
    return [...seen.entries()]
  }, [slots])

  const isPicked = (slot: AvailabilitySlot) =>
    picks.some((p) => p.date === date && p.slot.startsAt === slot.startsAt)

  function toggle(slot: AvailabilitySlot) {
    setPicks((prev) => {
      if (prev.some((p) => p.date === date && p.slot.startsAt === slot.startsAt)) {
        return prev.filter((p) => !(p.date === date && p.slot.startsAt === slot.startsAt))
      }
      if (prev.length >= MAX_PICKS) return prev
      return [...prev, { date, slot }]
    })
  }

  function propose() {
    const ordered = [...picks].sort((a, b) => a.slot.startsAt - b.slot.startsAt)
    onPropose(buildProposalText(ordered, timezone))
    setPicks([])
    setOpen(false)
  }

  if (!open) {
    return (
      <div className="free-slots free-slots--closed">
        <Button className="free-slots-toggle" onPress={() => setOpen(true)}>
          <CalendarClock aria-hidden size={16} strokeWidth={2} />
          Horários livres
        </Button>
      </div>
    )
  }

  return (
    <section className="free-slots" aria-label="Horários livres">
      <div className="free-slots-head">
        <label className="free-slots-service">
          <span className="panel-sr-only">Procedimento</span>
          <select
            className="free-slots-select"
            value={serviceId}
            onChange={(e) => {
              setServiceId(e.target.value)
              setPicks([])
              setProfessionalId('any')
            }}
          >
            {(services ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <Button className="free-slots-toggle" onPress={() => setOpen(false)}>
          Fechar
        </Button>
      </div>

      <div className="free-slots-days" role="group" aria-label="Dia">
        {days.map((d) => {
          const l = formatDayLabel(d, timezone)
          return (
            <Button
              key={d}
              className="free-slots-day"
              aria-pressed={d === date}
              onPress={() => setDate(d)}
            >
              <small>{l.weekday}</small>
              <b>{l.day}</b>
            </Button>
          )
        })}
      </div>

      {professionals.length > 1 ? (
        <div className="free-slots-pros" role="group" aria-label="Profissional">
          <Button
            className="panel-chip"
            aria-pressed={professionalId === 'any'}
            onPress={() => setProfessionalId('any')}
          >
            Qualquer
          </Button>
          {professionals.map(([id, name]) => (
            <Button
              key={id}
              className="panel-chip"
              aria-pressed={professionalId === id}
              onPress={() => setProfessionalId(id)}
            >
              {name}
            </Button>
          ))}
        </div>
      ) : null}

      {error ? (
        <p className="free-slots-note" role="alert">
          {error}
        </p>
      ) : loading && !slots ? (
        <p className="free-slots-note" role="status">
          Buscando horários…
        </p>
      ) : slots && slots.length === 0 ? (
        <p className="free-slots-note" role="status">
          Nada livre neste dia. Tente outro dia.
        </p>
      ) : (
        <ul className="free-slots-list">
          {(slots ?? []).map((s) => {
            const blocked = (s.tempoWarnings?.length ?? 0) > 0
            const time = formatSlotTime(s.startsAt, timezone)
            return (
              <li key={`${s.startsAt}-${s.professionalId}`}>
                <Button
                  className="free-slots-slot"
                  aria-pressed={isPicked(s)}
                  isDisabled={blocked || (!isPicked(s) && picks.length >= MAX_PICKS)}
                  onPress={() => toggle(s)}
                >
                  {time}
                  <small>{blocked ? 'Use Agendar' : s.professionalName}</small>
                </Button>
              </li>
            )
          })}
        </ul>
      )}

      <div className="free-slots-foot">
        <span className="free-slots-hint">Nada é enviado até você apertar Enviar. Até {MAX_PICKS} horários.</span>
        <Button className="panel-btn-primary" isDisabled={picks.length === 0} onPress={propose}>
          Colocar no campo{picks.length > 0 ? ` · ${picks.length}` : ''}
        </Button>
      </div>
    </section>
  )
}
