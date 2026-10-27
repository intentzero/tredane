import { describe, expect, it } from 'vitest'
import { HOUR_HEIGHT, layoutDay, MIN_BLOCK_HEIGHT, minutesOfDay, nowOffset, visibleHours } from './dayGrid'

const TZ = 'America/Sao_Paulo'
// 27/10/2026 em Brasília (UTC-3): 09:30 = 12:30Z
const at = (h: number, m = 0) => Date.UTC(2026, 9, 27, h + 3, m)
const apt = (id: string, from: [number, number], to: [number, number]) => ({
  id,
  startsAt: at(...from),
  endsAt: at(...to),
})

describe('minutesOfDay', () => {
  it('usa o fuso da clínica', () => {
    expect(minutesOfDay(at(9, 30), TZ)).toBe(9 * 60 + 30)
    expect(minutesOfDay(Date.UTC(2026, 9, 28, 2, 30), TZ)).toBe(23 * 60 + 30)
  })
})

describe('visibleHours', () => {
  it('usa o expediente padrão quando tudo cabe', () => {
    expect(visibleHours([apt('a', [10, 0], [11, 0])], TZ)).toEqual({ startHour: 8, endHour: 19 })
  })

  it('amplia para compromisso antes ou depois do expediente', () => {
    expect(visibleHours([apt('a', [6, 30], [7, 30]), apt('b', [20, 0], [21, 30])], TZ)).toEqual({
      startHour: 6,
      endHour: 22,
    })
  })
})

describe('layoutDay', () => {
  it('posiciona pelo horário e altura pela duração', () => {
    const [p] = layoutDay([apt('a', [9, 30], [10, 30])], TZ, 8)
    expect(p!.top).toBe(1.5 * HOUR_HEIGHT)
    expect(p!.height).toBe(HOUR_HEIGHT)
    expect(p!.lanes).toBe(1)
  })

  it('compromisso curto mantém altura mínima tocável', () => {
    const [p] = layoutDay([apt('a', [9, 0], [9, 15])], TZ, 8)
    expect(p!.height).toBe(MIN_BLOCK_HEIGHT)
  })

  it('sobrepostos ficam lado a lado; os demais ocupam a largura toda', () => {
    const placed = layoutDay(
      [apt('a', [9, 0], [10, 0]), apt('b', [9, 30], [10, 30]), apt('c', [14, 0], [15, 0])],
      TZ,
      8,
    )
    const by = Object.fromEntries(placed.map((p) => [p.item.id, p]))
    expect([by.a!.lane, by.b!.lane]).toEqual([0, 1])
    expect(by.a!.lanes).toBe(2)
    expect(by.b!.lanes).toBe(2)
    expect(by.c!.lanes).toBe(1)
  })

  it('compromisso que começa quando outro termina não divide coluna', () => {
    const placed = layoutDay([apt('a', [9, 0], [10, 0]), apt('b', [10, 0], [11, 0])], TZ, 8)
    expect(placed.map((p) => p.lanes)).toEqual([1, 1])
  })
})

describe('nowOffset', () => {
  it('dentro da grade devolve a posição; fora devolve null', () => {
    expect(nowOffset(at(10, 0), TZ, 8, 19)).toBe(2 * HOUR_HEIGHT)
    expect(nowOffset(at(7, 0), TZ, 8, 19)).toBeNull()
    expect(nowOffset(at(20, 0), TZ, 8, 19)).toBeNull()
  })
})
