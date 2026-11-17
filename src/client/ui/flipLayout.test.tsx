// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  keysWithStageChange,
  playFlipAnimations,
  prefersReducedMotion,
  readFlipRects,
} from './flipLayout'

function mockReducedMotion(reduced: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: reduced && query.includes('reduce'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  )
}

function stubElementAnimate() {
  const animate = vi.fn().mockImplementation(() => {
    const anim = { onfinish: null as (() => void) | null, oncancel: null as (() => void) | null }
    queueMicrotask(() => anim.onfinish?.())
    return anim
  })
  HTMLElement.prototype.animate = animate as typeof HTMLElement.prototype.animate
  return animate
}

describe('flipLayout', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('prefersReducedMotion reflects matchMedia', () => {
    mockReducedMotion(true)
    expect(prefersReducedMotion()).toBe(true)
    mockReducedMotion(false)
    expect(prefersReducedMotion()).toBe(false)
  })

  it('readFlipRects indexes elements by data-flip-key', () => {
    document.body.innerHTML = `
      <div id="board">
        <button data-flip-key="a">A</button>
        <button data-flip-key="b">B</button>
      </div>
    `
    const board = document.getElementById('board')!
    const map = readFlipRects(board)
    expect(map.size).toBe(2)
    expect(map.has('a')).toBe(true)
    expect(map.has('b')).toBe(true)
  })

  it('keysWithStageChange lists only keys whose stage changed', () => {
    const prev = new Map([
      ['a', 'novo_contato'],
      ['b', 'em_atendimento'],
    ])
    const next = new Map([
      ['a', 'em_atendimento'],
      ['b', 'em_atendimento'],
      ['c', 'agendado'],
    ])
    expect(keysWithStageChange(prev, next).sort()).toEqual(['a'])
  })

  it('playFlipAnimations skips transform when reduced motion is on', () => {
    mockReducedMotion(true)
    document.body.innerHTML = `
      <div id="board" style="--motion-kanban-reduced-fade-ms: 80">
        <button data-flip-key="x" style="position:absolute;left:0;top:0;width:40px;height:40px">X</button>
      </div>
    `
    const board = document.getElementById('board')!
    const el = board.querySelector<HTMLElement>('[data-flip-key="x"]')!
    const animateSpy = stubElementAnimate()

    const before = new Map<string, DOMRect>([
      ['x', new DOMRect(80, 40, 40, 40)],
    ])
    playFlipAnimations(board, before, ['x'])

    expect(animateSpy).toHaveBeenCalledTimes(1)
    const args = animateSpy.mock.calls[0]!
    expect(args[0]).toEqual([{ opacity: 0.72 }, { opacity: 1 }])
    expect(el.style.transform).toBe('')
  })

  it('playFlipAnimations runs translate FLIP when motion is allowed', () => {
    mockReducedMotion(false)
    document.body.innerHTML = `
      <div id="board" style="--motion-kanban-flip-ms: 280">
        <button data-flip-key="y" style="position:absolute;left:120px;top:50px;width:40px;height:40px">Y</button>
      </div>
    `
    const board = document.getElementById('board')!
    const el = board.querySelector<HTMLElement>('[data-flip-key="y"]')!
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(new DOMRect(120, 50, 40, 40))
    const animateSpy = stubElementAnimate()

    const before = new Map<string, DOMRect>([
      ['y', new DOMRect(0, 0, 40, 40)],
    ])
    playFlipAnimations(board, before, ['y'])

    expect(animateSpy).toHaveBeenCalledTimes(1)
    const keyframes = animateSpy.mock.calls[0]![0] as Keyframe[]
    expect(keyframes[0]?.transform).toMatch(/translate\(/)
  })
})