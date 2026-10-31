/** Formatação local para Agenda / Agendar (#35). */

export function formatSlotTime(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(ms))
}

export function formatDayLabel(isoDate: string, timeZone: string): {
  weekday: string
  day: string
} {
  const [y, m, d] = isoDate.split('-').map(Number)
  // Meio-dia UTC evita virada ao formatar só a data civil.
  const probe = Date.UTC(y!, m! - 1, d!, 15, 0, 0)
  const weekday = new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    weekday: 'short',
  })
    .format(new Date(probe))
    .replace('.', '')
  const day = String(d).padStart(2, '0')
  return { weekday, day }
}

function civilProbe(isoDate: string): Date {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d!, 15, 0, 0))
}

/** «Terça, 27 de outubro» — data civil por extenso, sem o «-feira». */
export function formatLongDate(isoDate: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).formatToParts(civilProbe(isoDate))
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? ''
  const weekday = get('weekday').replace(/-feira$/, '')
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${get('day')} de ${get('month')}`
}

/** «26 de outubro – 1 de novembro» para o intervalo da semana. */
export function formatDateRange(
  startIso: string,
  endIso: string,
  timeZone: string,
): string {
  const fmt = new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    day: 'numeric',
    month: 'long',
  })
  return `${fmt.format(civilProbe(startIso))} – ${fmt.format(civilProbe(endIso))}`
}

/** Dia civil AAAA-MM-DD no fuso dado (ex.: compromisso → Agenda). */
export function civilDateInZone(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms))
}

/** Query/rota de dia civil AAAA-MM-DD. */
export function isCivilDateParam(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

/** Próximos N dias civis a partir de «hoje» no fuso da clínica. */
export function upcomingCivilDates(
  timeZone: string,
  fromMs: number,
  count: number,
): string[] {
  const today = civilDateInZone(fromMs, timeZone)
  const [y, m, d] = today.split('-').map(Number)
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const dt = new Date(Date.UTC(y!, m! - 1, d! + i))
    const yy = dt.getUTCFullYear()
    const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
    const dd = String(dt.getUTCDate()).padStart(2, '0')
    out.push(`${yy}-${mm}-${dd}`)
  }
  return out
}

export function reasonLabel(code: string): string {
  switch (code) {
    case 'appointment_conflict':
      return 'Horário ocupado por compromisso confirmado'
    case 'room_at_capacity':
      return 'Esse horário nesta sala já está cheio.'
    case 'professional_other_room':
      return 'A profissional já está noutra sala nesse horário.'
    case 'room_sex_mismatch':
      return 'Nesse horário a sala está só para um dos públicos.'
    case 'resource_block':
      return 'Bloqueio pontual no recurso'
    case 'outside_weekly_hours':
      return 'Fora do expediente'
    case 'scheduling_not_allowed':
      return 'Agenda da clínica ainda não configurada'
    case 'hold_conflict':
      return 'Ocuparia o bloco reservado de outra paciente'
    case 'past_slot':
      return 'Horário já passou'
    default:
      return code
  }
}
