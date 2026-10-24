/** Relógio injetável — timestamps UTC em milissegundos (controlável nos testes). */
export type Clock = {
  nowMs(): number
}

export const systemClock: Clock = {
  nowMs: () => Date.now(),
}

/** Relógio mutável para testes de expiração/concorrência. */
export function createControllableClock(startMs = 1_700_000_000_000): Clock & {
  set(ms: number): void
  advance(ms: number): void
} {
  let current = startMs
  return {
    nowMs: () => current,
    set(ms: number) {
      current = ms
    },
    advance(ms: number) {
      current += ms
    },
  }
}
