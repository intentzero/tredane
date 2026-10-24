/**
 * Logs técnicos correlacionados (#44 / REQ-070 / AC-15).
 * Nunca incluir conteúdo pessoal, tokens ou corpos de mensagem.
 */

export type OpsLogLevel = 'info' | 'warn' | 'error'

export type OpsLogEntry = {
  level: OpsLogLevel
  /** Canal estável (ex.: inbound_queue, pix_webhook, ops). */
  channel: string
  /** Nome do evento técnico (ex.: queue.poison, alert.dlq). */
  event: string
  correlationId?: string
  tenantId?: string
  /** Operação de negócio/técnica (ex.: whatsapp.send, tenant.purge). */
  operation?: string
  /** Etapa dentro da operação (ex.: enqueue, reconcile, wipe). */
  stage?: string
  /** Resultado técnico curto. */
  outcome?: string
  /** Campos adicionais já limpos (sem PII). */
  detail?: Record<string, unknown>
}

export type OpsLogSink = (line: string, level: OpsLogLevel) => void

/** Chaves e padrões que nunca devem aparecer em logs técnicos. */
const FORBIDDEN_KEY_RE =
  /^(?:body|text|content|message|messages|prompt|response|payload|raw|phone|wa_?id|email|name|display_?name|first_?name|last_?name|token|secret|authorization|password|cookie|api_?key|private_?key|attachment|media|caption|template_params|detail_json)$/i

const FORBIDDEN_VALUE_HINT =
  /sk_live|sk_test|Bearer\s+[A-Za-z0-9._-]+|-----BEGIN|eyJ[A-Za-z0-9_-]{20,}/i

export function newCorrelationId(prefix = 'corr'): string {
  const rand = crypto.randomUUID().replace(/-/g, '').slice(0, 16)
  return `${prefix}_${rand}`
}

export function isForbiddenLogKey(key: string): boolean {
  return FORBIDDEN_KEY_RE.test(key)
}

/**
 * Remove chaves proibidas e redige valores que parecem segredos.
 * Arrays/objetos aninhados são percorridos; strings longas são truncadas.
 */
export function scrubLogDetail(
  detail: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!detail) return {}
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(detail)) {
    if (isForbiddenLogKey(key)) continue
    out[key] = scrubValue(value, 0)
  }
  return out
}

function scrubValue(value: unknown, depth: number): unknown {
  if (depth > 4) return '[truncated]'
  if (value == null) return value
  if (typeof value === 'string') {
    if (FORBIDDEN_VALUE_HINT.test(value)) return '[redacted]'
    return value.length > 200 ? `${value.slice(0, 200)}…` : value
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((v) => scrubValue(v, depth + 1))
  }
  if (typeof value === 'object') {
    const nested: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isForbiddenLogKey(k)) continue
      nested[k] = scrubValue(v, depth + 1)
    }
    return nested
  }
  return String(value)
}

export function formatOpsLogLine(entry: OpsLogEntry): string {
  const line = {
    ts: new Date().toISOString(),
    channel: entry.channel,
    event: entry.event,
    level: entry.level,
    correlationId: entry.correlationId ?? null,
    tenantId: entry.tenantId ?? null,
    operation: entry.operation ?? null,
    stage: entry.stage ?? null,
    outcome: entry.outcome ?? null,
    ...scrubLogDetail(entry.detail),
  }
  return JSON.stringify(line)
}

const defaultSink: OpsLogSink = (line, level) => {
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.info(line)
}

/**
 * Emite log estruturado para Workers Observability / console.
 * Compatível com o contrato `{ level, event, detail }` usado em webhooks/filas.
 */
export function emitOpsLog(
  entry: OpsLogEntry,
  sink: OpsLogSink = defaultSink,
): void {
  sink(formatOpsLogLine(entry), entry.level)
}

export type ChannelLogger = (entry: {
  level: OpsLogLevel
  event: string
  detail: Record<string, unknown>
}) => void

/** Adaptador para deps.log existentes (whatsapp/pix) com canal e correlação fixos. */
export function createChannelLogger(
  channel: string,
  base?: Partial<Pick<OpsLogEntry, 'correlationId' | 'tenantId' | 'operation'>>,
  sink?: OpsLogSink,
): ChannelLogger {
  return (entry) => {
    const detail = scrubLogDetail(entry.detail)
    emitOpsLog(
      {
        level: entry.level,
        channel,
        event: entry.event,
        correlationId:
          (typeof detail.correlationId === 'string'
            ? detail.correlationId
            : undefined) ?? base?.correlationId,
        tenantId:
          (typeof detail.tenantId === 'string' ? detail.tenantId : undefined) ??
          base?.tenantId,
        operation: base?.operation,
        stage:
          typeof detail.stage === 'string' ? detail.stage : undefined,
        outcome:
          typeof detail.outcome === 'string' ? detail.outcome : undefined,
        detail,
      },
      sink,
    )
  }
}

/** Verifica se uma linha serializada contém padrões de PII/segredo óbvios. */
export function assertLogLineSafe(line: string): {
  ok: boolean
  reasons: string[]
} {
  const reasons: string[] = []
  if (FORBIDDEN_VALUE_HINT.test(line)) {
    reasons.push('possible_secret_material')
  }
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>
    for (const key of Object.keys(parsed)) {
      if (isForbiddenLogKey(key)) reasons.push(`forbidden_key:${key}`)
    }
  } catch {
    reasons.push('not_json')
  }
  return { ok: reasons.length === 0, reasons }
}
