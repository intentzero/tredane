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
import { INTENT_CORPUS, type IntentLabel } from './corpus'
import { classifyIntentWithLlm } from './llm-classifier'

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
        let spent = 0
        let undecided = 0
        let rescuedAgenda = 0
        let falseAgenda = 0
        let invalid = 0
        let agendaTotal = 0
        let lexAgendaHit = 0
        let infoTotal = 0
        for (const sample of INTENT_CORPUS) {
          const hasUpcoming = sample.upcoming ?? (sample.label === 'remarcar' || sample.label === 'cancelar')
          const lex = routeToClientWeb({ text: sample.text, services, hasUpcoming })
          const expectedAgenda = sample.label !== 'nenhum'
          if (expectedAgenda) agendaTotal += 1
          else infoTotal += 1
          if (lex) {
            if (expectedAgenda) lexAgendaHit += 1
            continue
          }
          undecided += 1
          if (spent >= CEILING_USD) break
          const out = await classifyIntentWithLlm(adapter, sample.text)
          if (out.model && out.inputTokens != null && out.outputTokens != null) {
            spent += costUsd({ model: out.model, inputTokens: out.inputTokens, outputTokens: out.outputTokens })
          }
          if (!out.result) {
            invalid += 1
            continue
          }
          const predictedAgenda: boolean = out.result.label !== ('nenhum' as IntentLabel)
          if (expectedAgenda && predictedAgenda) rescuedAgenda += 1
          if (!expectedAgenda && predictedAgenda) falseAgenda += 1
        }
        const lines = [
          '',
          `Intenção LLM (só nas ${undecided} frases sem decisão do léxico), custo ≈ US$ ${spent.toFixed(3)}`,
          `  léxico: «há intenção de agenda» em ${lexAgendaHit}/${agendaTotal}`,
          `  LLM recupera mais:                ${rescuedAgenda}`,
          `  recall combinado:                  ${(((lexAgendaHit + rescuedAgenda) / agendaTotal) * 100).toFixed(0)}%`,
          `  informação tratada como agenda:    ${falseAgenda}/${infoTotal}`,
          `  saídas inválidas:                  ${invalid}`,
        ]
        process.stdout.write(lines.join('\n') + '\n')
        // Relatório para o resumo do job do GitHub (workflow eval-intent).
        mkdirSync('.eval', { recursive: true })
        writeFileSync('.eval/intent-llm.md', ['### Intenção por LLM (DEC-202)', '', '```', ...lines.slice(1), '```', ''].join('\n'))
        expect(spent).toBeLessThanOrEqual(CEILING_USD + 0.5)
      } finally {
        s.close()
      }
    },
    600_000,
  )
})
