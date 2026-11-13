/**
 * Mede o funil real sobre o corpus fixo e compara com o `interpretTurn` e com o
 * modelo (saída bruta de uma corrida anterior, opcional).
 *
 *   EVAL_FUNNEL=1 [EVAL_FUNNEL_RAW=.eval/shadow-replay-raw.json] npm run eval:funnel
 *
 * Escreve `.eval/funnel-replay.md`. Sem custo: o funil corre com o adaptador simulado.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { REPLAY_CORPUS } from './corpus'
import { analysePhrase, SYSTEMS, summarise, type RawCall } from './replay'
import { readFunnel, scoreFunnel, type FunnelRead } from './funnel'

const ENABLED = process.env.EVAL_FUNNEL === '1'
const pct = (n: number, d: number) => (d === 0 ? '—' : `${Math.round((n / d) * 100)} %`)

describe.skipIf(!ENABLED)('funil real sobre o corpus', () => {
  it(
    'mede o quadro depois de uma mensagem e escreve o relatório',
    async () => {
      const phrases = REPLAY_CORPUS.filter((p) => !p.pending)
      const reads = new Map<string, FunnelRead>()
      for (const p of phrases) reads.set(p.id, await readFunnel(p))
      const funnel = scoreFunnel(phrases, reads)

      const rawPath = process.env.EVAL_FUNNEL_RAW ?? '.eval/shadow-replay-raw.json'
      const calls: RawCall[] = existsSync(rawPath)
        ? (JSON.parse(readFileSync(rawPath, 'utf8')) as { calls: RawCall[] }).calls
        : []
      const byId = new Map(calls.map((c) => [c.id, c]))
      const others = phrases.map((p) => analysePhrase(p, byId.get(p.id)))
      const sum = summarise(others)

      const row = (name: string, x: { phrases: number; perfect: number; fields: number; ok: number; wrong: number; missed: number; spurious: number }) =>
        `| ${name} | ${x.perfect}/${x.phrases} (${pct(x.perfect, x.phrases)}) | ${x.ok}/${x.fields} (${pct(x.ok, x.fields)}) | ${x.wrong} | ${x.missed} | ${x.spurious} |`
      const lines = [
        '# Funil real sobre o corpus fixo',
        '',
        `Frases: ${phrases.length} (sem as ${REPLAY_CORPUS.length - phrases.length} que dependem de pergunta pendente) · funil sem modelo (adaptador simulado)`,
        '',
        '| Sistema | Frases perfeitas | Campos certos | Errados | Em falta | Inventados |',
        '| --- | --- | --- | --- | --- | --- |',
        row('**funil real** (quadro gravado)', funnel.summary),
        row('interpretTurn (`rule`)', sum.rule),
        ...(calls.length > 0
          ? [row('modelo, só id (`relaxed`)', sum.relaxed), row('modelo, citação literal (`strict`)', sum.strict)]
          : []),
        '',
        `Sistemas disponíveis para a comparação: ${SYSTEMS.join(', ')}.`,
        '',
        '## Frases em que o funil falha',
        '',
      ]
      for (const r of funnel.perPhrase.filter((x) => x.wrong.length + x.missed.length + x.spurious.length > 0)) {
        const model = others.find((o) => o.id === r.id)
        lines.push(
          `- ${r.id} «${r.text}» — em falta: ${r.missed.join(',') || '—'}; errados: ${r.wrong.join(',') || '—'}; inventados: ${r.spurious.join(',') || '—'}; modelo ${calls.length > 0 ? (model?.perfect.relaxed ? 'acerta' : 'também falha') : 'n/d'}`,
        )
      }
      mkdirSync('.eval', { recursive: true })
      writeFileSync('.eval/funnel-replay.md', lines.join('\n'))
      writeFileSync('.eval/funnel-replay.json', JSON.stringify({ funnel: funnel.perPhrase, reads: [...reads] }, null, 2))
      console.info(lines.join('\n'))
      expect(funnel.summary.phrases).toBe(phrases.length)
    },
    300_000,
  )
})
