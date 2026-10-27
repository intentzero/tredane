/**
 * Layout da grade de horas do dia (puro, sem React): posição vertical por
 * horário e colunas lado a lado quando compromissos se sobrepõem.
 */

export const HOUR_HEIGHT = 64
/** Compromisso curto ainda precisa caber nome e hora, e ter área de toque. */
export const MIN_BLOCK_HEIGHT = 44
export const DEFAULT_START_HOUR = 8
export const DEFAULT_END_HOUR = 19

export type GridItem = { id: string; startsAt: number; endsAt: number }

export type PlacedItem<T extends GridItem> = {
  item: T
  top: number
  height: number
  lane: number
  lanes: number
}

/** Minutos desde 00:00 no fuso informado. */
export function minutesOfDay(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms))
  const get = (t: 'hour' | 'minute') => Number(parts.find((p) => p.type === t)?.value ?? 0)
  return get('hour') * 60 + get('minute')
}

/** Faixa de horas visível: o expediente padrão, ampliada se houver compromisso fora dele. */
export function visibleHours(
  items: GridItem[],
  timeZone: string,
): { startHour: number; endHour: number } {
  let start = DEFAULT_START_HOUR
  let end = DEFAULT_END_HOUR
  for (const it of items) {
    start = Math.min(start, Math.floor(minutesOfDay(it.startsAt, timeZone) / 60))
    const endMin = minutesOfDay(it.endsAt, timeZone)
    // Termina depois da meia-noite no mesmo dia civil: limita a 24h.
    const endsSameDay = endMin >= minutesOfDay(it.startsAt, timeZone)
    end = Math.max(end, endsSameDay ? Math.ceil(endMin / 60) : 24)
  }
  return { startHour: Math.max(0, start), endHour: Math.min(24, Math.max(end, start + 1)) }
}

export function layoutDay<T extends GridItem>(
  items: T[],
  timeZone: string,
  startHour: number,
): PlacedItem<T>[] {
  const sorted = [...items].sort((a, b) => a.startsAt - b.startsAt || a.endsAt - b.endsAt)
  type Tmp = { item: T; startMin: number; endMin: number; top: number; height: number; lane: number }
  const tmp: Tmp[] = sorted.map((item) => {
    const startMin = minutesOfDay(item.startsAt, timeZone)
    let endMin = minutesOfDay(item.endsAt, timeZone)
    if (endMin <= startMin) endMin = 24 * 60
    const top = ((startMin - startHour * 60) / 60) * HOUR_HEIGHT
    const height = Math.max(((endMin - startMin) / 60) * HOUR_HEIGHT, MIN_BLOCK_HEIGHT)
    return { item, startMin, endMin, top, height, lane: 0 }
  })

  // Agrupa em «clusters» de compromissos que se encostam e distribui em colunas.
  const out: PlacedItem<T>[] = []
  let cluster: Tmp[] = []
  let clusterBottom = -Infinity
  const flush = () => {
    if (cluster.length === 0) return
    const laneBottoms: number[] = []
    for (const c of cluster) {
      let lane = laneBottoms.findIndex((bottom) => bottom <= c.top)
      if (lane === -1) lane = laneBottoms.length
      laneBottoms[lane] = c.top + c.height
      c.lane = lane
    }
    for (const c of cluster) {
      out.push({ item: c.item, top: c.top, height: c.height, lane: c.lane, lanes: laneBottoms.length })
    }
    cluster = []
    clusterBottom = -Infinity
  }
  for (const c of tmp) {
    if (cluster.length > 0 && c.top >= clusterBottom) flush()
    cluster.push(c)
    clusterBottom = Math.max(clusterBottom, c.top + c.height)
  }
  flush()
  return out
}

/** Posição da linha de «agora» (px) se o instante cair dentro da grade; senão null. */
export function nowOffset(
  now: number,
  timeZone: string,
  startHour: number,
  endHour: number,
): number | null {
  const min = minutesOfDay(now, timeZone)
  if (min < startHour * 60 || min > endHour * 60) return null
  return ((min - startHour * 60) / 60) * HOUR_HEIGHT
}

/**
 * Faixa tracejada do bloco reservado (hora a definir): exatamente da hora de
 * início à de fim, sem altura mínima — assim o rótulo «12:00» da grade e o fim
 * da faixa caem na mesma linha.
 */
export function layoutHoldBands<T extends { windowStartsAt: number; windowEndsAt: number }>(
  holds: T[],
  timeZone: string,
  startHour: number,
): { hold: T; top: number; height: number }[] {
  return holds.map((hold) => {
    const startMin = minutesOfDay(hold.windowStartsAt, timeZone)
    let endMin = minutesOfDay(hold.windowEndsAt, timeZone)
    if (endMin <= startMin) endMin = 24 * 60
    return {
      hold,
      top: ((startMin - startHour * 60) / 60) * HOUR_HEIGHT,
      height: ((endMin - startMin) / 60) * HOUR_HEIGHT,
    }
  })
}
