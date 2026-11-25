import { useEffect, useRef, useState } from 'react'
import type { PickQuery, PickResult, PickWhen, Slot } from './api'

const HOURS = Array.from({ length: 13 }, (_, i) => i + 7)
const MINUTES = ['00', '15', '30', '45']
const pad2 = (n: number) => String(n).padStart(2, '0')

/**
 * «Outra hora?» (DEC-227, revisão 24/11/2026): a cliente pergunta uma hora que não está na fila e o
 * servidor responde só sobre ela — a própria hora se livre, senão a mais próxima do dia. A agenda
 * completa nunca sai do servidor.
 */
export function AskTimeSheet({
  dayLabel,
  when,
  pick,
  onSessionLost,
  onClose,
  onChoose,
}: {
  dayLabel: string
  /** O dia aberto na fila. */
  when: PickWhen
  pick: (q: PickQuery) => Promise<PickResult>
  onSessionLost: () => void
  onClose: () => void
  onChoose: (s: Slot) => void
}) {
  const [hour, setHour] = useState(13)
  const [minute, setMinute] = useState('00')
  const [answer, setAnswer] = useState<{ slot: Slot; exact: boolean } | 'none' | 'loading' | 'error'>('loading')
  const pickRef = useRef(pick)
  pickRef.current = pick

  useEffect(() => {
    let cancelled = false
    setAnswer('loading')
    void pickRef.current({ when, askTime: `${pad2(hour)}:${minute}` }).then((res) => {
      if (cancelled) return
      if (res.kind === 'unauthorized') return onSessionLost()
      if (res.kind === 'error') return setAnswer('error')
      setAnswer(res.ask ?? 'none')
    })
    return () => {
      cancelled = true
    }
  }, [hour, minute, JSON.stringify(when), onSessionLost])

  const asked = `${pad2(hour)}:${minute}`
  return (
    <div className="cw-sheet-backdrop" role="presentation">
      <div className="cw-sheet" role="dialog" aria-modal="true" aria-labelledby="cw-ask-title">
        <div className="cw-sheet-grip" aria-hidden="true" />
        <div className="cw-sheet-head">
          <h2 id="cw-ask-title" className="cw-sheet-title">
            Que hora procura?
          </h2>
          <button type="button" className="cw-icon-btn" aria-label="Fechar" onClick={onClose}>
            ×
          </button>
        </div>
        <p className="cw-muted">{dayLabel}</p>
        <fieldset className="cw-wish">
          <legend className="cw-caption-title">Hora</legend>
          <div className="cw-wish-row">
            {HOURS.map((h) => (
              <button
                key={h}
                type="button"
                aria-pressed={h === hour}
                className={`cw-wish-small${h === hour ? ' is-on' : ''}`}
                onClick={() => setHour(h)}
              >
                {pad2(h)}h
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="cw-wish">
          <legend className="cw-caption-title">Minutos</legend>
          <div className="cw-wish-minutes">
            {MINUTES.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={m === minute}
                className={`cw-wish-small${m === minute ? ' is-on' : ''}`}
                onClick={() => setMinute(m)}
              >
                :{m}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="cw-ask-answer" role="status">
          {answer === 'loading' && <p>A procurar…</p>}
          {answer === 'error' && <p>Não foi possível verificar. Tente outra vez.</p>}
          {answer === 'none' && <p>Sem horários neste dia.</p>}
          {typeof answer === 'object' && (
            <>
              <p>{answer.exact ? `${answer.slot.time} está livre.` : `Às ${asked} não temos. O mais próximo é ${answer.slot.time}.`}</p>
              <button type="button" className="cw-btn cw-btn-primary" onClick={() => onChoose(answer.slot)}>
                Escolher {answer.slot.time}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
