import * as Checkbox from '@radix-ui/react-checkbox'
import * as Select from '@radix-ui/react-select'
import { Check, ChevronDown, TriangleAlert, X } from 'lucide-react'
import { useMemo, useState } from 'react'
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
 * M-04 Agendar — candidata A (Radix UI Primitives).
 * Área de prova apenas; dados fictícios.
 */
export function RadixAgendar() {
  const [serviceId, setServiceId] = useState<ServiceId>('svc-laser')
  const [professionalId, setProfessionalId] = useState<ProfessionalId>('any')
  const [dayId, setDayId] = useState<DayId>('2026-10-30')
  const [slotId, setSlotId] = useState<SlotId>('16:00')
  const [sendWhatsApp, setSendWhatsApp] = useState(true)
  const [message, setMessage] = useState(defaultMessage)

  const service = services.find((item) => item.id === serviceId) ?? services[0]
  const selectedDay = days.find((item) => item.id === dayId) ?? days[1]
  const selectedSlot = slots.find((item) => item.id === slotId) ?? slots[1]

  const confirmLabel = useMemo(
    () => `Confirmar ${selectedDay.weekday} ${selectedDay.day}/10 · ${selectedSlot.time}`,
    [selectedDay, selectedSlot],
  )

  return (
    <div className="panel-phone" data-prova="radix-m04">
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

        <label className="panel-field">
          Serviço
          <Select.Root value={serviceId} onValueChange={(value) => setServiceId(value as ServiceId)}>
            <Select.Trigger className="panel-select-trigger" aria-label="Serviço">
              <Select.Value />
              <Select.Icon>
                <ChevronDown aria-hidden="true" size={18} strokeWidth={2} />
              </Select.Icon>
            </Select.Trigger>
            <Select.Portal>
              <Select.Content className="panel-select-content" position="popper" sideOffset={4}>
                <Select.Viewport>
                  {services.map((item) => (
                    <Select.Item key={item.id} className="panel-select-item" value={item.id}>
                      <Select.ItemText>{item.label}</Select.ItemText>
                    </Select.Item>
                  ))}
                </Select.Viewport>
              </Select.Content>
            </Select.Portal>
          </Select.Root>
        </label>
        <span className="panel-field-hint">{service.hint}</span>

        <label className="panel-field">
          Profissional
          <Select.Root
            value={professionalId}
            onValueChange={(value) => setProfessionalId(value as ProfessionalId)}
          >
            <Select.Trigger className="panel-select-trigger" aria-label="Profissional">
              <Select.Value />
              <Select.Icon>
                <ChevronDown aria-hidden="true" size={18} strokeWidth={2} />
              </Select.Icon>
            </Select.Trigger>
            <Select.Portal>
              <Select.Content className="panel-select-content" position="popper" sideOffset={4}>
                <Select.Viewport>
                  {professionals.map((item) => (
                    <Select.Item key={item.id} className="panel-select-item" value={item.id}>
                      <Select.ItemText>{item.label}</Select.ItemText>
                    </Select.Item>
                  ))}
                </Select.Viewport>
              </Select.Content>
            </Select.Portal>
          </Select.Root>
        </label>

        <fieldset className="panel-fieldset">
          <legend className="panel-legend">Dia</legend>
          <div className="panel-day-row" role="group" aria-label="Dia">
            {days.map((day) => (
              <button
                key={day.id}
                type="button"
                className="panel-day"
                aria-pressed={dayId === day.id}
                onClick={() => setDayId(day.id)}
              >
                <span>{day.weekday}</span>
                <span>{day.day}</span>
              </button>
            ))}
          </div>
        </fieldset>

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
          <label className="panel-check-row">
            <Checkbox.Root
              className="panel-checkbox"
              checked={sendWhatsApp}
              onCheckedChange={(checked) => setSendWhatsApp(checked === true)}
              id="radix-whatsapp"
            >
              <Checkbox.Indicator>
                <Check aria-hidden="true" size={14} strokeWidth={3} />
              </Checkbox.Indicator>
            </Checkbox.Root>
            <span>Enviar confirmação pelo WhatsApp</span>
          </label>
          <label className="panel-field" htmlFor="radix-message">
            Mensagem (editável)
            <textarea
              id="radix-message"
              className="panel-textarea"
              rows={3}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              disabled={!sendWhatsApp}
            />
          </label>
          <span className="panel-meta">Se o envio falhar, o agendamento continua confirmado.</span>
        </div>
      </div>

      <div className="panel-footer">
        <button type="button" className="panel-btn-primary">
          {confirmLabel}
        </button>
      </div>
    </div>
  )
}
