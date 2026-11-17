import { highlightRange } from './search-model'

/** Texto com o termo da pesquisa realçado (`<mark>`); sem termo ou sem casamento, o texto simples. */
export function Highlight({ text, query }: { text: string; query: string }) {
  const range = query.trim() ? highlightRange(text, query) : null
  if (!range) return <>{text}</>
  return (
    <>
      {text.slice(0, range[0])}
      <mark className="cw-mark">{text.slice(range[0], range[1])}</mark>
      {text.slice(range[1])}
    </>
  )
}
