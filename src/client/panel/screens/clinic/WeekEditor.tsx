import { Button } from 'react-aria-components'
import { dayLabel, formatMinutes, parseTimeToMinutes } from './format'
import type { WeekDraft } from './clinicHours'

type Props = {
  value: WeekDraft
  onChange: (next: WeekDraft) => void
  /** Rótulo acessível do grupo, ex.: «Horário da clínica». */
  label: string
}

const DEFAULT_WINDOW = { startMinute: 8 * 60, endMinute: 18 * 60 }

/**
 * Expediente semanal: um interruptor por dia e, aberto, as faixas com hora de
 * início e fim (múltiplos de 15 min). Edita um rascunho; quem usa salva.
 */
export function WeekEditor({ value, onChange, label }: Props) {
  const setDay = (day: number, list: WeekDraft[number]) => onChange({ ...value, [day]: list })

  function setTime(day: number, i: number, key: 'startMinute' | 'endMinute', raw: string) {
    const m = parseTimeToMinutes(raw)
    if (m == null) return
    const list = (value[day] ?? []).map((w, idx) => (idx === i ? { ...w, [key]: m } : w))
    setDay(day, list)
  }

  function copyMondayToWeekdays() {
    const monday = value[1] ?? []
    onChange({ ...value, 2: [...monday], 3: [...monday], 4: [...monday], 5: [...monday] })
  }

  return (
    <div className="week-editor" role="group" aria-label={label}>
      <ul className="week-editor-list">
        {[1, 2, 3, 4, 5, 6, 7].map((day) => {
          const list = value[day] ?? []
          const open = list.length > 0
          return (
            <li key={day} className="week-editor-day">
              <div className="week-editor-head">
                <span className="week-editor-name">{dayLabel(day)}</span>
                <span className="week-editor-summary">
                  {open
                    ? list.map((w) => `${formatMinutes(w.startMinute)} – ${formatMinutes(w.endMinute)}`).join(' · ')
                    : 'Fechado'}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={open}
                  aria-label={`${dayLabel(day)}: ${open ? 'aberto' : 'fechado'}`}
                  className="week-switch"
                  onClick={() => setDay(day, open ? [] : [{ ...DEFAULT_WINDOW }])}
                >
                  <span className="week-switch-knob" />
                </button>
              </div>
              {open ? (
                <div className="week-editor-windows">
                  {list.map((w, i) => (
                    <div key={i} className="week-editor-window">
                      <label>
                        <span className="week-editor-lbl">De</span>
                        <input
                          type="time"
                          step={900}
                          value={formatMinutes(w.startMinute)}
                          onChange={(e) => setTime(day, i, 'startMinute', e.target.value)}
                          aria-label={`${dayLabel(day)}, faixa ${i + 1}, início`}
                        />
                      </label>
                      <label>
                        <span className="week-editor-lbl">Até</span>
                        <input
                          type="time"
                          step={900}
                          value={formatMinutes(w.endMinute)}
                          onChange={(e) => setTime(day, i, 'endMinute', e.target.value)}
                          aria-label={`${dayLabel(day)}, faixa ${i + 1}, fim`}
                        />
                      </label>
                      {list.length > 1 ? (
                        <button
                          type="button"
                          className="week-editor-x"
                          aria-label={`Remover faixa ${i + 1} de ${dayLabel(day)}`}
                          onClick={() => setDay(day, list.filter((_, idx) => idx !== i))}
                        >
                          ×
                        </button>
                      ) : null}
                    </div>
                  ))}
                  <Button
                    className="week-editor-add"
                    onPress={() => {
                      const last = list[list.length - 1]!
                      const start = Math.min(last.endMinute + 60, 23 * 60)
                      setDay(day, [...list, { startMinute: start, endMinute: Math.min(start + 120, 24 * 60) }])
                    }}
                  >
                    + Outra faixa (ex.: depois do almoço)
                  </Button>
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
      <Button className="week-editor-copy" onPress={copyMondayToWeekdays}>
        Copiar a segunda para terça a sexta
      </Button>
    </div>
  )
}
