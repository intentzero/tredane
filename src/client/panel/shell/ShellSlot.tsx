import { createContext, useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Espaço livre no cabeçalho do shell, à direita do título (DEC-169).
 * Uma tela pode pôr ali a sua barra de controlos; fora do shell (testes,
 * pré-visualizações) o conteúdo fica no próprio lugar.
 */
const ShellSlotContext = createContext<HTMLElement | null>(null)

export const ShellSlotProvider = ShellSlotContext.Provider

export function ShellSlot({ children }: { children: ReactNode }) {
  const el = useContext(ShellSlotContext)
  return el ? createPortal(children, el) : <>{children}</>
}
