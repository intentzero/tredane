#!/usr/bin/env node
/**
 * DEC-143 (medida b): funil do WhatsApp Flow de agendamento lido do D1 remoto.
 *
 *   node scripts/flow-funnel.mjs staging <tenantId> [desde=YYYY-MM-DD]
 *
 * Usa a sessão do wrangler (`npx wrangler login`); só lê. TREDANE_D1_DRY_RUN=1 imprime o comando.
 *
 * Contagens por flow_token:
 *   enviados    — linhas criadas no período;
 *   abertos     — `opened_at` preenchido (a Meta chamou o endpoint: INIT ou data_exchange);
 *   concluidos  — `consumed_at` sem `replaced_by` (nfm_reply recebido);
 *   substituidos — reenviados antes de concluir (o token antigo também ganha `consumed_at`);
 *   expirados   — nem concluídos nem substituídos, já fora do prazo.
 *
 * `opened_at` só existe a partir da migração 0019: tokens anteriores contam como não abertos.
 *
 * As medidas a e c vêm dos Workers Logs do worker (filtros sugeridos no fim da saída):
 *   a) `ai.turn_decided` com `variantsChanged = true`; `pendingSlotBefore` separa
 *      zonas escritas sem pergunta (null / outro) de resposta à pergunta (`variantes`) e do Sim (`eco`);
 *   c) `whatsapp_flow.offer_skipped` (`reason`) e `whatsapp_flow.offer_failed`.
 */
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { D1_DATABASE_BY_ENV, D1_ENVS } from './d1-env.mjs'

const TENANT_RE = /^[A-Za-z0-9_-]{1,80}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** SQL do funil. Só aceita tenant e data já validados (sem interpolação livre). */
export function buildFlowFunnelSql(tenantId, sinceMs, nowMs) {
  if (!TENANT_RE.test(tenantId)) throw new Error(`tenantId inválido: ${tenantId}`)
  if (!Number.isSafeInteger(sinceMs) || !Number.isSafeInteger(nowMs)) {
    throw new Error('instantes inválidos')
  }
  return [
    'SELECT',
    '  count(*) AS enviados,',
    '  sum(opened_at IS NOT NULL) AS abertos,',
    '  sum(consumed_at IS NOT NULL AND replaced_by IS NULL) AS concluidos,',
    '  sum(replaced_by IS NOT NULL) AS substituidos,',
    `  sum(consumed_at IS NULL AND replaced_by IS NULL AND expires_at <= ${nowMs}) AS expirados`,
    'FROM whatsapp_flow_tokens',
    `WHERE tenant_id = '${tenantId}' AND created_at >= ${sinceMs}`,
  ].join(' ')
}

export function flowFunnelPlan(argv, nowMs = Date.now()) {
  const [target, tenantId, since] = argv
  if (!target || !D1_ENVS.includes(target)) return null
  if (!tenantId || !TENANT_RE.test(tenantId)) return null
  if (since && !DATE_RE.test(since)) return null
  const sinceMs = since ? Date.parse(`${since}T00:00:00Z`) : 0
  const database = D1_DATABASE_BY_ENV[target]
  return {
    database,
    args: [
      'wrangler',
      'd1',
      'execute',
      database,
      '--env',
      target,
      '--remote',
      '--command',
      buildFlowFunnelSql(tenantId, sinceMs, nowMs),
    ],
  }
}

const LOG_HINTS = [
  '',
  'Workers Logs do worker (painel Cloudflare → Workers → Observability), mesmo período:',
  '  a) event = ai.turn_decided AND tenantId = <tenant>: contar variantsChanged = true,',
  '     agrupado por pendingSlotBefore (null/outro = zonas escritas sem pergunta).',
  '  c) event = whatsapp_flow.offer_skipped (agrupar por reason) e event = whatsapp_flow.offer_failed.',
]

function main() {
  const plan = flowFunnelPlan(process.argv.slice(2))
  if (!plan) {
    console.error(
      `flow-funnel: uso: node scripts/flow-funnel.mjs <${D1_ENVS.join('|')}> <tenantId> [YYYY-MM-DD]`,
    )
    process.exit(1)
  }
  const cmdline = ['npx', ...plan.args]
  if (process.env.TREDANE_D1_DRY_RUN === '1') {
    console.log(cmdline.join(' '))
    return
  }
  const r = spawnSync(cmdline[0], cmdline.slice(1), { stdio: 'inherit', env: process.env })
  console.log(LOG_HINTS.join('\n'))
  process.exit(r.status ?? 1)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
