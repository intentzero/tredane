/** Data e hora de uma marcação no fuso da clínica, p. ex. «qua 25/11 · 14:15». */
export function formatAppointmentWhen(startsAt: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(startsAt))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  const weekday = get('weekday').replace('.', '')
  return `${weekday} ${get('day')}/${get('month')} · ${get('hour')}:${get('minute')}`
}

export function formatDurationMinutes(startsAt: number, endsAt: number): string {
  const minutes = Math.max(0, Math.round((endsAt - startsAt) / 60000))
  return `${minutes} min`
}

/** Iniciais para o selo da clínica (máx. 2). */
export function clinicInitials(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase()
  return letters.slice(0, 2) || '•'
}
