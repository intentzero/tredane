#!/usr/bin/env node
/**
 * STAGING-ONLY: cria/atualiza a «Clínica Bella Pele (demo)» (backlog item 3).
 * Idempotente — pode correr de novo (ex.: semana nova acrescenta a agenda).
 *
 *   DEMO_SEED_TOKEN=… node scripts/seed-demo-clinic.mjs <ownerClerkUserId> [baseUrl]
 *
 * O token é o secret `DEMO_SEED_TOKEN` do Worker de staging (nunca imprimir).
 * Contatos fictícios (DDD 00) e envio WhatsApp bloqueado para o tenant demo.
 */
const owner = process.argv[2]
const base = process.argv[3] ?? 'https://staging.app.tredane.com'
const token = process.env.DEMO_SEED_TOKEN
if (!owner || !token) {
  console.error('uso: DEMO_SEED_TOKEN=… node scripts/seed-demo-clinic.mjs <ownerClerkUserId> [baseUrl]')
  process.exit(1)
}
if (/production|app\.tredane\.com$/.test(new URL(base).host) && !/staging/.test(base)) {
  console.error('recusado: só staging')
  process.exit(1)
}
const res = await fetch(`${base}/api/ops/demo-clinic/seed`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ ownerClerkUserId: owner }),
})
const text = await res.text()
console.log(res.status, text)
if (!res.ok) process.exit(1)
