#!/usr/bin/env node
/**
 * Inventário de secrets/vars/bindings (#44) — só nomes, nunca valores.
 * Fonte espelhada de src/ops/secrets.ts (manter alinhado em revisões).
 */
const items = [
  { name: 'CLERK_SECRET_KEY', kind: 'secret', requiredForPilot: true, gate: 'GATE-05' },
  { name: 'CLERK_PUBLISHABLE_KEY', kind: 'var', requiredForPilot: true, gate: 'GATE-05' },
  { name: 'CLERK_AUTHORIZED_PARTIES', kind: 'var', requiredForPilot: true },
  { name: 'CLERK_JWT_KEY', kind: 'secret', requiredForPilot: false },
  { name: 'META_APP_SECRET', kind: 'secret', requiredForPilot: true, gate: 'GATE-01/02' },
  { name: 'META_VERIFY_TOKEN', kind: 'secret', requiredForPilot: true, gate: 'GATE-02' },
  { name: 'META_APP_ID', kind: 'var', requiredForPilot: true, gate: 'GATE-02' },
  { name: 'META_CONFIG_ID', kind: 'var', requiredForPilot: true, gate: 'GATE-02' },
  { name: 'META_TOKEN_SECRET', kind: 'secret', requiredForPilot: true, gate: 'GATE-02' },
  { name: 'PIX_TOKEN_SECRET', kind: 'secret', requiredForPilot: true, gate: 'GATE-08' },
  { name: 'AI_GATEWAY_TOKEN', kind: 'secret', requiredForPilot: false, gate: 'GATE-06' },
  { name: 'ANTHROPIC_API_KEY', kind: 'secret', requiredForPilot: false, gate: 'GATE-06' },
  { name: 'VAPID_PRIVATE_KEY', kind: 'secret', requiredForPilot: false },
  { name: 'ATTACHMENT_TOKEN_SECRET', kind: 'secret', requiredForPilot: true },
  { name: 'DB', kind: 'binding', requiredForPilot: true },
  { name: 'CLINIC', kind: 'binding', requiredForPilot: true },
  { name: 'ATTACHMENTS', kind: 'binding', requiredForPilot: true },
  { name: 'INBOUND_EVENTS', kind: 'binding', requiredForPilot: true },
]

const env = process.argv[2] ?? 'staging'
console.log(`ops-secrets-inventory: ambiente alvo "${env}" (nomes apenas)\n`)
for (const item of items) {
  const flag = item.requiredForPilot ? 'REQUIRED' : 'optional'
  const gate = item.gate ? ` gate=${item.gate}` : ''
  console.log(`  [${item.kind}] ${item.name} — ${flag}${gate}`)
}
console.log('\nNunca imprimir valores. Configurar com wrangler secret put / dashboard.')
console.log('Detalhe: docs/implementation/f6-ops.md · docs/implementation/environments.md')
