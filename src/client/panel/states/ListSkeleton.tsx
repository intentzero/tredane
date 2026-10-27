/**
 * Esqueleto de lista (avatar + duas linhas) enquanto carrega, no lugar de um
 * texto solto numa tela vazia. O rótulo fica só para leitor de tela.
 */
export function ListSkeleton({
  label = 'Carregando…',
  rows = 6,
}: {
  label?: string
  rows?: number
}) {
  return (
    <div className="panel-skeleton" role="status" aria-live="polite" aria-busy="true">
      <span className="panel-sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="panel-skeleton-row" aria-hidden="true">
          <span className="panel-skeleton-avatar" />
          <span className="panel-skeleton-lines">
            <span className="panel-skeleton-line panel-skeleton-line--title" />
            <span className="panel-skeleton-line" />
          </span>
        </div>
      ))}
    </div>
  )
}
