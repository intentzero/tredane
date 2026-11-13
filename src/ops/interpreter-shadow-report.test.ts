/**
 * Script que resume os eventos `ai.interpreter_shadow`. Só texto; não toca em rede nem no modelo.
 */
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error — script .mjs sem tipos
import { extractShadowEvents, renderShadowReport, summariseShadowEvents } from '../../scripts/interpreter-shadow-report.mjs'

const root = resolve(__dirname, '../..')

const FIELDS_NONE = { service: 'none', variants: 'none', line: 'none', professional: 'none', date: 'none', period: 'none', time: 'none', option: 'none' }

function event(over: Record<string, unknown> = {}) {
  return {
    level: 'info',
    event: 'ai.interpreter_shadow',
    tenantId: 'clinic-demo-a',
    conversationId: 'cnv_1',
    messageId: 'msg_1',
    status: 'ok',
    mainModelCalled: false,
    reusedMainCall: false,
    pendingSlot: null,
    ruleCoverage: 0.3,
    ruleActs: ['marcar'],
    llmActs: ['marcar'],
    fields: { ...FIELDS_NONE, service: 'agree', period: 'llm_only' },
    diverged: true,
    llmOnly: ['period'],
    differ: [],
    strictDiscarded: ['period'],
    relaxedRejected: [],
    model: 'claude-haiku-5-5',
    latencyMs: 1200,
    inputTokens: 650,
    outputTokens: 110,
    ...over,
  }
}

describe('extractShadowEvents', () => {
  it('lê uma linha JSON por evento', () => {
    const text = [JSON.stringify(event()), JSON.stringify(event({ messageId: 'msg_2' }))].join('\n')
    expect(extractShadowEvents(text)).toHaveLength(2)
  })

  it('lê o formato do wrangler tail (evento como string em logs[].message)', () => {
    const wrapped = { outcome: 'ok', logs: [{ level: 'info', message: [JSON.stringify(event())], timestamp: 1 }] }
    const text = `Successfully created tail\n${JSON.stringify(wrapped)}\n`
    const found = extractShadowEvents(text)
    expect(found).toHaveLength(1)
    expect(found[0].event).toBe('ai.interpreter_shadow')
  })

  it('ignora outros eventos e linhas que não são JSON, e deduplica', () => {
    const other = { logs: [{ message: [JSON.stringify({ event: 'ai.turn_decided', route: 'model' })] }] }
    const text = ['cabeçalho qualquer', JSON.stringify(other), JSON.stringify(event()), JSON.stringify(event())].join('\n')
    expect(extractShadowEvents(text)).toHaveLength(1)
  })
})

describe('summariseShadowEvents / renderShadowReport', () => {
  it('conta veredictos por campo, validação, latência e custo', () => {
    const events = [
      event(),
      event({ messageId: 'msg_2', fields: { ...FIELDS_NONE, line: 'differ' }, llmOnly: [], differ: ['line'], strictDiscarded: [], relaxedRejected: ['date'] }),
      event({ messageId: 'msg_3', status: 'provider', fields: undefined, diverged: undefined }),
      event({ messageId: 'msg_4', reusedMainCall: true, mainModelCalled: true, latencyMs: 300 }),
    ]
    const s = summariseShadowEvents(events, { sample: 5 })
    expect(s.total).toBe(4)
    expect(s.byStatus).toEqual({ ok: 3, provider: 1 })
    expect(s.compared).toBe(3)
    expect(s.diverged).toBe(3)
    expect(s.fields.period.llm_only).toBe(2)
    expect(s.fields.line.differ).toBe(1)
    expect(s.strictDiscarded).toEqual({ period: 2 })
    expect(s.relaxedRejected).toEqual({ date: 1 })
    expect(s.reusedMainCall).toBe(1)
    // A chamada reutilizada não conta como custo da sombra.
    expect(s.tokens.input).toBe(650 * 3)
    expect(s.latencyMs.n).toBe(4)
    expect(s.samples.differ).toEqual([{ conversationId: 'cnv_1', messageId: 'msg_2', fields: ['line'] }])
    const md = renderShadowReport(s)
    expect(md).toContain('Campo a campo')
    expect(md).toContain('Amostra para rotular')
  })

  it('sem eventos, explica o que verificar', () => {
    const md = renderShadowReport(summariseShadowEvents([]))
    expect(md).toContain('Nenhum evento')
    expect(md).toContain('AI_INTERPRETER_SHADOW=on')
  })

  it('o relatório não repete texto de conversa nem ids sem --sample', () => {
    const md = renderShadowReport(summariseShadowEvents([event()]))
    expect(md).not.toContain('cnv_1')
    expect(md).not.toContain('msg_1')
  })
})

describe('CLI', () => {
  it('lê stdin e imprime o relatório', () => {
    const r = spawnSync('node', [resolve(root, 'scripts/interpreter-shadow-report.mjs')], {
      cwd: root,
      input: JSON.stringify(event()),
      encoding: 'utf8',
    })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('Eventos: **1**')
  })

  it('--json devolve o resumo estruturado', () => {
    const r = spawnSync('node', [resolve(root, 'scripts/interpreter-shadow-report.mjs'), '--json'], {
      cwd: root,
      input: JSON.stringify(event()),
      encoding: 'utf8',
    })
    expect(r.status).toBe(0)
    expect(JSON.parse(r.stdout).total).toBe(1)
  })
})
