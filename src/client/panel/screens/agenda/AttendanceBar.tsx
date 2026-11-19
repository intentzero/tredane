import { Check, X } from 'lucide-react'
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
