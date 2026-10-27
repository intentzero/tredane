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

/** Lê uma string JSON a partir de `i` (logo após a aspa de abertura). Tolera corte no fim. */
function readJsonString(src: string, i: number): { value: string; closed: boolean } {
  let out = ''
  while (i < src.length) {
    const ch = src[i]!
    if (ch === '"') return { value: out, closed: true }
    if (ch === '\\') {
      const n = src[i + 1]
      if (n === undefined) break // corte a meio de um escape
      if (n === 'u') {
        const hex = src.slice(i + 2, i + 6)
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) break
        out += String.fromCharCode(parseInt(hex, 16))
        i += 6
        continue
      }
      const map: Record<string, string> = { n: '\n', t: '\t', r: '', b: '', f: '', '"': '"', '\\': '\\', '/': '/' }
      out += map[n] ?? n
      i += 2
      continue
    }
    out += ch
    i += 1
  }
  return { value: out, closed: false }
}

/** Valor string de `key` num objeto JSON, mesmo truncado (ex.: corte por max_tokens). */
function extractJsonStringField(src: string, keys: string[]): string | null {
  for (const key of keys) {
    const re = new RegExp(`"${key}"\\s*:\\s*"`)
    const m = re.exec(src)
    if (m) return readJsonString(src, m.index + m[0].length).value
  }
  return null
}

function looksLikeJson(raw: string): boolean {
  return /^\s*(?:```[a-z]*\s*)?\{/i.test(raw) || /\{\s*"(?:mensagem|message|resposta|notas|notes)"\s*:/.test(raw)
}

function stripFences(raw: string): string {
  return raw.replace(/```[a-zA-Z]*\s*/g, '').replace(/```/g, '')
}

function tryJson(raw: string): ParsedReply | null {
  const src = stripFences(raw)
  const start = src.indexOf('{')
  if (start < 0) return null
  const end = src.lastIndexOf('}')
  if (end > start) {
    try {
      const obj = JSON.parse(src.slice(start, end + 1)) as Record<string, unknown>
      const msg = obj.mensagem ?? obj.message ?? obj.resposta
      if (typeof msg === 'string') {
        const notesRaw = obj.notas ?? obj.notes ?? ''
        const notes = Array.isArray(notesRaw)
          ? notesRaw.filter((x) => typeof x === 'string').join('\n')
          : typeof notesRaw === 'string'
            ? notesRaw
            : ''
        return { message: stripMarkdown(msg), notes: notes.trim() }
      }
    } catch {
      /* cai na leitura tolerante abaixo */
    }
  }
  // JSON inválido ou truncado: recupera os campos à mão.
  const body = src.slice(start)
  const msg = extractJsonStringField(body, ['mensagem', 'message', 'resposta'])
  if (msg == null) return null
  const notes = extractJsonStringField(body, ['notas', 'notes']) ?? ''
  return { message: stripMarkdown(msg), notes: notes.trim() }
}

/** Nunca deixa JSON/chaves chegarem à atendente. */
function hasJsonResidue(text: string): boolean {
  return /[{}]/.test(text) && /"\s*:/.test(text)
}

const NOTES_LINE =
  /^\s*(?:#+\s*)?\**\s*(observa[cç](?:ões|oes|ão|ao)|notas?\b|nota interna|para a atendente)/i

/**
 * `message` vazio = nada utilizável (o chamador mostra o erro amigável).
 * Tolera ```json, prosa antes/depois, JSON truncado e pedaços acumulados.
 */
export function parseReplyOutput(raw: string): ParsedReply {
  const json = tryJson(raw)
  if (json) {
    if (json.message && !hasJsonResidue(json.message)) return json
    return { message: '', notes: json.notes }
  }
  if (looksLikeJson(raw)) return { message: '', notes: '' }
  const lines = raw.replace(/\r\n/g, '\n').split('\n')
  const idx = lines.findIndex((l) => NOTES_LINE.test(l))
  if (idx >= 0) {
    return {
      message: stripMarkdown(lines.slice(0, idx).join('\n')),
      notes: stripMarkdown(lines.slice(idx + 1).join('\n')),
    }
  }
  const message = stripMarkdown(stripFences(raw))
  return { message: hasJsonResidue(message) ? '' : message, notes: '' }
}
