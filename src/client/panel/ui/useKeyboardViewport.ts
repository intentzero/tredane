import { useEffect } from 'react'

/** Diferença mínima (px) entre a janela e o visualViewport para contar como teclado aberto. */
const KEYBOARD_MIN_PX = 120

const NON_TEXT_INPUT = new Set([
  'button',
  'checkbox',
  'radio',
  'file',
  'submit',
  'reset',
  'image',
  'range',
  'color',
  'hidden',
])

/** Campo que pode abrir o teclado virtual (não basta o chrome do Safari encolher o visualViewport). */
export function isEditableKeyboardTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  const contentEditable = el.getAttribute('contenteditable')
  if (el.isContentEditable || contentEditable === 'true' || contentEditable === '') return true
  const tag = el.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type || 'text'
    return !NON_TEXT_INPUT.has(type.toLowerCase())
  }
  return Boolean(el.closest('[contenteditable="true"]'))
}

/**
 * iOS Safari/PWA: com o teclado aberto o layout viewport não encolhe, então o
 * compositor (fundo da `.panel-app`, que tem 100dvh / inset:0) fica atrás do teclado.
 * Este hook publica a área visível no <html> só enquanto o teclado está aberto
 * (só em ecrã tátil, sem zoom, e com um campo editável focado — o chrome do Safari
 * também encolhe o visualViewport e, sem o foco, a app ficava presa numa altura
 * menor e a barra inferior subia com uma faixa branca por baixo):
 * - `--panel-vvh` = visualViewport.height
 * - `--panel-vv-top` = visualViewport.offsetTop (o iOS sobe o viewport ao focar)
 * - `--keyboard-inset-bottom` = espaço sob o viewport (teclado + AutoFill)
 *
 * O CSS prende `.panel-app:has(.inbox-thread)` a `top`+`height` com
 * `data-keyboard=open`, para o compositor da thread ficar acima do teclado.
 * Fora da thread o shell fica em `inset:0` (barra inferior no fundo do layout).
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
        const editing = isEditableKeyboardTarget(document.activeElement)
        const keyboardOpen =
          touch && !zoomed && editing && window.innerHeight - view.height > KEYBOARD_MIN_PX
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
    const onFocusIn = () => {
      update()
    }
    const onFocusOut = () => {
      // Troca entre campos: o próximo focusin chega no mesmo frame; sem isto
      // limpávamos o teclado a meio da mudança.
      requestAnimationFrame(() => update())
    }
    update()
    view.addEventListener('resize', update)
    view.addEventListener('scroll', update)
    window.addEventListener('scroll', resetDocumentScroll, { passive: true })
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    return () => {
      cancelAnimationFrame(frame)
      view.removeEventListener('resize', update)
      view.removeEventListener('scroll', update)
      window.removeEventListener('scroll', resetDocumentScroll)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
      clearVars()
    }
  }, [])
}
