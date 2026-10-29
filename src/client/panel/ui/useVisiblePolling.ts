import { useEffect, useRef } from 'react'

/**
 * Repete `callback` a cada `ms` só enquanto a aba está visível. Com a aba oculta o intervalo para
 * (não gasta leituras do Durable Object à toa) e, ao voltar a ficar visível, chama `callback` já e
 * retoma o ritmo. Quem usa continua com o seu caminho principal (WebSocket); isto é o plano B.
 */
export function useVisiblePolling(callback: () => void, ms: number) {
  const saved = useRef(callback)
  saved.current = callback

  useEffect(() => {
    let timer: number | null = null
    const start = () => {
      if (timer == null) timer = window.setInterval(() => saved.current(), ms)
    }
    const stop = () => {
      if (timer != null) {
        window.clearInterval(timer)
        timer = null
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        saved.current()
        start()
      } else {
        stop()
      }
    }
    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      stop()
    }
  }, [ms])
}
