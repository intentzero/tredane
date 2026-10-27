import { useEffect } from 'react'

/** Diferença mínima (px) entre a janela e o visualViewport para contar como teclado aberto. */
const KEYBOARD_MIN_PX = 120

/**
 * iOS Safari/PWA: com o teclado aberto o layout viewport não encolhe, então o
 * compositor (fundo da `.panel-app`, que tem 100dvh) fica atrás do teclado.
 * Este hook publica a altura visível em `--panel-vvh` no <html> só enquanto o
 * teclado está aberto; o CSS usa `height: var(--panel-vvh)` (padrão 100dvh).
 */
export function useKeyboardViewport(): void {
  useEffect(() => {
    const view = typeof window !== 'undefined' ? window.visualViewport : null
    if (!view) return
    const root = document.documentElement
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const keyboardOpen = window.innerHeight - view.height > KEYBOARD_MIN_PX
        if (keyboardOpen) {
          root.style.setProperty('--panel-vvh', `${Math.round(view.height)}px`)
          root.dataset.keyboard = 'open'
          // O iOS rola a página para mostrar o campo; com a altura ajustada não há o que rolar.
          if (window.scrollY !== 0) window.scrollTo(0, 0)
        } else {
          root.style.removeProperty('--panel-vvh')
          delete root.dataset.keyboard
        }
      })
    }
    update()
    view.addEventListener('resize', update)
    return () => {
      cancelAnimationFrame(frame)
      view.removeEventListener('resize', update)
      root.style.removeProperty('--panel-vvh')
      delete root.dataset.keyboard
    }
  }, [])
}
