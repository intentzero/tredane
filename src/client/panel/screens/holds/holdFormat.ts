/**
 * Reserva por bloco — formatação pura (sem React): períodos, conversão de
 * data civil + minuto no fuso da clínica para epoch, e os textos de WhatsApp.
 */

export type PeriodPreset = 'manha' | 'tarde' | 'outro'

export const PERIOD_PRESETS: Record<Exclude<PeriodPreset, 'outro'>, { start: number; end: number }> = {
  manha: { start: 8 * 60, end: 12 * 60 },
  tarde: { start: 13 * 60, end: 18 * 60 },
}

export const DURATION_PRESETS = [15, 30, 45, 60, 90, 120] as const

function tzOffsetMs(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(ms))
  const get = (t: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'))
  return asUtc - Math.floor(ms / 1000) * 1000
}

/** «2026-11-03» + 480 min no fuso → epoch ms. */
export function civilMinuteToEpoch(isoDate: string, minuteOfDay: number, timeZone: string): number {
  const [y, m, d] = isoDate.split('-').map(Number)
  const guess = Date.UTC(y!, m! - 1, d!, 0, minuteOfDay)
  let out = guess - tzOffsetMs(guess, timeZone)
  const again = guess - tzOffsetMs(out, timeZone)
  if (again !== out) out = again
  return out
}

/** 480 → «8h», 750 → «12h30». */
export function hourLabel(minuteOfDay: number): string {
  const h = Math.floor(minuteOfDay / 60)
  const m = minuteOfDay % 60
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`
}

/** 60 → «1 h», 90 → «1h30», 45 → «45 min». */
export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h} h` : `${h}h${String(m).padStart(2, '0')}`
}

function minutesOf(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms))
  const get = (t: 'hour' | 'minute') => Number(parts.find((p) => p.type === t)?.value ?? 0)
  return get('hour') * 60 + get('minute')
}

/** Qual preset corresponde à janela (para rótulos). */
export function periodOf(windowStartsAt: number, windowEndsAt: number, timeZone: string): {
  preset: PeriodPreset
  start: number
  end: number
} {
  const start = minutesOf(windowStartsAt, timeZone)
  const end = minutesOf(windowEndsAt, timeZone) || 24 * 60
  for (const key of ['manha', 'tarde'] as const) {
    if (PERIOD_PRESETS[key].start === start && PERIOD_PRESETS[key].end === end) {
      return { preset: key, start, end }
    }
  }
  return { preset: 'outro', start, end }
}

/** «de manhã» / «à tarde» / «das 9h às 13h». */
export function periodPhrase(windowStartsAt: number, windowEndsAt: number, timeZone: string): string {
  const p = periodOf(windowStartsAt, windowEndsAt, timeZone)
  if (p.preset === 'manha') return 'de manhã'
  if (p.preset === 'tarde') return 'à tarde'
  return `das ${hourLabel(p.start)} às ${hourLabel(p.end)}`
}

/** Chip curto: «manhã» / «tarde» / «9h–13h». */
export function periodChip(windowStartsAt: number, windowEndsAt: number, timeZone: string): string {
  const p = periodOf(windowStartsAt, windowEndsAt, timeZone)
  if (p.preset === 'manha') return 'manhã'
  if (p.preset === 'tarde') return 'tarde'
  return `${hourLabel(p.start)}–${hourLabel(p.end)}`
}

/** «Ter 3/11». */
export function shortDay(ms: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'numeric',
  }).formatToParts(new Date(ms))
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? ''
  const wd = get('weekday').replace('.', '')
  return `${wd.charAt(0).toUpperCase()}${wd.slice(1)} ${Number(get('day'))}/${Number(get('month'))}`
}

/** «terça, 3/11» (minúsculo, para o meio da frase). */
export function sentenceDay(ms: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'numeric',
  }).formatToParts(new Date(ms))
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('weekday').replace(/-feira$/, '')}, ${Number(get('day'))}/${Number(get('month'))}`
}

export function firstName(name: string | null | undefined): string {
  const n = name?.trim().split(/\s+/)[0]
  return n || ''
}

function hello(name: string | null | undefined): string {
  const f = firstName(name)
  return f ? `Olá, ${f}!` : 'Olá!'
}

/** Mensagem da reserva (design 06): horário confirmado no fuso da clínica. */
export function holdConfirmedMessage(i: {
  contactName: string | null
  serviceName: string
  professionalName: string
  startsAt: number
  endsAt: number
  timeZone: string
  roomName?: string | null
}): string {
  const day = sentenceDay(i.startsAt, i.timeZone)
  const t = (ms: number) =>
    new Intl.DateTimeFormat('pt-BR', { timeZone: i.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
      new Date(ms),
    )
  return [
    `${hello(i.contactName)} Seu horário está confirmado ✅`,
    `${i.serviceName} — ${day}, às ${t(i.startsAt)} (até ${t(i.endsAt)})`,
    `Com ${i.professionalName}${i.roomName ? ` · ${i.roomName}` : ''}`,
    'Se precisar remarcar, é só responder esta mensagem.',
  ].join('\n')
}
