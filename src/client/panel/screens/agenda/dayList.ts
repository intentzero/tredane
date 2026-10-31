/**
 * Lista cronológica do dia (celular, M-06): compromissos soltos e, para sala
 * com mais de um lugar (DEC-059), um bloco por faixa com as pessoas dentro.
 * Puro, sem React.
 */
import type { AgendaAppointmentItem } from '../../api'
import { EMPTY_DAY_FREE_PREVIEW, type FreeSlot } from './freeSlots'

const STEP = 15 * 60_000

export type DayEntry =
  | { kind: 'apt'; key: string; startsAt: number; item: AgendaAppointmentItem }
  | {
      kind: 'room'
      key: string
      startsAt: number
      endsAt: number
      roomName: string
      capacity: number
      peak: number
      items: AgendaAppointmentItem[]
    }
  | { kind: 'now'; key: string; startsAt: number }
  | { kind: 'free'; key: string; startsAt: number; slot: FreeSlot }

function peakOf(items: AgendaAppointmentItem[], from: number, to: number): number {
  let peak = 0
  for (let t = from; t < to; t += STEP) {
    let n = 0
    for (const it of items) if (it.startsAt < t + STEP && it.occupiesUntil > t) n += 1
    if (n > peak) peak = n
  }
  return peak
}

/** Pessoas da faixa agrupadas por sala quando a capacidade é maior que 1. */
export function buildDayEntries(
  items: AgendaAppointmentItem[],
  roomCapacity: ReadonlyMap<string, number>,
  now: number | null,
  /** Livres do dia (Proposto, TEL-04): dia sem horários mostra só os primeiros. */
  free: FreeSlot[] = [],
): DayEntry[] {
  const entries: DayEntry[] = []
  const byRoom = new Map<string, AgendaAppointmentItem[]>()
  for (const it of items) {
    const cap = it.roomResourceId ? (roomCapacity.get(it.roomResourceId) ?? 1) : 1
    if (it.roomResourceId && cap > 1) {
      const list = byRoom.get(it.roomResourceId) ?? []
      list.push(it)
      byRoom.set(it.roomResourceId, list)
    } else {
      entries.push({ kind: 'apt', key: it.id, startsAt: it.startsAt, item: it })
    }
  }
  for (const [roomId, list] of byRoom) {
    const sorted = [...list].sort((a, b) => a.startsAt - b.startsAt || a.id.localeCompare(b.id))
    let cluster: AgendaAppointmentItem[] = []
    let clusterEnd = 0
    const flush = () => {
      if (cluster.length === 0) return
      const startsAt = cluster[0]!.startsAt
      entries.push({
        kind: 'room',
        key: `${roomId}:${startsAt}`,
        startsAt,
        endsAt: clusterEnd,
        roomName: cluster[0]!.roomResourceName ?? 'Sala',
        capacity: roomCapacity.get(roomId) ?? 1,
        peak: peakOf(cluster, startsAt, clusterEnd),
        items: cluster,
      })
      cluster = []
    }
    for (const it of sorted) {
      if (cluster.length > 0 && it.startsAt >= clusterEnd) flush()
      cluster.push(it)
      clusterEnd = Math.max(clusterEnd, it.occupiesUntil, it.endsAt)
    }
    flush()
  }
  const shownFree = entries.length === 0 ? free.slice(0, EMPTY_DAY_FREE_PREVIEW) : free
  for (const slot of shownFree) {
    entries.push({ kind: 'free', key: `free:${slot.key}`, startsAt: slot.startsAt, slot })
  }
  entries.sort((a, b) => a.startsAt - b.startsAt || a.key.localeCompare(b.key))
  if (now != null && entries.some((e) => e.kind !== 'free')) {
    const idx = entries.findIndex((e) => e.startsAt > now)
    const marker: DayEntry = { kind: 'now', key: 'now', startsAt: now }
    if (idx === -1) entries.push(marker)
    else entries.splice(idx, 0, marker)
  }
  return entries
}

const TITLES = new Set(['dr', 'dr.', 'dra', 'dra.', 'sr', 'sra'])

/** «Dra. Paula» → «PA»; uma palavra → duas primeiras letras. */
export function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((w) => w && !TITLES.has(w.toLowerCase()))
  if (words.length === 0) return '·'
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase()
  return (words[0]![0]! + words[1]![0]!).toUpperCase()
}

/** Primeiro nome sem título: «Dra. Paula» → «Paula». */
export function shortName(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((w) => w && !TITLES.has(w.toLowerCase()))
  return words[0] ?? name
}

/** Tom (0–3) estável por posição na lista de profissionais. */
export const PROFESSIONAL_TONES = 4
