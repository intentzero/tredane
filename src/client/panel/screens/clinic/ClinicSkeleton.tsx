import { useEffect, useState, type ReactNode } from 'react'

/** Forma do esqueleto: a de cada tela da Clínica quando pronta (DEC-174). */
export type ClinicSkeletonShape =
  | 'index'
  | 'table'
  | 'week'
  | 'list'
  | 'connection'
  | 'form'
  | 'cards'

type Props = {
  shape: ClinicSkeletonShape
  /** Só para leitor de tela: «Carregando {título}». */
  label: string
  /** Cargas mais rápidas que isto entram diretas, sem piscar o esqueleto. */
  delayMs?: number
}

function Line({ variant }: { variant?: 'title' | 'short' | 'value' | 'label' }) {
  return <span className={`clinic-sk clinic-sk-line${variant ? ` clinic-sk-line--${variant}` : ''}`} />
}

function Rows({
  count,
  lead,
  value,
}: {
  count: number
  lead?: 'avatar' | 'icon'
  value?: boolean
}) {
  return (
    <div className="clinic-sk-list">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="clinic-sk-row">
          {lead ? <span className={`clinic-sk clinic-sk-avatar clinic-sk-avatar--${lead}`} /> : null}
          <span className="clinic-sk-lines">
            <Line variant="title" />
            {lead ? <Line /> : null}
          </span>
          {value ? <Line variant="value" /> : null}
        </div>
      ))}
    </div>
  )
}

function Card({ children }: { children: ReactNode }) {
  return <div className="clinic-sk-card">{children}</div>
}

function Shape({ shape }: { shape: ClinicSkeletonShape }) {
  switch (shape) {
    case 'index':
      return (
        <>
          {[3, 3, 2].map((n, i) => (
            <div key={i} className="clinic-sk-group">
              <Line variant="label" />
              <Rows count={n} value />
            </div>
          ))}
        </>
      )
    case 'table':
      return <Rows count={5} value />
    case 'week':
      return (
        <>
          <span className="clinic-sk clinic-sk-banner" />
          <div className="clinic-sk-list">
            {Array.from({ length: 7 }, (_, i) => (
              <div key={i} className="clinic-sk-row">
                <Line variant="label" />
                <span className={`clinic-sk clinic-sk-bar${i > 4 ? ' clinic-sk-bar--short' : ''}`} />
              </div>
            ))}
          </div>
        </>
      )
    case 'list':
      return (
        <>
          <div className="clinic-sk-head">
            <Line variant="short" />
            <span className="clinic-sk clinic-sk-button" />
          </div>
          <Rows count={4} lead="avatar" />
        </>
      )
    case 'connection':
      return (
        <>
          <span className="clinic-sk clinic-sk-banner" />
          <Card>
            <Line variant="title" />
            <Line />
          </Card>
          <Rows count={3} lead="icon" />
        </>
      )
    case 'form':
      return (
        <>
          <span className="clinic-sk clinic-sk-banner" />
          <Card>
            <Line variant="title" />
            <Line variant="label" />
            <span className="clinic-sk-field" />
            <span className="clinic-sk clinic-sk-button" />
          </Card>
          <Card>
            <Line variant="title" />
            <Line variant="label" />
            <span className="clinic-sk-field" />
            <span className="clinic-sk-field clinic-sk-field--tall" />
          </Card>
        </>
      )
    case 'cards':
      return (
        <>
          {[0, 1, 2].map((i) => (
            <Card key={i}>
              <div className="clinic-sk-head">
                <Line variant="title" />
                <span className="clinic-sk clinic-sk-toggle" />
              </div>
              <Line />
              <Line variant="short" />
            </Card>
          ))}
        </>
      )
  }
}

/**
 * Esqueleto com a forma da tela (DEC-174): fica dentro da moldura da Clínica, sem spinner
 * de página nem texto visível; só aparece depois de `delayMs` para não piscar.
 */
export function ClinicSkeleton({ shape, label, delayMs = 300 }: Props) {
  const [visible, setVisible] = useState(delayMs <= 0)
  useEffect(() => {
    if (delayMs <= 0) return
    const t = window.setTimeout(() => setVisible(true), delayMs)
    return () => window.clearTimeout(t)
  }, [delayMs])
  return (
    <div
      className="clinic-skeleton"
      data-shape={shape}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="panel-sr-only">{label}</span>
      {visible ? (
        <div className="clinic-skeleton-body" aria-hidden="true">
          <Shape shape={shape} />
        </div>
      ) : null}
    </div>
  )
}

/** Esqueleto curto dentro de um cartão que carrega à parte (ex.: limites das automações). */
export function ClinicSkeletonLines({ label, lines = 3 }: { label: string; lines?: number }) {
  return (
    <div className="clinic-skeleton clinic-skeleton--inline" role="status" aria-busy="true">
      <span className="panel-sr-only">{label}</span>
      <div className="clinic-skeleton-body" aria-hidden="true">
        {Array.from({ length: lines }, (_, i) => (
          <Line key={i} variant={i === lines - 1 ? 'short' : undefined} />
        ))}
      </div>
    </div>
  )
}
