import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from 'react-aria-components'
import { validateDay, type DayWindows } from './clinicHours'
import { dayLabel, formatMinutes, parseTimeToMinutes } from './format'

type Props = {
  day: number
  value: DayWindows
  /** Quem mais segue o horário da clínica, para o aviso (nomes). */
  followers: string[]
  onCancel: () => void
  /** Faixas do dia e os outros dias que recebem as mesmas faixas. */
  onApply: (windows: DayWindows, alsoDays: number[]) => void
}

const DEFAULT_WINDOW = { startMinute: 8 * 60, endMinute: 18 * 60 }
const SHORT = ['', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']

function gapLabel(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

/**
 * Editor de um dia (celular: folha de baixo): aberto ou fechado, faixas com o intervalo entre
 * elas e «Usar este horário também em». Só muda o rascunho; quem salva é «Salvar horário».
 */
export function DayEditor({ day, value, followers, onCancel, onApply }: Props) {
  const [list, setList] = useState<DayWindows>(value)
  const [also, setAlso] = useState<number[]>([])
  const open = list.length > 0
  const problem = validateDay(list)

  const setTime = (i: number, key: 'startMinute' | 'endMinute', raw: string) => {
    const m = parseTimeToMinutes(raw)
    if (m == null) return
    setList(list.map((w, idx) => (idx === i ? { ...w, [key]: m } : w)))
  }
  const total = also.length + 1

  return (
    <div className="day-editor">
      <div className="day-editor-open">
        <span className="day-editor-open-text">
          <strong>Aberta neste dia</strong>
          <span>Desligado, ninguém agenda na {dayLabel(day).toLowerCase()}.</span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={open}
          aria-label={`${dayLabel(day)}: ${open ? 'aberto' : 'fechado'}`}
          className="week-switch"
          onClick={() => setList(open ? [] : [{ ...DEFAULT_WINDOW }])}
        >
          <span className="week-switch-knob" />
        </button>
      </div>

      {open ? (
        <div className="day-editor-windows">
          <h3 className="panel-legend">Faixas de atendimento</h3>
          {list.map((w, i) => {
            const prev = list[i - 1]
            return (
              <div key={i}>
                {prev && w.startMinute > prev.endMinute ? (
                  <p className="day-editor-gap">Intervalo de {gapLabel(w.startMinute - prev.endMinute)}</p>
                ) : null}
                <div className="week-editor-window">
                  <label>
                    <span className="week-editor-lbl">Começa</span>
                    <input
                      type="time"
                      step={900}
                      value={formatMinutes(w.startMinute)}
                      onChange={(e) => setTime(i, 'startMinute', e.target.value)}
                      aria-label={`Faixa ${i + 1}, começa`}
                    />
                  </label>
                  <label>
                    <span className="week-editor-lbl">Termina</span>
                    <input
                      type="time"
                      step={900}
                      value={formatMinutes(w.endMinute)}
                      onChange={(e) => setTime(i, 'endMinute', e.target.value)}
                      aria-label={`Faixa ${i + 1}, termina`}
                    />
                  </label>
                  {list.length > 1 ? (
                    <button
                      type="button"
                      className="week-editor-x"
                      aria-label={`Remover faixa ${i + 1}`}
                      onClick={() => setList(list.filter((_, idx) => idx !== i))}
                    >
                      <Trash2 aria-hidden size={18} strokeWidth={2} />
                    </button>
                  ) : null}
                </div>
              </div>
            )
          })}
          <Button
            className="week-editor-add"
            onPress={() => {
              const last = list[list.length - 1]!
              const start = Math.min(last.endMinute + 60, 23 * 60)
              setList([...list, { startMinute: start, endMinute: Math.min(start + 120, 24 * 60) }])
            }}
          >
            <Plus aria-hidden size={16} strokeWidth={2.2} /> Adicionar faixa
          </Button>
          {problem ? (
            <p className="clinic-form-error" role="alert">
              {problem}
            </p>
          ) : null}
        </div>
      ) : null}

      <fieldset className="clinic-fieldset day-editor-copy">
        <legend>Usar este horário também em</legend>
        <div className="day-editor-days">
          {[1, 2, 3, 4, 5, 6, 7].map((d) => (
            <button
              key={d}
              type="button"
              className="block-form-chip day-editor-day"
              aria-label={dayLabel(d)}
              aria-pressed={d === day || also.includes(d)}
              disabled={d === day}
              onClick={() => setAlso(also.includes(d) ? also.filter((x) => x !== d) : [...also, d])}
            >
              {SHORT[d]}
            </button>
          ))}
        </div>
        {followers.length > 0 ? (
          <p className="clinic-footnote">
            Vale também para {followers.join(' e ')}, que seguem o horário da clínica.
          </p>
        ) : null}
      </fieldset>

      <div className="clinic-footer-actions">
        <Button className="panel-btn panel-btn-ghost" onPress={onCancel}>
          Cancelar
        </Button>
        <Button
          className="panel-btn panel-btn-primary"
          isDisabled={problem !== null}
          onPress={() => onApply(list, also)}
        >
          {total === 1 ? 'Aplicar a este dia' : `Aplicar a ${total} dias`}
        </Button>
      </div>
    </div>
  )
}
