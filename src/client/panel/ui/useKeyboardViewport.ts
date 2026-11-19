import { useEffect } from 'react'

/** Diferença mínima (px) entre a janela e o visualViewport para contar como teclado aberto. */
const KEYBOARD_MIN_PX = 120

/**
 * iOS Safari/PWA: com o teclado aberto o layout viewport não encolhe, então o
 * compositor (fundo da `.panel-app`, que tem 100dvh / inset:0) fica atrás do teclado.
 * Este hook publica a área visível no <html> só enquanto o teclado está aberto
 * (só em ecrã tátil e sem zoom — com zoom por pinça o viewport também encolhe e a
 * app ficava presa numa altura menor):
 * - `--panel-vvh` = visualViewport.height
 * - `--panel-vv-top` = visualViewport.offsetTop (o iOS sobe o viewport ao focar)
 * - `--keyboard-inset-bottom` = espaço sob o viewport (teclado + AutoFill)
 *
 * O CSS prende `.panel-app` a `top`+`height` com `data-keyboard=open`, para o
 * compositor da thread e as folhas (ClinicSheet) ficarem acima do teclado.
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
    const clearVars = () => {
      root.style.removeProperty('--panel-vvh')
      root.style.removeProperty('--panel-vv-top')
      root.style.removeProperty('--keyboard-inset-bottom')
      delete root.dataset.keyboard
    }
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
          const offsetTop = Math.max(0, Math.round(view.offsetTop))
          const insetBottom = Math.max(
            0,
            Math.round(window.innerHeight - view.height - view.offsetTop),
          )
          root.style.setProperty('--panel-vvh', `${Math.round(view.height)}px`)
          root.style.setProperty('--panel-vv-top', `${offsetTop}px`)
          root.style.setProperty('--keyboard-inset-bottom', `${insetBottom}px`)
          root.dataset.keyboard = 'open'
          resetDocumentScroll()
        } else {
          clearVars()
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
      clearVars()
    }
  }, [])
}
