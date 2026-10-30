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

/* ------------------------------------------------------------------ */
/* S6 (#177) — schema fechado da saída do modelo                       */
/* ------------------------------------------------------------------ */

export const REPLY_OUTPUT_MAX_MESSAGE_CHARS = 1000
export const REPLY_OUTPUT_MAX_NOTES_CHARS = 600

/** Únicos campos aceites no objeto JSON (inclui sinónimos tolerados pelo parser). */
const ALLOWED_REPLY_KEYS = new Set(['mensagem', 'message', 'resposta', 'notas', 'notes'])

export type ReplyOutputRejection =
  | 'malformed'
  | 'extra_fields'
  | 'invalid_types'
  | 'too_long'
  | 'role_marker'
  | 'privileged_content'
  | 'claims_booking'
  | 'tempo_leak'

export type GuardedReply =
  | { ok: true; message: string; notes: string }
  | { ok: false; reason: ReplyOutputRejection; notes: string }

const OUT_ROLE_MARKER_RE = /\[\s*(cl[ií]nica|cliente|sistema|system|assistant|assistente|admin)\s*\]|<<<|>>>|<\s*\/?\s*(system|assistant|tool)/i
/** IDs internos, comandos e meios de pagamento que o modelo nunca deve emitir. */
const OUT_PRIVILEGED_RE =
  /\b(tenant_?id|clinic_?id|clerk_?user_?id|suggestion_?id|appointment_?id|tool_call|function_call|tool_use|autobook|ai_booked|confirmAppointment)\b|\bchave\s+pix\b|\b000201\d{4,}|\bpix\s+copia\s+e\s+cola\b/i
/** O modelo nunca afirma que algo foi marcado/confirmado (só o backend pode). */
const OUT_CLAIMS_BOOKING_RE =
  /\b(j[aá]\s+)?(est[aá]|ficou|foi|deixei|t[aá])\s+(j[aá]\s+)?(marcad[oa]|agendad[oa]|confirmad[oa]|reservad[oa])\b|\b(marquei|agendei|reservei|confirmei)\b/i

function findTopLevelObject(raw: string): Record<string, unknown> | null | 'invalid' {
  const src = raw.replace(/```[a-zA-Z]*\s*/g, '').replace(/```/g, '')
  if (/^\s*\[/.test(src)) return 'invalid'
  const start = src.indexOf('{')
  const end = src.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const obj: unknown = JSON.parse(src.slice(start, end + 1))
    if (obj == null || typeof obj !== 'object' || Array.isArray(obj)) return 'invalid'
    return obj as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * Valida a saída do modelo contra o schema fechado `{mensagem, notas}`.
 * Qualquer desvio → rejeição com fallback humano (a atendente responde sozinha).
 * A saída nunca autoriza nada; esta validação só decide se o rascunho é mostrado.
 */
export function guardReplyOutput(raw: string): GuardedReply {
  const obj = findTopLevelObject(raw)
  if (obj === 'invalid') return { ok: false, reason: 'invalid_types', notes: '' }
  if (obj) {
    for (const k of Object.keys(obj)) {
      if (!ALLOWED_REPLY_KEYS.has(k)) return { ok: false, reason: 'extra_fields', notes: '' }
    }
    const msg = obj.mensagem ?? obj.message ?? obj.resposta
    const notes = obj.notas ?? obj.notes
    const notesOk =
      notes === undefined ||
      typeof notes === 'string' ||
      (Array.isArray(notes) && notes.every((x) => typeof x === 'string'))
    if (typeof msg !== 'string' || !notesOk) return { ok: false, reason: 'invalid_types', notes: '' }
  }
  const parsed = parseReplyOutput(raw)
  if (!parsed.message) return { ok: false, reason: 'malformed', notes: '' }
  if (
    parsed.message.length > REPLY_OUTPUT_MAX_MESSAGE_CHARS ||
    parsed.notes.length > REPLY_OUTPUT_MAX_NOTES_CHARS
  ) {
    return { ok: false, reason: 'too_long', notes: '' }
  }
  const both = `${parsed.message}\n${parsed.notes}`
  if (OUT_ROLE_MARKER_RE.test(both)) return { ok: false, reason: 'role_marker', notes: '' }
  if (OUT_PRIVILEGED_RE.test(both)) return { ok: false, reason: 'privileged_content', notes: '' }
  if (OUT_CLAIMS_BOOKING_RE.test(parsed.message)) return { ok: false, reason: 'claims_booking', notes: '' }
  return { ok: true, message: parsed.message, notes: parsed.notes }
}

/* Resumo interno: prosa simples, sem o schema {mensagem, notas}. */
export type SummaryOutputRejection = 'empty' | 'role_marker' | 'tool_call' | 'claims_action'

export type GuardedSummary =
  | { ok: true; text: string }
  | { ok: false; reason: SummaryOutputRejection }

const SUMMARY_TOOL_RE = /\b(tool_call|function_call|tool_use)\b|<\s*\/?\s*tool\b/i
/** Primeira pessoa: o modelo diz que marcou ou enviou. «Ficou marcado» continua válido no resumo. */
const SUMMARY_CLAIMS_ACTION_RE = /\b(marquei|agendei|reservei|confirmei|enviei)\b/i

export function guardSummaryOutput(raw: string): GuardedSummary {
  const text = raw.replace(/\r\n/g, '\n').trim()
  if (!text) return { ok: false, reason: 'empty' }
  if (OUT_ROLE_MARKER_RE.test(text)) return { ok: false, reason: 'role_marker' }
  if (SUMMARY_TOOL_RE.test(text)) return { ok: false, reason: 'tool_call' }
  if (SUMMARY_CLAIMS_ACTION_RE.test(text)) return { ok: false, reason: 'claims_action' }
  return { ok: true, text }
}
