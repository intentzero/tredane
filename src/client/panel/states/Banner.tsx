import { CircleAlert, CircleCheck, Clock, Info } from 'lucide-react'
import { useId, type ReactNode } from 'react'

export type BannerTone = 'error' | 'warn' | 'ok' | 'info'

const ICONS = {
  error: CircleAlert,
  warn: Clock,
  ok: CircleCheck,
  info: Info,
} as const

type Props = {
  tone: BannerTone
  /** Diz o que aconteceu. */
  title: string
  /** Diz o que fazer. Pode ter parágrafos, listas e links. */
  children?: ReactNode
  /** No máximo uma ação principal. */
  action?: ReactNode
  /** Erro usa role="alert" por padrão; os demais não anunciam sozinhos. */
  role?: 'alert' | 'status'
}

/**
 * Aviso de estado dentro da tela. Erro = algo parou e pede ação; aviso = vai
 * parar ou pede atenção; ok = só depois de concluir algo; info = explicação.
 * Código técnico nunca entra aqui (use «Detalhes para o suporte»).
 */
export function Banner({ tone, title, children, action, role }: Props) {
  const titleId = useId()
  const Icon = ICONS[tone]
  return (
    <section
      className={`panel-banner panel-banner-${tone}`}
      aria-labelledby={titleId}
      role={role ?? (tone === 'error' ? 'alert' : undefined)}
    >
      <Icon className="panel-banner-icon" aria-hidden size={20} strokeWidth={2} />
      <div className="panel-banner-body">
        <h2 id={titleId} className="panel-banner-title">
          {title}
        </h2>
        {children}
        {action ? <div className="panel-banner-action">{action}</div> : null}
      </div>
    </section>
  )
}
