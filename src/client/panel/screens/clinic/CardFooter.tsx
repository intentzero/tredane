import { CircleAlert, Check, LoaderCircle } from 'lucide-react'
import type { ReactNode } from 'react'

export type CardNoticeValue = { tone: 'ok' | 'error'; text: string }

/**
 * DEC-174: a resposta de uma ação aparece no rodapé do cartão, ao lado do botão que a causou.
 */
export function CardNotice({ notice }: { notice: CardNoticeValue | null }) {
  if (!notice) return <span className="clinic-card-notice" aria-live="polite" />
  return (
    <span
      className="clinic-card-notice"
      data-tone={notice.tone}
      role={notice.tone === 'error' ? 'alert' : 'status'}
    >
      {notice.tone === 'error' ? (
        <CircleAlert aria-hidden size={16} strokeWidth={2.2} />
      ) : (
        <Check aria-hidden size={16} strokeWidth={2.4} />
      )}
      {notice.text}
    </span>
  )
}

/** Conteúdo de botão ocupado: spinner de 16 px dentro do próprio botão (DEC-174). */
export function BusyLabel({
  busy,
  busyText,
  children,
}: {
  busy: boolean
  busyText: string
  children: ReactNode
}) {
  if (!busy) return <>{children}</>
  return (
    <>
      <LoaderCircle className="panel-spin" aria-hidden size={16} strokeWidth={2.4} />
      {busyText}
    </>
  )
}
