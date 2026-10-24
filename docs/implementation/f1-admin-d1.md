# F1 — D1 administrativo, migrations e auditoria central

**Estado:** implementação da issue [#19](https://github.com/intentzero/tredane/issues/19) (épico [#14](https://github.com/intentzero/tredane/issues/14)). Camada de dados D1 central + repositórios; Clinic DO operacional em [#20](https://github.com/intentzero/tredane/issues/20) / [f1-clinic-do.md](f1-clinic-do.md); Clerk HTTP em [#21](f1-clerk-auth.md). Dados sintéticos apenas.

## Decisão de persistência (Confirmado — DEC-038)

| Store | Responsabilidade neste entrega |
| --- | --- |
| D1 central | tenants (ciclo de vida), memberships N:N, convites, pedidos/sessões/encerramento de suporte, auditoria central, `admin_schema_state` |
| SQLite do DO | fora de escopo (#20) |
| `services` / `professionals` | **legado F0** no D1; não são fonte operacional; mantidos sem editar `0001_bootstrap.sql` |

## Baseline Drizzle

- `db/migrations/meta/_journal.json` regista `0001_bootstrap`, `0002_tenant_memberships`, `0003_admin_d1_central`.
- Snapshots em `meta/0000_*.json` … `0002_*.json` permitem `npm run db:generate` sem recriar 0001/0002.
- Wrangler continua a aplicar só os `.sql` em `db/migrations/`.

## Migração `0003_admin_d1_central.sql`

- Colunas de ciclo de vida em `tenants` (`status`, `updated_at`, `suspended_at`, `pending_deletion_at`).
- `tenant_invitations` + `tenant_invitation_resends` (DEC-021–025).
- `support_access_requests`, `support_sessions`, `support_termination_requests` (DEC-029–037).
- `central_audit_events` (actor, subject opcional, tenant, ação, outcome — sem PHI/tokens).
- `admin_schema_state.version = 3` — repositórios recusam schema parcial (`SchemaNotReadyError`).

Tokens/handoffs: apenas `token_hash` / `handoff_hash` (SHA-256 hex). O valor em claro sai uma vez no retorno da API de emissão e nunca entra em auditoria/logs (`redactSecrets`).

## Repositórios

Código em `src/db/admin/`, separado do harness DO e do legado operacional:

- tenants, memberships, invitations, support, audit, queries escopadas por `tenant_id`
- relógio injetável (`src/db/clock.ts`) para TTL/concorrência nos testes
- transações `BEGIN IMMEDIATE` + `UPDATE … WHERE status = …` com `changes === 1`

## Fixtures sintéticas (`db/seed.sql`)

- `user_synth_multi`: owner em A, attendant em B
- owners múltiplos em A (`user_synth_owner_a`, `user_synth_owner_a2`, multi)
- `user_synth_no_access`: sem membership
- `clinic-demo-suspended` + owner dedicado
- `prof-1` / `facial` com o mesmo id local em clínicas distintas (legado)

## Testes

- Paridade empty vs upgrade a partir de 0002 (`bootstrap.test.ts`)
- Gate de schema, convites (rotação/quota/corrida), suporte (24h/30min/handoff/corrida), escopo de auditoria (`admin/admin.test.ts`)
- Harness Cloudflare atualizado para 3 tenants / 7 memberships / `admin_schema_state`

## Fora deste PR

- Rotas HTTP autenticadas Clerk — entregue em [#21](f1-clerk-auth.md)
- Domínio operacional + migrações por instância no DO — entregue em [#20](f1-clinic-do.md)
- Fan-out de revogação D1→DO/WebSocket (#23)
- Provedor de e-mail e cookies de handoff em produção
