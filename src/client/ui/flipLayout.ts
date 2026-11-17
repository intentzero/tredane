/** Layout snapshots for FLIP (First, Last, Invert, Play) card moves. */

export type FlipRectMap = Map<string, DOMRect>

export const FLIP_KEY_ATTR = 'data-flip-key'

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/** Read card bounding rects keyed by `data-flip-key`. */
export function readFlipRects(container: HTMLElement, attr = FLIP_KEY_ATTR): FlipRectMap {
  const map: FlipRectMap = new Map()
  for (const el of container.querySelectorAll<HTMLElement>(`[${attr}]`)) {
    const key = el.getAttribute(attr)
    if (!key) continue
    map.set(key, el.getBoundingClientRect())
  }
  return map
}

export type FlipMotionTokens = {
  durationMs: number
  easing: string
  reducedFadeMs: number
}

const DEFAULT_DURATION_MS = 300
const DEFAULT_EASING = 'cubic-bezier(0, 0, 0.2, 1)'
const DEFAULT_REDUCED_FADE_MS = 120

/** Resolve motion tokens from CSS custom properties on the board root. */
export function readFlipMotionTokens(container: HTMLElement): FlipMotionTokens {
  const cs = getComputedStyle(container)
  const rawMs = cs.getPropertyValue('--motion-kanban-flip-ms').trim()
  const durationMs = rawMs ? Number.parseFloat(rawMs) : DEFAULT_DURATION_MS
  const easing = cs.getPropertyValue('--motion-kanban-ease-out').trim() || DEFAULT_EASING
  const rawFade = cs.getPropertyValue('--motion-kanban-reduced-fade-ms').trim()
  const reducedFadeMs = rawFade ? Number.parseFloat(rawFade) : DEFAULT_REDUCED_FADE_MS
  return {
    durationMs: Number.isFinite(durationMs) ? durationMs : DEFAULT_DURATION_MS,
    easing,
    reducedFadeMs: Number.isFinite(reducedFadeMs) ? reducedFadeMs : DEFAULT_REDUCED_FADE_MS,
  }
}

export type PlayFlipOptions = {
  motion?: Partial<FlipMotionTokens>
  /** When true, skip all movement (used in tests and for reduced motion). */
  forceReducedMotion?: boolean
}

/**
 * Animate cards from `before` positions to their current layout.
 * Only keys listed in `keys` are considered (e.g. cards whose pipeline stage changed).
 */
export function playFlipAnimations(
  container: HTMLElement,
  before: FlipRectMap,
  keys: Iterable<string>,
  options?: PlayFlipOptions,
): void {
  const reduced = options?.forceReducedMotion === true || prefersReducedMotion()
  const motion = { ...readFlipMotionTokens(container), ...options?.motion }

  for (const key of keys) {
    const first = before.get(key)
    if (!first) continue
    const el = container.querySelector<HTMLElement>(`[${FLIP_KEY_ATTR}="${cssEscape(key)}"]`)
    if (!el) continue
    const last = el.getBoundingClientRect()
    const dx = first.left - last.left
    const dy = first.top - last.top
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue

    el.style.transition = 'none'

    if (reduced) {
      void el.animate([{ opacity: 0.72 }, { opacity: 1 }], {
        duration: motion.reducedFadeMs,
        easing: 'ease-out',
        fill: 'none',
      })
      continue
    }

    el.style.willChange = 'transform'
    el.style.transform = `translate(${dx}px, ${dy}px)`
    const anim = el.animate(
      [
        { transform: `translate(${dx}px, ${dy}px)` },
        { transform: 'translate(0, 0)' },
      ],
      { duration: motion.durationMs, easing: motion.easing, fill: 'none' },
    )
    anim.onfinish = () => {
      el.style.transform = ''
      el.style.willChange = ''
      el.style.transition = ''
    }
    anim.oncancel = anim.onfinish
  }
}

/** Keys whose stage value changed between two maps (same key, different stage). */
export function keysWithStageChange(
  prev: Map<string, string>,
  next: Map<string, string>,
): string[] {
  const out: string[] = []
  for (const [key, stage] of next) {
    const was = prev.get(key)
    if (was != null && was !== stage) out.push(key)
  }
  return out
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value)
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}