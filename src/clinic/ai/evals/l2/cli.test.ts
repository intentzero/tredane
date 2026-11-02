/**
 * Entrada CLI da bateria L2.
 *   npm run eval:l2              → dry-run (CI / sem chaves)
 *   EVAL_L2_MODE=live npm run eval:l2  → gateway (exige CF_ACCOUNT_ID, AI_GATEWAY_ID, AI_GATEWAY_TOKEN)
 *
 * DEC-117: teto US$ 10; truncada ≠ completa.
 */
import { execSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { buildAiAdapter, missingGatewayKeys, resolveAiMode } from '../../../../ai'
import { formatL2Report, runL2Suite } from './runner'
import { partitionL2Cases } from './held-out'

const MODE = (process.env.EVAL_L2_MODE ?? 'dry-run').toLowerCase() === 'live' ? 'live' : 'dry-run'
const FULL = process.env.EVAL_L2_FULL === '1'

function gitCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

describe(`eval L2 (${MODE})`, () => {
  it(
    FULL || MODE === 'live' ? 'bateria L2' : 'amostra dry-run (defina EVAL_L2_FULL=1 para a matriz toda)',
    async () => {
      let adapter = undefined as ReturnType<typeof buildAiAdapter> | undefined
      if (MODE === 'live') {
        const gateway = {
          accountId: process.env.CF_ACCOUNT_ID ?? '',
          gatewayId: process.env.AI_GATEWAY_ID ?? '',
          gatewayToken: process.env.AI_GATEWAY_TOKEN ?? '',
          anthropicApiKey: process.env.ANTHROPIC_API_KEY,
        }
        const missing = missingGatewayKeys(gateway)
        const modeOk = resolveAiMode(process.env.AI_MODE ?? 'gateway') === 'gateway'
        if (missing.length > 0 || !modeOk) {
          const why = [
            missing.length ? `segredos em falta: ${missing.join(', ')}` : null,
            !modeOk ? 'AI_MODE≠gateway' : null,
          ]
            .filter(Boolean)
            .join('; ')
          process.stdout.write(
            `\nL2 LIVE bloqueada (${why}). Harness + dry-run entregues; sem gasto de tokens. Ver DEC-117.\n`,
          )
          // Não falha o CI: o bloqueio é de ambiente, não do harness.
          expect(why.length).toBeGreaterThan(0)
          return
        }
        adapter = buildAiAdapter({ mode: 'gateway', gateway })
      }

      const partition = partitionL2Cases()
      const caseIds = FULL || MODE === 'live' ? undefined : partition.tune.slice(0, 5)

      const report = await runL2Suite({
        mode: MODE,
        adapter,
        n: Number(process.env.EVAL_L2_N ?? 3),
        caseIds,
        commit: gitCommit(),
        withJudge: process.env.EVAL_L2_JUDGE !== '0',
      })

      process.stdout.write(`\n${formatL2Report(report)}\n`)
      // Dry-run amostra deve completar; live pode truncar (DEC-117) — nunca falhar o CI por truncagem.
      if (MODE === 'dry-run') {
        expect(report.complete || report.truncated).toBe(true)
      }
      if (report.complete) {
        expect(report.budget.spentUsd).toBeLessThanOrEqual(report.budget.ceilingUsd)
      }
    },
    FULL || MODE === 'live' ? 600_000 : 180_000,
  )
})
