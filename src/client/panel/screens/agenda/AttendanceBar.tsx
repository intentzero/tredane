import { Check, ChevronDown, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { AgendaAppointmentItem } from '../../api'

export type AttendanceValue = 'arrived' | 'no_show'

/**
 * Presença por marcar: confirmado, já começou e ainda sem «Chegou / Não veio».
 * Só estes cartões ganham botões — os outros ficam limpos (Proposto, 19/11/2026).
 */
export function attendancePending(item: AgendaAppointmentItem, now: number): boolean {
  return item.status === 'confirmed' && item.attendance == null && item.startsAt <= now
}

/** Presença já marcada: mostra o estado e deixa desfazer. */
export function attendanceMarked(item: AgendaAppointmentItem): boolean {
  return item.status === 'confirmed' && item.attendance != null
}

type Props = {
  item: AgendaAppointmentItem
  now: number
  onSet: (id: string, attendance: AttendanceValue | null) => void
  /** `card` é o toque do celular (44 px); `grid` cabe no bloco do desktop. */
  variant?: 'card' | 'grid'
}

export function AttendanceBar({ item, now, onSet, variant = 'card' }: Props) {
  if (variant === 'grid') return <GridAttendance item={item} now={now} onSet={onSet} />
  if (attendancePending(item, now)) {
    return (
      <div className={`agenda-attendance-bar agenda-attendance-bar--${variant}`}>
        <button
          type="button"
          className="agenda-attendance-btn agenda-attendance-btn--yes"
          onClick={(e) => {
            e.stopPropagation()
            onSet(item.id, 'arrived')
          }}
        >
          <Check aria-hidden size={16} strokeWidth={2.4} />
          Chegou
        </button>
        <button
          type="button"
          className="agenda-attendance-btn agenda-attendance-btn--no"
          onClick={(e) => {
            e.stopPropagation()
            onSet(item.id, 'no_show')
          }}
        >
          <X aria-hidden size={16} strokeWidth={2.4} />
          Não veio
        </button>
      </div>
    )
  }
  if (attendanceMarked(item)) {
    return (
      <div className={`agenda-attendance-bar agenda-attendance-bar--${variant} agenda-attendance-bar--done`}>
        <span className={`agenda-attendance-state agenda-attendance-state--${item.attendance}`}>
          {item.attendance === 'arrived' ? 'Chegou' : 'Não veio'}
        </span>
        <button
          type="button"
          className="agenda-attendance-undo"
          onClick={(e) => {
            e.stopPropagation()
            onSet(item.id, null)
          }}
        >
          Desfazer
        </button>
      </div>
    )
  }
  return null
}

/**
 * Grade do desktop (Proposto, 25/11/2026): a presença vive **dentro** do bloco, à direita do nome,
 * e nunca aumenta a altura — a altura do bloco é a duração. Por marcar: «Presença:» + Chegou
 * (cheio) + Não veio (contorno). Marcada: um selo que abre «Desfazer» num menu que flutua
 * por cima da grade (não empurra nada).
 */
function GridAttendance({ item, now, onSet }: Pick<Props, 'item' | 'now' | 'onSet'>) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (attendancePending(item, now)) {
    return (
      <div className="agenda-attendance-bar agenda-attendance-bar--grid">
        <span className="agenda-attendance-label">Presença:</span>
        <button
          type="button"
          className="agenda-attendance-pill agenda-attendance-pill--yes"
          aria-label="Chegou"
          title="Chegou"
          onClick={(e) => {
            e.stopPropagation()
            onSet(item.id, 'arrived')
          }}
        >
          <Check aria-hidden size={14} strokeWidth={2.4} />
          <span className="agenda-attendance-pill-text">Chegou</span>
        </button>
        <button
          type="button"
          className="agenda-attendance-pill agenda-attendance-pill--no"
          aria-label="Não veio"
          title="Não veio"
          onClick={(e) => {
            e.stopPropagation()
            onSet(item.id, 'no_show')
          }}
        >
          <X aria-hidden size={14} strokeWidth={2.4} />
          <span className="agenda-attendance-pill-text">Não veio</span>
        </button>
      </div>
    )
  }
  if (attendanceMarked(item)) {
    const arrived = item.attendance === 'arrived'
    return (
      <div ref={rootRef} className="agenda-attendance-bar agenda-attendance-bar--grid agenda-attendance-bar--done">
        <button
          type="button"
          className={`agenda-attendance-chip agenda-attendance-chip--${item.attendance}`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={(e) => {
            e.stopPropagation()
            setOpen((v) => !v)
          }}
        >
          {arrived ? <Check aria-hidden size={14} strokeWidth={2.4} /> : <X aria-hidden size={14} strokeWidth={2.4} />}
          {arrived ? 'Chegou' : 'Não veio'}
          <ChevronDown aria-hidden size={14} strokeWidth={2.2} />
        </button>
        {open ? (
          <div role="menu" className="agenda-attendance-menu">
            <button
              type="button"
              role="menuitem"
              className="agenda-attendance-menu-item"
              onClick={(e) => {
                e.stopPropagation()
                setOpen(false)
                onSet(item.id, null)
              }}
            >
              Desfazer
            </button>
          </div>
        ) : null}
      </div>
    )
  }
  return null
}
