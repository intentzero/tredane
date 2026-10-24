/**
 * Inventário de secrets / vars por ambiente (#44).
 * Não contém valores — só nomes e onde configurar.
 */

export type SecretInventoryItem = {
  name: string
  kind: 'secret' | 'var' | 'binding'
  environments: Array<'development' | 'staging' | 'production'>
  requiredForPilot: boolean
  notes: string
  gate?: string
}

export const SECRETS_INVENTORY: readonly SecretInventoryItem[] = [
  {
    name: 'CLERK_SECRET_KEY',
    kind: 'secret',
    environments: ['staging', 'production'],
    requiredForPilot: true,
    notes: 'wrangler secret put; synthetic só em development',
    gate: 'GATE-05',
  },
  {
    name: 'CLERK_PUBLISHABLE_KEY',
    kind: 'var',
    environments: ['staging', 'production'],
    requiredForPilot: true,
    notes: 'Dashboard / vars; exposta ao browser via /api/auth/client-config',
    gate: 'GATE-05',
  },
  {
    name: 'CLERK_AUTHORIZED_PARTIES',
    kind: 'var',
    environments: ['development', 'staging', 'production'],
    requiredForPilot: true,
    notes: 'Origens azp; obrigatório staging/prod',
  },
  {
    name: 'CLERK_JWT_KEY',
    kind: 'secret',
    environments: ['staging', 'production'],
    requiredForPilot: false,
    notes: 'Opcional — verificação JWT networkless',
  },
  {
    name: 'META_APP_SECRET',
    kind: 'secret',
    environments: ['staging', 'production'],
    requiredForPilot: true,
    notes: 'HMAC webhook + Embedded Signup; nunca versionar',
    gate: 'GATE-01/02',
  },
  {
    name: 'META_VERIFY_TOKEN',
    kind: 'secret',
    environments: ['staging', 'production'],
    requiredForPilot: true,
    notes: 'Challenge GET webhook',
    gate: 'GATE-02',
  },
  {
    name: 'META_APP_ID',
    kind: 'var',
    environments: ['staging', 'production'],
    requiredForPilot: true,
    notes: 'App Meta; META_MODE=live',
    gate: 'GATE-02',
  },
  {
    name: 'META_CONFIG_ID',
    kind: 'var',
    environments: ['staging', 'production'],
    requiredForPilot: true,
    notes: 'Embedded Signup config',
    gate: 'GATE-02',
  },
  {
    name: 'META_TOKEN_SECRET',
    kind: 'secret',
    environments: ['staging', 'production'],
    requiredForPilot: true,
    notes: 'Cifrar tokens Meta em D1',
    gate: 'GATE-02',
  },
  {
    name: 'PIX_TOKEN_SECRET',
    kind: 'secret',
    environments: ['staging', 'production'],
    requiredForPilot: true,
    notes: 'Cifrar App ID Woovi; PIX_MODE sandbox/live',
    gate: 'GATE-08',
  },
  {
    name: 'AI_GATEWAY_TOKEN',
    kind: 'secret',
    environments: ['staging', 'production'],
    requiredForPilot: false,
    notes: 'Só se AI_MODE=gateway; payload logging off',
    gate: 'GATE-06',
  },
  {
    name: 'ANTHROPIC_API_KEY',
    kind: 'secret',
    environments: ['staging', 'production'],
    requiredForPilot: false,
    notes: 'BYOK opcional',
    gate: 'GATE-06',
  },
  {
    name: 'VAPID_PRIVATE_KEY',
    kind: 'secret',
    environments: ['staging', 'production'],
    requiredForPilot: false,
    notes: 'Web Push live; VAPID_PUBLIC_KEY em var',
  },
  {
    name: 'ATTACHMENT_TOKEN_SECRET',
    kind: 'secret',
    environments: ['staging', 'production'],
    requiredForPilot: true,
    notes: 'HMAC tokens efémeros R2',
  },
  {
    name: 'DB',
    kind: 'binding',
    environments: ['development', 'staging', 'production'],
    requiredForPilot: true,
    notes: 'D1 real em staging/prod — nunca placeholder no caminho piloto',
  },
  {
    name: 'CLINIC',
    kind: 'binding',
    environments: ['development', 'staging', 'production'],
    requiredForPilot: true,
    notes: 'Durable Object SQLite por clínica',
  },
  {
    name: 'ATTACHMENTS',
    kind: 'binding',
    environments: ['development', 'staging', 'production'],
    requiredForPilot: true,
    notes: 'R2 privado por ambiente',
  },
  {
    name: 'INBOUND_EVENTS',
    kind: 'binding',
    environments: ['development', 'staging', 'production'],
    requiredForPilot: true,
    notes: 'Queue + DLQ por ambiente',
  },
] as const

export function listRequiredSecretsFor(
  env: 'staging' | 'production',
): SecretInventoryItem[] {
  return SECRETS_INVENTORY.filter(
    (s) =>
      s.requiredForPilot &&
      s.environments.includes(env) &&
      (s.kind === 'secret' || s.kind === 'var'),
  )
}
