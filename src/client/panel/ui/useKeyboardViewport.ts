import { useEffect } from 'react'

/** Diferença mínima (px) entre a janela e o visualViewport para contar como teclado aberto. */
const KEYBOARD_MIN_PX = 120

/**
 * iOS Safari/PWA: com o teclado aberto o layout viewport não encolhe, então o
 * compositor (fundo da `.panel-app`, que tem 100dvh / inset:0) fica atrás do teclado.
 * Este hook publica a altura visível em `--panel-vvh` no <html> só enquanto o
 * teclado está aberto (só em ecrã tátil e sem zoom — com zoom por pinça o viewport
 * também encolhe e a app ficava presa numa altura menor); o CSS usa
 * `height: var(--panel-vvh)` só com `data-keyboard=open`.
 *
 * Também repõe `scrollY` a 0: o iOS desloca o documento para mostrar o campo e,
 * sem isto, a barra inferior fica a meio do ecrã com um vão vazio por baixo.
 */
export function useKeyboardViewport(): void {
  useEffect(() => {
    const view = typeof window !== 'undefined' ? window.visualViewport : null
    if (!view) return
    const root = document.documentElement
    let frame = 0
    const resetDocumentScroll = () => {
      if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0)
    }
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        // Zoom por pinça (desktop ou celular) também encolhe o visualViewport: não é teclado.
        const zoomed = view.scale > 1.01
        const touch =
          typeof window.matchMedia !== 'function' || window.matchMedia('(pointer: coarse)').matches
        const keyboardOpen = touch && !zoomed && window.innerHeight - view.height > KEYBOARD_MIN_PX
        if (keyboardOpen) {
          root.style.setProperty('--panel-vvh', `${Math.round(view.height)}px`)
          root.dataset.keyboard = 'open'
          resetDocumentScroll()
        } else {
          root.style.removeProperty('--panel-vvh')
          delete root.dataset.keyboard
          resetDocumentScroll()
        }
      })
    }
    update()
    view.addEventListener('resize', update)
    view.addEventListener('scroll', update)
    window.addEventListener('scroll', resetDocumentScroll, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      view.removeEventListener('resize', update)
      view.removeEventListener('scroll', update)
      window.removeEventListener('scroll', resetDocumentScroll)
      root.style.removeProperty('--panel-vvh')
      delete root.dataset.keyboard
    }
  }, [])
}
