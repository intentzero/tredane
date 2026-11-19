/**
 * DEC-206 — a profissional bloqueia um intervalo na própria ficha.
 */
import { useEffect, useState } from 'react'
import { Button, Input, Label, TextField } from 'react-aria-components'
import type { CreateBlockResponse, PanelApi } from '../../api'
import { friendlyError } from '../../copy/errors'
import { ClinicCheck } from '../clinic/ClinicCheck'
import { ClinicSheet } from '../clinic/ClinicSheet'
import { blockRange } from '../clinic/clinicHours'
import { parseTimeToMinutes } from '../clinic/format'
import { formatSlotTime } from './format'

type Props = {
  tenantId: string
  professionalId: string
  api: PanelApi
  generation: number
  date: string
  timezone: string
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

export function SelfBlockSheet({
  tenantId,
  professionalId,
  api,
  generation,
  date,
  timezone,
  isOpen,
  onOpenChange,
  onSaved,
}: Props) {
  const [allDay, setAllDay] = useState(false)
  const [start, setStart] = useState('09:00')
  const [end, setEnd] = useState('12:00')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [impact, setImpact] = useState<CreateBlockResponse['affectedAppointments'] | null>(null)

  const sm = parseTimeToMinutes(start) ?? 0
  const em = parseTimeToMinutes(end) ?? 0
  const range = blockRange(date, date, allDay, sm, em, timezone)
  const fo = { generation, expectGeneration: () => generation }

  useEffect(() => {
    if (!isOpen || !range) {
      setImpact(null)
      return
    }
    let cancelled = false
    void api
      .createBlock(
        tenantId,
        {
          resourceId: professionalId,
          startsAt: range.startsAt,
          endsAt: range.endsAt,
          reason: 'folga',
          dryRun: true,
        },
        fo,
      )
      .then((res) => {
        if (!cancelled) setImpact(res.affectedAppointments)
      })
      .catch(() => {
        if (!cancelled) setImpact(null)
      })
    return () => {
      cancelled = true
    }
  }, [api, tenantId, professionalId, range?.startsAt, range?.endsAt, isOpen])

  async function save() {
    if (!range) {
      setError('Informe o início e o fim, com o fim depois do início.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.createBlock(
        tenantId,
        {
          resourceId: professionalId,
          startsAt: range.startsAt,
          endsAt: range.endsAt,
          reason: 'folga',
        },
        fo,
      )
      onOpenChange(false)
      onSaved()
    } catch (err) {
      setError(friendlyError(err, 'Não foi possível bloquear o horário.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ClinicSheet
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (busy) return
        onOpenChange(open)
        if (!open) {
          setError(null)
          setImpact(null)
        }
      }}
      title="Bloquear o meu horário"
    >
      <p className="panel-subtitle">
        Fecha um intervalo só na sua coluna. Os compromissos já marcados ficam; horários novos
        deixam de aparecer.
      </p>
      <ClinicCheck isSelected={allDay} onChange={setAllDay}>
        Dia inteiro
      </ClinicCheck>
      {allDay ? null : (
        <div className="clinic-field-row">
          <TextField className="clinic-field">
            <Label>Início</Label>
            <Input value={start} onChange={(e) => setStart(e.target.value)} placeholder="09:00" />
          </TextField>
          <TextField className="clinic-field">
            <Label>Fim</Label>
            <Input value={end} onChange={(e) => setEnd(e.target.value)} placeholder="12:00" />
          </TextField>
        </div>
      )}
      {impact && impact.length > 0 ? (
        <p className="clinic-footnote" role="status">
          Há {impact.length} compromisso(s) neste intervalo
          {impact[0]
            ? ` (ex.: ${formatSlotTime(impact[0].startsAt, timezone)} ${impact[0].contactLabel ?? ''})`
            : ''}
          . Eles não serão cancelados.
        </p>
      ) : null}
      {error ? (
        <p className="clinic-form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="clinic-footer-actions">
        <Button className="panel-btn panel-btn-secondary" isDisabled={busy} onPress={() => onOpenChange(false)}>
          Cancelar
        </Button>
        <Button className="panel-btn panel-btn-primary" isDisabled={busy} onPress={() => void save()}>
          {busy ? 'A guardar…' : 'Bloquear'}
        </Button>
      </div>
    </ClinicSheet>
  )
}
