# F1 — Clinic Durable Object, SQLite, migrations e outbox

**Estado:** implementação da issue [#20](https://github.com/intentzero/tredane/issues/20) (épico [#14](https://github.com/intentzero/tredane/issues/14)). Classe/namespace `ClinicDurableObject`, runner SQL por instância, repositórios operacionais mínimos, outbox durável e envelopes internos. Clerk HTTP em [#21](f1-clerk-auth.md); WebSockets/revogação em [#23](f1-realtime-ws.md). **Sem** UI de painel produtiva. Dados sintéticos apenas.

## Decisão de persistência (Confirmado — DEC-038)

| Store | Responsabilidade neste entrega |
| --- | --- |
| D1 central | fora de escopo (#19) |
| SQLite do DO por clínica | meta do tenant, contactos mínimos, inbound (dedup), outbox, audit operacional, `f0_probe` |
| Wrangler `migrations` / `new_sqlite_classes` | ciclo de vida da **classe** DO — distinto do runner SQL de tabelas |

## Roteamento e autorização interna

- Worker resolve a instância com `CLINIC.idFromName(clinicId)` após validar prefixo sintético `clinic-demo-*` nos harness; APIs de produto autenticam via [#21](f1-clerk-auth.md).
- Envelope `ClinicCaller` (`kind`, `tenantId`, `assertion`) autentica o chamador interno (`worker_internal` / `queue_consumer`).
- O DO exige `caller.tenantId === ctx.id.name` (nome estável da instância) **e** vincula `clinic_meta.tenant_id` na primeira chamada; tenant forjado em RPC/job → `TenantMismatchError`.
- Dois DOs com o mesmo ID lógico de contacto/evento **não** partilham dados.

## Migrações por instância

- Catálogo em `src/clinic/migrations/` (versão alvo `CLINIC_SCHEMA_VERSION = 1`).
- Runner `runClinicMigrations` grava `clinic_schema_migrations` + `clinic_schema_state` (`ready` / `migrating` / `failed`).
- `assertClinicSchemaReady` bloqueia operações com schema parcial ou falhado.
- Retoma após falha: statements com `IF NOT EXISTS`; versão só avança no commit da migração.
- Cada instância migra ao acordar (`blockConcurrencyWhile` no construtor); não exige que todas as clínicas estejam acordadas.

## Transação, outbox e efeitos externos

- `ingestContactMessage` corre em `transactionSync`: inbound + contacto + audit + outbox `pending`.
- **Nenhuma** chamada HTTP/Queue/R2 dentro da transação (`externalCallsInsideTransaction: 0`).
- `publishPendingEffects` / `drainOutbox` publicam **após** commit; falha deixa `pending` para retentativa (alarm/drain).
- Crash entre commit e publish: entidade permanece uma; drain recupera o outbox sem duplicar.
- Consumer devolve `ConsumerResult` ao DO correto via `acknowledgeResult` (tenant + idempotency).

## Código

| Área | Caminho |
| --- | --- |
| Domínio / repositórios | `src/clinic/` |
| DO | `src/worker/clinic-do.ts` |
| Harness HTTP | `/api/f0/clinic/...`, `/api/f1/clinic/...` em `src/worker/app.ts` |
| Testes unitários | `src/clinic/clinic.test.ts` |
| Harness runtime | `src/worker/runtime.harness.test.ts` |

## Fora deste PR / evolução

- Auth Clerk — [#21](f1-clerk-auth.md); WS + fence D1→DO — [#23](f1-realtime-ws.md)
- Agenda/pipeline/WhatsApp completos (F2/F3)
- Índice global WhatsApp→tenant (issue de conexão)
- Telas de conteúdo F2+ (login/nav = [#22](f1-login-nav.md))
