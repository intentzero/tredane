import { useEffect, useState, type CSSProperties } from 'react'

/**
 * Folha inferior que acompanha o visualViewport (iOS Safari): com o teclado
 * aberto, a folha sobe acima dele e encolhe, mantendo a rolagem interna.
 */
export function useVisualViewportSheet(active: boolean): CSSProperties {
  const [vv, setVv] = useState<{ height: number; bottomInset: number } | null>(null)

  useEffect(() => {
    const view = typeof window !== 'undefined' ? window.visualViewport : null
    if (!active || !view) return
    const update = () => {
      const bottomInset = Math.max(0, window.innerHeight - view.height - view.offsetTop)
      setVv({ height: view.height, bottomInset })
    }
    update()
    // Campo focado (ex.: mensagem) fica visível acima do teclado.
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target as HTMLElement | null
      if (!el || !el.matches?.('textarea, input')) return
      window.setTimeout(() => {
        // jsdom (testes) e alguns navegadores antigos não têm scrollIntoView.
        if (el.isConnected) el.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
      }, 300)
    }
    document.addEventListener('focusin', onFocusIn)
    view.addEventListener('resize', update)
    view.addEventListener('scroll', update)
    return () => {
      document.removeEventListener('focusin', onFocusIn)
      view.removeEventListener('resize', update)
      view.removeEventListener('scroll', update)
    }
  }, [active])

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
