/**
 * DEC-211: «Como chegar» — o link do Google Business cadastrado pela clínica.
 * Só aparece com https; sem link, não ocupa espaço.
 */
export function DirectionsLink({ url }: { url?: string | null }) {
  const href = url?.trim()
  if (!href || !href.startsWith('https://')) return null
  return (
    <a className="cw-btn cw-btn-secondary" href={href} target="_blank" rel="noopener noreferrer">
      Como chegar
    </a>
  )
}
