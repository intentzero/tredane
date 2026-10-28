type Props<T extends string> = {
  label: string
  value: T
  options: Array<{ id: T; label: string }>
  onChange: (next: T) => void
  /** `tab` para trocar de vista; `radio` para escolher um modo. */
  role?: 'tab' | 'radio'
}

/** Controle segmentado (pílula): troca de vista ou de modo, sem rolagem extra. */
export function Segmented<T extends string>({ label, value, options, onChange, role = 'tab' }: Props<T>) {
  return (
    <div
      className="week-mode"
      role={role === 'tab' ? 'tablist' : 'radiogroup'}
      aria-label={label}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role={role}
          {...(role === 'tab' ? { 'aria-selected': o.id === value } : { 'aria-checked': o.id === value })}
          className="week-mode-btn"
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
