/**
 * Medição do classificador por LLM sobre o corpus (DEC-202, plano de 18/11/2026). Só corre com
 *   EVAL_INTENT_LLM=live npm run eval:intent
 * e exige CF_ACCOUNT_ID, AI_GATEWAY_ID e AI_GATEWAY_TOKEN. Sem isso, não gasta nada e não falha.
 * Corre o LLM **só** nas frases que o léxico não decide, como faria em produção.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildAiAdapter, missingGatewayKeys } from '../../../../ai'
import { routeToClientWeb } from '../../../../clientweb/route-intent'
import { listServices } from '../../../config/services'
import { costUsd } from '../l2/cost'
import { bootDialogScenario } from '../dialogs/scenario'
import { AGENDA_INTENT_LABELS, INTENT_CORPUS, type IntentLabel } from './corpus'
import { classifyIntentWithLlm } from './llm-classifier'

const LABELS: IntentLabel[] = [
  'agendar',
  'remarcar',
  'cancelar',
  'misto',
  'price',
  'team',
  'faq_catalog',
  'nenhum',
]

function isAgendaLabel(label: IntentLabel): boolean {
  return AGENDA_INTENT_LABELS.includes(label)
}

const LIVE = (process.env.EVAL_INTENT_LLM ?? '').toLowerCase() === 'live'
const CEILING_USD = 2

describe(`intenção por LLM (${LIVE ? 'live' : 'sem execução'})`, () => {
  it(
    'mede o ganho sobre o léxico nas frases que o léxico não decide',
    async () => {
      if (!LIVE) {
        process.stdout.write('\nIntenção LLM: sem execução (defina EVAL_INTENT_LLM=live). Nada foi gasto.\n')
        return
      }
      const gateway = {
        accountId: process.env.CF_ACCOUNT_ID ?? '',
        gatewayId: process.env.AI_GATEWAY_ID ?? '',
        gatewayToken: process.env.AI_GATEWAY_TOKEN ?? '',
        anthropicApiKey: process.env.ANTHROPIC_API_KEY,
        ...(process.env.AI_GATEWAY_BYOK_ALIAS ? { byokAlias: process.env.AI_GATEWAY_BYOK_ALIAS } : {}),
      }
      const missing = missingGatewayKeys(gateway)
      if (missing.length > 0) {
        process.stdout.write(`\nIntenção LLM bloqueada: segredos em falta (${missing.join(', ')}).\n`)
        expect(missing.length).toBeGreaterThan(0)
        return
      }
      const adapter = buildAiAdapter({ mode: 'gateway', gateway })
      const s = bootDialogScenario({})
      try {
        const services = listServices(s.db, s.tenantId).filter((x) => x.active)
        const confusion = new Map<string, number>()
        const wrong: string[] = []
        let spent = 0
        let undecided = 0
        let rescuedAgenda = 0
        let falseAgenda = 0
        let invalid = 0
        let agendaTotal = 0
        let lexAgendaHit = 0
        let infoTotal = 0
        let infoFalseLlm = 0
        let infoUndecided = 0
        for (const sample of INTENT_CORPUS) {
          const hasUpcoming = sample.upcoming ?? (sample.label === 'remarcar' || sample.label === 'cancelar')
          const lex = routeToClientWeb({ text: sample.text, services, hasUpcoming })
          const expectedAgenda = isAgendaLabel(sample.label)
          if (expectedAgenda) agendaTotal += 1
          else infoTotal += 1
          let combined: IntentLabel
          if (lex) {
            if (expectedAgenda) lexAgendaHit += 1
            combined =
              lex.purpose === 'remarcar' ? 'remarcar' : lex.purpose === 'cancelar' ? 'cancelar' : lex.mixed ? 'misto' : 'agendar'
          } else {
            undecided += 1
            if (!expectedAgenda) infoUndecided += 1
            if (spent >= CEILING_USD) break
            const out = await classifyIntentWithLlm(adapter, sample.text)
            if (out.model && out.inputTokens != null && out.outputTokens != null) {
              spent += costUsd({ model: out.model, inputTokens: out.inputTokens, outputTokens: out.outputTokens })
            }
            if (!out.result) {
              invalid += 1
              combined = 'nenhum'
            } else {
              combined = out.result.label
              const predictedAgenda = isAgendaLabel(combined)
              if (expectedAgenda && predictedAgenda) rescuedAgenda += 1
              if (!expectedAgenda && predictedAgenda) {
                falseAgenda += 1
                infoFalseLlm += 1
              }
            }
          }
          confusion.set(`${sample.label}>${combined}`, (confusion.get(`${sample.label}>${combined}`) ?? 0) + 1)
          if (combined !== sample.label) wrong.push(`[${lex ? 'léxico' : 'LLM'}] «${sample.text}» → ${combined} (esperado ${sample.label})`)
        }
        const classLines = LABELS.map((label) => {
          const tp = confusion.get(`${label}>${label}`) ?? 0
          const predicted = LABELS.reduce((n, l) => n + (confusion.get(`${l}>${label}`) ?? 0), 0)
          const actual = LABELS.reduce((n, l) => n + (confusion.get(`${label}>${l}`) ?? 0), 0)
          const p = predicted ? ((100 * tp) / predicted).toFixed(0) : '—'
          const r = actual ? ((100 * tp) / actual).toFixed(0) : '—'
          return `    ${label.padEnd(9)} precisão ${p}%  recall ${r}%  (n=${actual})`
        })
        const matrix = [
          '    esperado\\obtido ' + LABELS.map((l) => l.padEnd(8)).join(' '),
          ...LABELS.map(
            (a) => `    ${a.padEnd(15)} ` + LABELS.map((b) => String(confusion.get(`${a}>${b}`) ?? 0).padEnd(8)).join(' '),
          ),
        ]
        const lines = [
          '',
          `Intenção LLM (só nas ${undecided} frases sem decisão do léxico), custo ≈ US$ ${spent.toFixed(3)}`,
          `  léxico: «há intenção de agenda» em ${lexAgendaHit}/${agendaTotal}`,
          `  LLM recupera mais:                ${rescuedAgenda}`,
          `  recall combinado (agenda sim/não): ${(((lexAgendaHit + rescuedAgenda) / agendaTotal) * 100).toFixed(0)}%`,
          `  informação tratada como agenda:    ${falseAgenda}/${infoTotal} (LLM: ${infoFalseLlm}/${infoUndecided} frases de informação que lhe chegaram)`,
          `  saídas inválidas:                  ${invalid}`,
          '  Sistema combinado, por classe:',
          ...classLines,
          '  Matriz de confusão:',
          ...matrix,
          '  Erros de classe ou de intenção:',
          ...(wrong.length ? wrong.map((w) => `    ${w}`) : ['    nenhum']),
        ]
        process.stdout.write(lines.join('\n') + '\n')
        // Relatório para o resumo do job do GitHub (workflow eval-intent).
        mkdirSync('.eval', { recursive: true })
        writeFileSync('.eval/intent-llm.md', ['### Intenção por LLM (DEC-221)', '', '```', ...lines.slice(1), '```', ''].join('\n'))
        expect(spent).toBeLessThanOrEqual(CEILING_USD + 0.5)
      } finally {
        s.close()
      }
    },
    600_000,
  )
})
