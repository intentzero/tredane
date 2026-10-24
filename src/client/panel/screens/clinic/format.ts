const DAY_LABELS = [
  '',
  'Segunda',
  'Terça',
  'Quarta',
  'Quinta',
  'Sexta',
  'Sábado',
  'Domingo',
] as const

export function dayLabel(dayOfWeek: number): string {
  return DAY_LABELS[dayOfWeek] ?? `Dia ${dayOfWeek}`
}

export function formatMinutes(total: number): string {
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function parseTimeToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const h = Number(match[1])
  const m = Number(match[2])
  if (h < 0 || h > 24 || m < 0 || m > 59) return null
  if (h === 24 && m !== 0) return null
  return h * 60 + m
}

export function formatPriceCents(cents: number | null): string {
  if (cents === null || cents === undefined) return ''
  return (cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

export function parsePriceToCents(value: string): number | null {
  const cleaned = value.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')
  if (!cleaned.trim()) return null
  const n = Number(cleaned)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}

export function durationOptions(): number[] {
  return [15, 30, 45, 60, 75, 90, 105, 120]
}

export function bufferOptions(): number[] {
  return [0, 15, 30, 45, 60]
}

export const BLOCK_REASON_LABELS: Record<string, string> = {
  folga: 'Folga',
  ferias: 'Férias',
  feriado: 'Feriado',
  manutencao: 'Manutenção',
  outro: 'Outro',
}
