import { FlaskConical } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * Ambiente de testes: máquina local ou staging (hostname «staging.…»).
 * Qualquer outro endereço (produção, domínio novo) é tratado como real, então
 * as ferramentas de teste ficam escondidas por padrão.
 */
export function isTestEnvironment(
  hostname: string = typeof window !== 'undefined' ? window.location.hostname : '',
): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname.endsWith('.localhost') ||
    hostname.startsWith('staging.')
  )
}

type Props = {
  children?: ReactNode
  /** O que a ferramenta faz, em uma frase. */
  note?: string
  /** Só para testes automatizados. */
  hostname?: string
}

/**
 * Separa do uso real o que só existe para testar (dados de exemplo, conexão
 * simulada). Fora de local/staging não renderiza nada.
 */
export function TestOnly({ children, note, hostname }: Props) {
  if (!isTestEnvironment(hostname)) return null
  return (
    <aside className="test-only" aria-label="Ferramenta de teste">
      <p className="test-only-label">
        <FlaskConical aria-hidden size={14} strokeWidth={2} />
        Só em testes
      </p>
      {note ? <p className="test-only-note">{note}</p> : null}
      {children ? <div className="test-only-actions">{children}</div> : null}
    </aside>
  )
}
