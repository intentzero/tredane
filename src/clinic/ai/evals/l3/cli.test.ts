/**
 * Entrada CLI da bateria L3 (DEC-126, teto próprio US$ 10).
 *   npm run eval:l3
 *   EVAL_L3_MODE=live npm run eval:l3
 */
import { describe, expect, it } from 'vitest'
import { buildAiAdapter, missingGatewayKeys, resolveAiMode } from '../../../../ai'
import { formatL3Report, runL3Suite } from './runner'
import { L3_PERSONA_IDS } from './personas'

const MODE = (process.env.EVAL_L3_MODE ?? 'dry-run').toLowerCase() === 'live' ? 'live' : 'dry-run'
const FULL = process.env.EVAL_L3_FULL === '1'

describe(`eval L3 (${MODE})`, () => {
  it(
    FULL || MODE === 'live' ? 'bateria L3 personas' : 'amostra dry-run (EVAL_L3_FULL=1 = P-01..P-10)',
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
        if (missing.length > 0 || resolveAiMode(process.env.AI_MODE ?? 'gateway') !== 'gateway') {
          process.stdout.write(
            `\nL3 LIVE bloqueada (faltam ${missing.join(', ') || 'AI_MODE=gateway'}). Follow-up com credenciais; DEC-126.\n`,
          )
          expect(true).toBe(true)
          return
        }
        adapter = buildAiAdapter({ mode: 'gateway', gateway })
      }

      const report = await runL3Suite({
        mode: MODE,
        adapter,
        personaIds: FULL || MODE === 'live' ? L3_PERSONA_IDS : ['P-01', 'P-06', 'P-10'],
        withJudge: process.env.EVAL_L3_JUDGE !== '0',
      })
      process.stdout.write(`\n${formatL3Report(report)}\n`)
      if (MODE === 'dry-run') expect(report.complete || report.truncated).toBe(true)
    },
    MODE === 'live' ? 600_000 : 120_000,
  )
})
