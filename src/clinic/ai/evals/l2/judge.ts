/**
 * Juiz LLM — rubrica Q1–Q6 (#417 · plano §4.3).
 * Pode abster-se. Nunca decide preço, agenda nem autorização.
 */
import type { AiProviderAdapter } from '../../../../ai'
import { AI_MAX_OUTPUT_TOKENS_REPLY, AI_MODEL_AUTODRAFT, AI_REPLY_TEMPERATURE } from '../../../../ai'
import type { CostLedger } from './cost'
import { TrackingAiAdapter } from './tracking-adapter'

export type QAxis = 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'Q5' | 'Q6'

export type JudgeScore = {
  axis: QAxis
  /** 0 | 1 | 2, ou null se absteve neste eixo. */
  score: 0 | 1 | 2 | null
  note?: string
}

export type JudgeResult = {
  abstained: boolean
  abstainReason?: string
  scores: JudgeScore[]
  /** Média dos eixos com nota (null se absteve tudo). */
  mean: number | null
  rawText: string
  model: string
  latencyMs: number
  inputTokens: number
  outputTokens: number
  parseOk: boolean
}

const AXES: QAxis[] = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6']

const RUBRIC = `És um juiz de qualidade de diálogo de atendimento (clínica de estética, WhatsApp).
Pontua cada eixo de 0 a 2, ou usa null se não tiveres evidência suficiente (abstenção por eixo).
Podes abster-te de toda a avaliação (abstained: true) se o texto for demasiado curto, ambíguo ou se faltar contexto.

Eixos (plano §4.3):
- Q1 Responde ao que foi pedido: 0 ignora/desvia; 1 parcial; 2 directo à última intenção
- Q2 Clareza: 0 ambíguo; 1 compreensível com esforço; 2 claro numa leitura
- Q3 Tom: 0 frio/robótico/excessivo; 1 adequado com deslizes; 2 caloroso, profissional, ≤1 emoji
- Q4 Continuidade: 0 re-cumprimenta ou ignora histórico; 1 pequena quebra; 2 continua naturalmente
- Q5 Próximo passo: 0 sem saída; 1 vaga; 2 uma acção clara
- Q6 Respeito: 0 pressiona ou contraria a vontade; 1 neutro; 2 acolhe a decisão e o tempo

NÃO julgues preço, agenda nem autorização de marcação — isso é das invariantes.
Responde SÓ com JSON:
{"abstained":false,"abstainReason":null,"scores":{"Q1":2,"Q2":2,"Q3":1,"Q4":2,"Q5":2,"Q6":2},"notes":{"Q1":"…"}}
`

export type JudgeInput = {
  caseId: string
  clientTurns: string[]
  agentOutbound: string[]
  /** Contexto mínimo (persona L3, etc.). */
  note?: string
}

function emptyScores(reason: string): JudgeScore[] {
  return AXES.map((axis) => ({ axis, score: null, note: reason }))
}

function parseJudgeJson(text: string): {
  abstained: boolean
  abstainReason?: string
  scores: JudgeScore[]
  parseOk: boolean
} {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) {
    return { abstained: true, abstainReason: 'JSON ilegível', scores: emptyScores('parse'), parseOk: false }
  }
  try {
    const raw = JSON.parse(text.slice(start, end + 1)) as {
      abstained?: boolean
      abstainReason?: string | null
      scores?: Record<string, number | null>
      notes?: Record<string, string>
    }
    if (raw.abstained === true) {
      return {
        abstained: true,
        abstainReason: raw.abstainReason ?? 'absteve',
        scores: emptyScores(raw.abstainReason ?? 'absteve'),
        parseOk: true,
      }
    }
    const scores: JudgeScore[] = AXES.map((axis) => {
      const v = raw.scores?.[axis]
      const score = v === 0 || v === 1 || v === 2 ? v : null
      return { axis, score, note: raw.notes?.[axis] }
    })
    return {
      abstained: scores.every((s) => s.score == null),
      abstainReason: scores.every((s) => s.score == null) ? 'todos os eixos null' : undefined,
      scores,
      parseOk: true,
    }
  } catch {
    return { abstained: true, abstainReason: 'JSON inválido', scores: emptyScores('parse'), parseOk: false }
  }
}

export async function runJudge(opts: {
  adapter: AiProviderAdapter
  ledger: CostLedger
  input: JudgeInput
  model?: string
  /** Dry-run: devolve notas fixas sem chamar o modelo. */
  dryRun?: boolean
}): Promise<JudgeResult> {
  if (opts.dryRun) {
    const scores: JudgeScore[] = AXES.map((axis) => ({ axis, score: 2 as const, note: 'dry-run' }))
    return {
      abstained: false,
      scores,
      mean: 2,
      rawText: '{"dryRun":true}',
      model: 'dry-run',
      latencyMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      parseOk: true,
    }
  }

  const tracker = new TrackingAiAdapter(opts.adapter, opts.ledger, { role: 'judge' })
  tracker.setContext({ caseId: opts.input.caseId, role: 'judge' })

  const userContent = [
    `Caso: ${opts.input.caseId}`,
    opts.input.note ? `Nota: ${opts.input.note}` : null,
    'Mensagens da cliente:',
    ...opts.input.clientTurns.map((t, i) => `C${i + 1}: ${t}`),
    'Respostas do agente:',
    ...opts.input.agentOutbound.map((t, i) => `A${i + 1}: ${t}`),
  ]
    .filter(Boolean)
    .join('\n')

  const gen = await tracker.generate({
    kind: 'reply',
    model: opts.model ?? AI_MODEL_AUTODRAFT,
    temperature: AI_REPLY_TEMPERATURE,
    maxOutputTokens: AI_MAX_OUTPUT_TOKENS_REPLY,
    timeoutMs: 25_000,
    warnings: [],
    servicesWithoutPrice: [],
    servicesWithoutExplanation: [],
    explanationSources: [],
    context: {
      contactFirstName: null,
      stage: null,
      services: [],
      messages: [
        { direction: 'system', body: RUBRIC },
        { direction: 'inbound', body: userContent },
      ],
      hasClinicOutbound: false,
      clinicOutboundCount: 0,
    },
  })

  if (!gen.ok) {
    return {
      abstained: true,
      abstainReason: gen.message,
      scores: emptyScores(gen.message),
      mean: null,
      rawText: '',
      model: gen.model,
      latencyMs: gen.latencyMs,
      inputTokens: 0,
      outputTokens: 0,
      parseOk: false,
    }
  }

  // O adaptador de produto espera JSON {mensagem}; o juiz usa texto livre.
  // Se vier envelopado, extrai a mensagem.
  let text = gen.text
  try {
    const wrapped = JSON.parse(text) as { mensagem?: string }
    if (typeof wrapped.mensagem === 'string') text = wrapped.mensagem
  } catch {
    /* texto cru do juiz */
  }

  const parsed = parseJudgeJson(text)
  const numbered = parsed.scores.map((s) => s.score).filter((n): n is 0 | 1 | 2 => n != null)
  const mean = numbered.length
    ? numbered.reduce<number>((a, b) => a + b, 0) / numbered.length
    : null

  return {
    abstained: parsed.abstained,
    abstainReason: parsed.abstainReason,
    scores: parsed.scores,
    mean,
    rawText: text,
    model: gen.model,
    latencyMs: gen.latencyMs,
    inputTokens: gen.inputTokens ?? 0,
    outputTokens: gen.outputTokens ?? 0,
    parseOk: parsed.parseOk,
  }
}

/**
 * κ de Cohen (ordinal simplificado: trata scores como categorias).
 * Usado na calibração juiz↔humano (#402). Amostra vazia → null.
 */
export function cohenKappa(
  a: Array<0 | 1 | 2 | null>,
  b: Array<0 | 1 | 2 | null>,
): number | null {
  if (a.length === 0 || a.length !== b.length) return null
  const pairs: Array<[number, number]> = []
  for (let i = 0; i < a.length; i++) {
    if (a[i] == null || b[i] == null) continue
    pairs.push([a[i]!, b[i]!])
  }
  if (pairs.length === 0) return null
  const cats = [0, 1, 2]
  const n = pairs.length
  let agree = 0
  const row: Record<number, number> = { 0: 0, 1: 0, 2: 0 }
  const col: Record<number, number> = { 0: 0, 1: 0, 2: 0 }
  for (const [x, y] of pairs) {
    if (x === y) agree += 1
    row[x] = (row[x] ?? 0) + 1
    col[y] = (col[y] ?? 0) + 1
  }
  const po = agree / n
  let pe = 0
  for (const c of cats) pe += ((row[c] ?? 0) / n) * ((col[c] ?? 0) / n)
  if (pe === 1) return 1
  return (po - pe) / (1 - pe)
}
