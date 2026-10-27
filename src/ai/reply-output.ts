/**
 * Separa a mensagem à cliente das notas internas (saída estruturada JSON).
 * Tolerante: se o modelo devolver texto solto/markdown, limpa e separa as notas.
 */
export type ParsedReply = { message: string; notes: string }

export function stripMarkdown(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(^|[^*])\*(?!\s)([^*\n]+)\*/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*(?:sugest[aã]o de resposta|resposta sugerida|mensagem)\s*:?\s*$/gim, '')
    .replace(/^\s*(?:sugest[aã]o de resposta|resposta sugerida)\s*:\s*/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .replace(/^["«“]+|["»”]+$/g, '')
    .trim()
}

function tryJson(raw: string): ParsedReply | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const obj = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>
    const msg = obj.mensagem ?? obj.message ?? obj.resposta
    if (typeof msg !== 'string') return null
    const notesRaw = obj.notas ?? obj.notes ?? ''
    const notes = Array.isArray(notesRaw)
      ? notesRaw.filter((x) => typeof x === 'string').join('\n')
      : typeof notesRaw === 'string'
        ? notesRaw
        : ''
    return { message: stripMarkdown(msg), notes: notes.trim() }
  } catch {
    return null
  }
}

const NOTES_LINE =
  /^\s*(?:#+\s*)?\**\s*(observa[cç](?:ões|oes|ão|ao)|notas?\b|nota interna|para a atendente)/i

export function parseReplyOutput(raw: string): ParsedReply {
  const json = tryJson(raw)
  if (json && json.message) return json
  const lines = raw.replace(/\r\n/g, '\n').split('\n')
  const idx = lines.findIndex((l) => NOTES_LINE.test(l))
  if (idx >= 0) {
    return {
      message: stripMarkdown(lines.slice(0, idx).join('\n')),
      notes: stripMarkdown(lines.slice(idx + 1).join('\n')),
    }
  }
  return { message: stripMarkdown(raw), notes: '' }
}
