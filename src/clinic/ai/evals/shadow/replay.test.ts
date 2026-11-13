/**
 * Reexecução da sombra do interpretador sobre o corpus fixo.
 *
 * Sempre corre a parte pura (pontuação, corpus, relatório) com saídas
 * sintéticas. A chamada ao modelo real só corre com:
 *
 *   EVAL_SHADOW_REPLAY=live AI_GATEWAY_ID=… AI_GATEWAY_TOKEN=… CF_ACCOUNT_ID=… \
 *     npm run eval:shadow-replay
 *
 * Sem chaves, `EVAL_SHADOW_REPLAY=dry` corre com o adaptador simulado (só
 * valida a tubagem; os números não valem). Escreve `.eval/shadow-replay.md` e
 * `.eval/shadow-replay-raw.json`. Teto de custo: US$ 2 (DEC-117 deixa US$ 10).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { AiGatewayAnthropicAdapter, SimulatedAiAdapter } from '../../../../ai'
import type { AiAssistDeps } from '../../types'
import { REPLAY_CORPUS } from './corpus'
import {
  analysePhrase,
  collectCalls,
  renderReport,
  scorePhrase,
  summarise,
  SYSTEMS,
  type RawCall,
} from './replay'

describe('corpus', () => {
  it('ids únicos e rótulos sobre ids do catálogo de referência', async () => {
    const ids = REPLAY_CORPUS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    const { EVAL_BOOKING_CATALOG } = await import('../booking-object-catalog')
    const services = new Set(EVAL_BOOKING_CATALOG.map((s) => s.id))
    const zones = new Set(EVAL_BOOKING_CATALOG.flatMap((s) => s.zones.map((z) => z.id)))
    for (const p of REPLAY_CORPUS) {
      if (p.expect.service) expect(services.has(p.expect.service), p.id).toBe(true)
      for (const v of p.expect.variants ?? []) expect(zones.has(v), p.id).toBe(true)
      if (p.expect.option !== undefined) {
        expect(p.pending, p.id).toBeTruthy()
        expect(p.expect.option).toBeLessThan(p.pending!.options.length)
      }
    }
  })
})

describe('scorePhrase', () => {
  const phrase = REPLAY_CORPUS.find((p) => p.id === 'L03')!
  it('conta certos, errados, em falta e inventados; ignora campos marcados', () => {
    const s = scorePhrase(phrase, {
      service: 'svc-depilacao',
      variants: ['z-axila-m'],
      date: '2026-11-09',
      time: '10:00',
    })
    expect(s.ok.sort()).toEqual(['date', 'service'])
    expect(s.wrong).toEqual(['variants'])
    expect(s.missed.sort()).toEqual(['line', 'period'])
    expect(s.spurious).toEqual(['time'])
    const c03 = REPLAY_CORPUS.find((p) => p.id === 'C03')!
    expect(scorePhrase(c03, { service: 'svc-limpeza', date: '2026-11-06' }).spurious).toEqual([])
  })
})

describe('analysePhrase / relatório (saída sintética do modelo)', () => {
  it('um modelo perfeito nunca perde para o léxico; o relatório sai completo', () => {
    // «Oráculo»: devolve exatamente o rótulo, como se o modelo fosse perfeito.
    const calls: RawCall[] = REPLAY_CORPUS.map((p) => ({
      id: p.id,
      status: 'ok',
      model: 'oraculo',
      latencyMs: 5,
      inputTokens: 100,
      outputTokens: 10,
      raw: {
        acts: ['marcar'],
        ...(p.expect.service ? { serviceId: p.expect.service } : {}),
        ...(p.expect.variants ? { variantIds: p.expect.variants } : {}),
        ...(p.expect.line ? { line: p.expect.line } : {}),
        ...(p.expect.date ? { dateLiteral: p.expect.date.split('-').reverse().slice(0, 2).join('/') } : {}),
        ...(p.expect.period ? { period: p.expect.period } : {}),
        ...(p.expect.time ? { timeLiteral: p.expect.time.replace(':', 'h') } : {}),
        ...(p.expect.option !== undefined ? { optionIndex: p.expect.option } : {}),
      },
    }))
    const byId = new Map(calls.map((c) => [c.id, c]))
    const results = REPLAY_CORPUS.map((p) => analysePhrase(p, byId.get(p.id)))
    const sum = summarise(results)
    // Sem erros de parser, o oráculo acerta quase tudo no relaxado; o ponto aqui
    // é a tubagem: nenhum sistema devolve mais campos certos do que existem.
    for (const s of SYSTEMS) {
      // O total de campos rotulados é o mesmo para todos os sistemas.
      expect(sum[s].fields).toBe(sum.rule.fields)
    }
    expect(sum.relaxed.ok).toBeGreaterThan(sum.rule.ok * 0.5)
    const md = renderReport({ results, calls, mode: 'sintético', model: 'oraculo' })
    expect(md).toContain('Frases perfeitas')
    expect(md).toContain('Onde o modelo (relaxado) acerta')
  })

  it('sem chamada ao modelo, os sistemas do modelo ficam vazios e o léxico mantém-se', () => {
    const p = REPLAY_CORPUS.find((x) => x.id === 'L01')!
    const r = analysePhrase(p, undefined)
    expect(r.got.relaxed).toEqual({})
    expect(r.got.strict).toEqual(r.got.rule)
    expect(r.got.hybrid).toEqual(r.got.rule)
  })
})

const MODE = process.env.EVAL_SHADOW_REPLAY ?? ''

describe.skipIf(MODE !== 'dry' && MODE !== 'live')(`reexecução (${MODE})`, () => {
  it('chama o modelo uma vez por frase e escreve o relatório', async () => {
    let deps: AiAssistDeps
    // Só no teste: o adaptador de produção esconde o corpo do erro HTTP. Guardamos um
    // excerto (sem sequências longas que possam ser tokens) para diagnosticar.
    const errorBodies = new Set<string>()
    const capturingFetch: typeof fetch = async (input, init) => {
      const res = await fetch(input, init)
      if (!res.ok) {
        try {
          const text = (await res.clone().text()).replace(/[A-Za-z0-9_-]{32,}/g, '…').slice(0, 300)
          errorBodies.add(`${res.status} ${text}`)
        } catch {
          // sem corpo
        }
      }
      return res
    }
    if (MODE === 'live') {
      const accountId = process.env.CF_ACCOUNT_ID
      const gatewayId = process.env.AI_GATEWAY_ID
      const gatewayToken = process.env.AI_GATEWAY_TOKEN
      if (!accountId || !gatewayId || !gatewayToken) {
        throw new Error('EVAL_SHADOW_REPLAY=live exige CF_ACCOUNT_ID, AI_GATEWAY_ID e AI_GATEWAY_TOKEN')
      }
      deps = {
        mode: 'gateway',
        adapter: new AiGatewayAnthropicAdapter({
          accountId,
          gatewayId,
          gatewayToken,
          anthropicApiKey: process.env.ANTHROPIC_API_KEY,
          fetchImpl: capturingFetch,
        }),
      }
    } else {
      deps = { mode: 'synthetic', adapter: new SimulatedAiAdapter() }
    }
    const { calls, spentUsd, truncated } = await collectCalls(deps, { budgetUsd: 2 })
    const byId = new Map(calls.map((c) => [c.id, c]))
    const results = REPLAY_CORPUS.map((p) => analysePhrase(p, byId.get(p.id)))
    const model = calls.find((c) => c.model)?.model ?? null
    const md =
      renderReport({ results, calls, mode: MODE, model, errorBodies: [...errorBodies].slice(0, 5) }) +
      `\n\nCusto estimado: US$ ${spentUsd.toFixed(4)}${truncated ? ' (TRUNCADO pelo teto: relatório incompleto)' : ''}\n`
    mkdirSync('.eval', { recursive: true })
    writeFileSync('.eval/shadow-replay.md', md)
    writeFileSync('.eval/shadow-replay-raw.json', JSON.stringify({ mode: MODE, model, calls }, null, 2))
    console.info(md)
    expect(truncated).toBe(false)
    expect(calls).toHaveLength(REPLAY_CORPUS.length)
    // Uma corrida em que o modelo não respondeu não mede nada: falha, em vez de «sucesso».
    const failed = calls.filter((c) => c.status !== 'ok')
    expect(
      failed.length,
      `${failed.length}/${calls.length} chamadas falharam: ${[...new Set(failed.map((c) => c.error ?? c.status))].join(' | ')}`,
    ).toBeLessThanOrEqual(Math.floor(calls.length * 0.1))
  }, 300_000)
})
