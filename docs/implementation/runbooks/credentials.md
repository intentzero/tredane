# Runbook — Rotação de credenciais

**Estado:** Proposto · #44 · inventário em `src/ops/secrets.ts`

## Regras

- Nunca versionar segredos; usar `wrangler secret put --env staging|production`.
- Rodar um segredo de cada vez; smoke após cada rotação.
- Inventário: `npm run ops:secrets` ou `GET /api/f6/ops/secrets-inventory` (superadmin).

## Ordem sugerida (staging antes de prod)

1. `CLERK_SECRET_KEY` (+ vars publishable/authorized parties) — GATE-05
2. `META_APP_SECRET` / `META_VERIFY_TOKEN` / `META_TOKEN_SECRET` — actualizar App Meta em paralelo
3. `PIX_TOKEN_SECRET` — re-cifrar App IDs só com procedimento documentado (Em aberto detalhe)
4. `AI_GATEWAY_TOKEN` / `ANTHROPIC_API_KEY` — GATE-06; confirmar logging de payload off
5. `VAPID_PRIVATE_KEY` — clientes precisam re-subscrever push se o par mudar
6. `ATTACHMENT_TOKEN_SECRET` — tokens efémeros antigos invalidam-se (esperado)

## Verificação

```bash
npm run check:env -- staging
# smoke autenticado em staging (quando provisionado)
```

## Compromisso

Se um segredo vazar: revogar no provedor → put novo → invalidar sessões afectadas (Clerk) → incidente ([incidents.md](incidents.md)). Não registar o valor antigo em tickets/logs.
