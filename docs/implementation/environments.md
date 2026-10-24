# Contratos de ambientes e bindings — F0

**Estado:** contrato de engenharia **Proposto** para execução (issue [#15](https://github.com/intentzero/tredane/issues/15), épico [#14](https://github.com/intentzero/tredane/issues/14)). Não declara provisionamento remoto concluído nem autoriza dados reais.

## Ambientes

| Ambiente | Uso | Worker name (Wrangler) | IDs de recurso |
| --- | --- | --- | --- |
| **development** (raiz do `wrangler.jsonc`) | `npm run dev`, migrate/seed local, CI local | `tredane-dev` | Placeholder local explícito; **nunca** deploy remoto |
| **staging** (`env.staging`) | Validação pré-piloto | `tredane-dev-staging` | Substituir placeholders após provisionar |
| **production** (`env.production`) | Clínica piloto / produção | `tredane-dev-production` | Substituir placeholders após provisionar |

Bindings **não são herdados** entre ambientes Wrangler: cada `env.*` declara o conjunto completo. `npm run check:env -- staging` (e `production`) falha se ainda houver IDs fictícios.

## Contrato de bindings (nomes estáveis)

| Binding | Tipo | Papel (DEC-038 / ADRs) | F0 |
| --- | --- | --- | --- |
| `DB` | D1 | Tenants, memberships, convites, suporte, auditoria admin | Ativo (local + contrato staging/prod) |
| `CLINIC` | Durable Object (`ClinicDurableObject`, SQLite) | Um DO por clínica; operação + WebSockets | Domínio #20; auth #21; WS/fence #23 |
| `ATTACHMENTS` | R2 (privado) | Anexos; sem URL pública permanente | Binding local; acesso autenticado + token efémero (#34 / [f3-attachments.md](f3-attachments.md)); política fina de retenção **Em aberto** |
| `INBOUND_EVENTS` | Queue (producer + consumer + DLQ) | Webhooks WhatsApp (#32) + drain outbox DO; DLQ `tredane-inbound-dlq-*` | Consumer activo; ver [f3-whatsapp-webhooks.md](f3-whatsapp-webhooks.md) |
| Workflows | Workflow | Lembretes/processos multi-etapa | **Contrato apenas** — sem binding; expurgo #43 usa máquina de estados D1 ([f6-retention-purge.md](f6-retention-purge.md)) |
| `AUTH_MODE` / `CLERK_*` | vars/secrets | Sessão Clerk + authorized parties (#21) | Synthetic em development; Clerk em staging/prod |
| `APP_BASE_URL` / `EMAIL_TRANSPORT` | vars | Links de convite + transporte de e-mail (#25) | `simulated` em development; provedor real Em aberto |
| `PUSH_MODE` / `VAPID_*` | vars/secrets | Web Push PWA (#42) | `synthetic` em development/CI; live exige `VAPID_PUBLIC_KEY` + secret `VAPID_PRIVATE_KEY` |

Variável `ENVIRONMENT`: `development` \| `staging` \| `production`.

## Segredos

- `.dev.vars.example` documenta auth F1 (#21): `AUTH_MODE`, `CLERK_*`, `CLERK_AUTHORIZED_PARTIES`.
- Em **development**, `AUTH_MODE=synthetic` (default sem chaves) permite `Authorization: Bearer synth:<user_id>` com fixtures `user_synth_*`.
- Em **staging/production**, synthetic é recusado; obrigatório `CLERK_SECRET_KEY` (secret), `CLERK_PUBLISHABLE_KEY`, `CLERK_AUTHORIZED_PARTIES`; opcional `CLERK_JWT_KEY`.
- Segredos reais (Clerk, Meta, Pix, AI Gateway) entram por ambiente via `wrangler secret` / dashboard — **nunca** no git.
- Fixtures e seeds usam apenas IDs/e-mails sintéticos (`user_synth_*`, `clinic-demo-*`).
- Detalhe: [f1-clerk-auth.md](f1-clerk-auth.md).

## O que ainda não está provisionado

Criação remota de D1/R2/Queues/DO namespaces, contas Meta/Clerk e revisão jurídica permanecem na preparação operacional (#18/#44). Este documento fixa **nomes e responsabilidades** para a implementação não divergir entre ambientes.
