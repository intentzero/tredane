import { useEffect, useRef, type RefObject } from 'react'

/** Controlos e camadas flutuantes: um clique neles não conta como «fora» do painel. */
const PASS_THROUGH = [
  'button',
  'a[href]',
  'input',
  'select',
  'textarea',
  'label',
  '[role="button"]',
  '[role="row"]',
  '[role="option"]',
  '[role="menuitem"]',
  '[role="tab"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="listbox"]',
  '[role="menu"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '.react-aria-Popover',
  '.panel-choice-sheet',
].join(',')

/**
 * Painel lateral: um clique em área vazia fora dele fecha-o. Cliques em itens, botões e campos
 * seguem o seu caminho (abrir o detalhe de outro item troca o painel, não o fecha).
 */
export function useOutsideClose(ref: RefObject<HTMLElement | null>, onClose: () => void, enabled = true) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!enabled) return
    const onDown = (e: PointerEvent) => {
      const target = e.target
      if (!(target instanceof Element)) return
      if (ref.current?.contains(target)) return
      if (target.closest(PASS_THROUGH)) return
      closeRef.current()
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [ref, enabled])
}
