import { useEffect, useState, type CSSProperties } from 'react'

/** Diferença mínima (px) entre a janela e o visualViewport para contar como teclado aberto. */
const KEYBOARD_MIN_PX = 120

export type VisualViewportSheetMode = 'full' | 'lift'

type VvState = { height: number; bottomInset: number; keyboardOpen: boolean }

/**
 * Folha que acompanha o visualViewport (iOS Safari/PWA).
 *
 * - `full` (Reservar bloco): ocupa a área visível e sobe com o teclado.
 * - `lift` (ClinicSheet / Convidar pessoa): só ajusta `bottom` + `maxHeight` com o
 *   teclado aberto, sem forçar tela cheia quando o teclado está fechado.
 */
export function useVisualViewportSheet(
  active: boolean,
  options?: { mode?: VisualViewportSheetMode },
): CSSProperties {
  const mode = options?.mode ?? 'full'
  const [vv, setVv] = useState<VvState | null>(null)

  useEffect(() => {
    const view = typeof window !== 'undefined' ? window.visualViewport : null
    if (!active || !view) {
      setVv(null)
      return
    }
    const update = () => {
      const bottomInset = Math.max(0, window.innerHeight - view.height - view.offsetTop)
      const keyboardOpen = window.innerHeight - view.height > KEYBOARD_MIN_PX
      setVv({ height: view.height, bottomInset, keyboardOpen })
    }
    update()
    // Campo focado fica visível acima do teclado (após a animação do iOS).
    let timer: number | undefined
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target as HTMLElement | null
      if (!el || !el.matches?.('textarea, input')) return
      window.clearTimeout(timer)
      timer = window.setTimeout(() => el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }), 300)
    }
    document.addEventListener('focusin', onFocusIn)
    view.addEventListener('resize', update)
    view.addEventListener('scroll', update)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('focusin', onFocusIn)
      view.removeEventListener('resize', update)
      view.removeEventListener('scroll', update)
      setVv(null)
    }
  }, [active])

  if (mode === 'lift') {
    if (!active || !vv?.keyboardOpen) return {}
    return {
      bottom: vv.bottomInset,
      maxHeight: vv.height,
    }
  }

  return {
    position: 'fixed',
    left: 0,
    right: 0,
    bottom: vv?.bottomInset ?? 0,
    // Tela cheia no celular: ocupa a área visível (descontado o teclado).
    height: vv ? vv.height : '100dvh',
    maxHeight: vv ? vv.height : '100dvh',
  }
}
