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
| `CLINIC` | Durable Object (`ClinicDurableObject`, SQLite) | Um DO por clínica; operação + WebSockets | Harness F0 (probe); domínio na #20 |
| `ATTACHMENTS` | R2 (privado) | Anexos; sem URL pública permanente | Binding local declarado; política de acesso na F3 |
| `INBOUND_EVENTS` | Queue (producer) | Entrada assíncrona (webhooks, etc.) | Binding local declarado; consumidores na F3 |
| Workflows | Workflow | Lembretes/processos multi-etapa | **Contrato apenas** — sem binding até o módulo existir |

Variável `ENVIRONMENT`: `development` \| `staging` \| `production`.

## Segredos

- `.dev.vars.example` documenta a ausência de segredos obrigatórios na F0.
- Segredos reais (Clerk, Meta, Pix, AI Gateway) entram por ambiente via `wrangler secret` / dashboard — **nunca** no git.
- Fixtures e seeds usam apenas IDs/e-mails sintéticos (`user_synth_*`, `clinic-demo-*`).

## O que ainda não está provisionado

Criação remota de D1/R2/Queues/DO namespaces, contas Meta/Clerk e revisão jurídica permanecem na preparação operacional (#18/#44). Este documento fixa **nomes e responsabilidades** para a implementação não divergir entre ambientes.
