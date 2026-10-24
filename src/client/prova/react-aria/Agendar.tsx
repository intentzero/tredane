import { getLocalTimeZone, parseDate } from '@internationalized/date'
import { Check, ChevronDown, TriangleAlert, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  Button,
  Calendar,
  CalendarCell,
  CalendarGrid,
  CalendarGridBody,
  CalendarGridHeader,
  CalendarHeaderCell,
  Checkbox,
  DateInput,
  DatePicker,
  DateSegment,
  Dialog,
  Group,
  Heading,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  Select,
  SelectValue,
  TextArea,
  TextField,
} from 'react-aria-components'
import {
  contactName,
  days,
  defaultMessage,
  professionals,
  services,
  slots,
  type DayId,
  type ProfessionalId,
  type ServiceId,
  type SlotId,
} from '../data'

/**
 * M-04 Agendar — React Aria Components (biblioteca-base Confirmada, DEC-048).
 * Inclui DatePicker/Calendar nativo (i18n) além da faixa de dias do mock.
 * Área de prova / referência; dados fictícios.
 */
export function ReactAriaAgendar() {
  const [serviceId, setServiceId] = useState<ServiceId>('svc-laser')
  const [professionalId, setProfessionalId] = useState<ProfessionalId>('any')
  const [dayId, setDayId] = useState<DayId>('2026-10-30')
  const [slotId, setSlotId] = useState<SlotId>('16:00')
  const [sendWhatsApp, setSendWhatsApp] = useState(true)
  const [message, setMessage] = useState(defaultMessage)
  const [calendarDate, setCalendarDate] = useState(parseDate('2026-10-30'))

  const service = services.find((item) => item.id === serviceId) ?? services[0]
  const selectedDay = days.find((item) => item.id === dayId) ?? days[1]
  const selectedSlot = slots.find((item) => item.id === slotId) ?? slots[1]

  const confirmLabel = useMemo(
    () => `Confirmar ${selectedDay.weekday} ${selectedDay.day}/10 · ${selectedSlot.time}`,
    [selectedDay, selectedSlot],
  )

  return (
    <div className="panel-phone" data-prova="react-aria-m04" lang="pt-BR">
      <header className="panel-header">
        <a className="panel-icon-btn" href="/prova" aria-label="Fechar sem agendar">
          <X aria-hidden="true" size={22} strokeWidth={2} />
        </a>
        <div>
          <h1 className="panel-title">Agendar horário</h1>
          <span className="panel-subtitle">{contactName}</span>
        </div>
      </header>

      <div className="panel-scroll">
        <div className="panel-banner" role="alert">
          <TriangleAlert aria-hidden="true" size={20} strokeWidth={2} />
          <span>
            <strong>15:00 acabou de ser ocupado</strong> (Dra. Paula Reis · Sala 2). Nada foi
            reservado. Escolha outro horário.
          </span>
        </div>

        <Select
          className="panel-field"
          selectedKey={serviceId}
          onSelectionChange={(key) => {
            if (typeof key === 'string') setServiceId(key as ServiceId)
          }}
        >
          <Label>Serviço</Label>
          <Button className="panel-select-trigger">
            <SelectValue />
            <ChevronDown aria-hidden="true" size={18} strokeWidth={2} />
          </Button>
          <Popover className="panel-popover">
            <ListBox className="panel-listbox">
              {services.map((item) => (
                <ListBoxItem
                  key={item.id}
                  id={item.id}
                  className="panel-select-item"
                  textValue={item.label}
                >
                  {item.label}
                </ListBoxItem>
              ))}
            </ListBox>
          </Popover>
        </Select>
        <span className="panel-field-hint">{service.hint}</span>

        <Select
          className="panel-field"
          selectedKey={professionalId}
          onSelectionChange={(key) => {
            if (typeof key === 'string') setProfessionalId(key as ProfessionalId)
          }}
        >
          <Label>Profissional</Label>
          <Button className="panel-select-trigger">
            <SelectValue />
            <ChevronDown aria-hidden="true" size={18} strokeWidth={2} />
          </Button>
          <Popover className="panel-popover">
            <ListBox className="panel-listbox">
              {professionals.map((item) => (
                <ListBoxItem
                  key={item.id}
                  id={item.id}
                  className="panel-select-item"
                  textValue={item.label}
                >
                  {item.label}
                </ListBoxItem>
              ))}
            </ListBox>
          </Popover>
        </Select>

        <fieldset className="panel-fieldset">
          <legend className="panel-legend">Dia</legend>
          <div className="panel-day-row" role="group" aria-label="Dia">
            {days.map((day) => (
              <button
                key={day.id}
                type="button"
                className="panel-day"
                aria-pressed={dayId === day.id}
                onClick={() => {
                  setDayId(day.id)
                  setCalendarDate(parseDate(day.id))
                }}
              >
                <span>{day.weekday}</span>
                <span>{day.day}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <DatePicker
          className="panel-field"
          value={calendarDate}
          onChange={(value) => {
            if (!value) return
            setCalendarDate(value)
            const iso = value.toString()
            const match = days.find((day) => day.id === iso)
            if (match) setDayId(match.id)
          }}
        >
          <Label>Calendário (pt-BR · sem código próprio)</Label>
          <Group style={{ display: 'flex', gap: 8 }}>
            <DateInput className="panel-control" style={{ flex: 1 }}>
              {(segment) => <DateSegment segment={segment} />}
            </DateInput>
            <Button className="panel-icon-btn" aria-label="Abrir calendário">
              <ChevronDown aria-hidden="true" size={18} strokeWidth={2} />
            </Button>
          </Group>
          <Popover className="panel-popover">
            <Dialog>
              <Calendar>
                <header
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    marginBottom: 8,
                  }}
                >
                  <Button slot="previous" className="panel-icon-btn" aria-label="Mês anterior">
                    ‹
                  </Button>
                  <Heading style={{ fontSize: 16, fontWeight: 600, margin: 0 }} />
                  <Button slot="next" className="panel-icon-btn" aria-label="Próximo mês">
                    ›
                  </Button>
                </header>
                <CalendarGrid>
                  <CalendarGridHeader>
                    {(day) => <CalendarHeaderCell>{day}</CalendarHeaderCell>}
                  </CalendarGridHeader>
                  <CalendarGridBody>
                    {(date) => (
                      <CalendarCell
                        date={date}
                        className="panel-day"
                        style={{ width: 40, height: 40, margin: 2 }}
                      />
                    )}
                  </CalendarGridBody>
                </CalendarGrid>
              </Calendar>
            </Dialog>
          </Popover>
        </DatePicker>
        <span className="panel-meta">
          Data selecionada:{' '}
          {calendarDate.toDate(getLocalTimeZone()).toLocaleDateString('pt-BR', {
            weekday: 'long',
            day: '2-digit',
            month: 'long',
            year: 'numeric',
          })}
        </span>

        <fieldset className="panel-fieldset">
          <legend className="panel-legend">Horários livres para profissional e sala</legend>
          {slots.map((slot) => (
            <button
              key={slot.id}
              type="button"
              className="panel-slot"
              aria-pressed={slotId === slot.id}
              onClick={() => setSlotId(slot.id)}
            >
              <span>{slot.time}</span>
              <span>{slot.resource}</span>
            </button>
          ))}
        </fieldset>

        <div className="panel-card">
          <Checkbox
            className="panel-check-row"
            isSelected={sendWhatsApp}
            onChange={setSendWhatsApp}
          >
            <div className="panel-checkbox" data-selected={sendWhatsApp || undefined}>
              {sendWhatsApp ? <Check aria-hidden="true" size={14} strokeWidth={3} /> : null}
            </div>
            <span>Enviar confirmação pelo WhatsApp</span>
          </Checkbox>
          <TextField
            className="panel-field"
            value={message}
            onChange={setMessage}
            isDisabled={!sendWhatsApp}
          >
            <Label>Mensagem (editável)</Label>
            <TextArea className="panel-textarea" rows={3} />
          </TextField>
          <span className="panel-meta">Se o envio falhar, o agendamento continua confirmado.</span>
        </div>
      </div>

      <div className="panel-footer">
        <Button className="panel-btn-primary">{confirmLabel}</Button>
      </div>
    </div>
  )
}
