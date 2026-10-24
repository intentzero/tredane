# F1 — Clerk e autorização por tenant no Worker/Hono

**Estado:** implementação da issue [#21](https://github.com/intentzero/tredane/issues/21) (épico [#14](https://github.com/intentzero/tredane/issues/14)). Sessão Clerk + memberships D1 + Platform Admin no backend. **Sem** UI de login/seletor (#22), **sem** WebSockets de produto (#23). Dados e identidades sintéticas até gates de piloto.

## Decisões aplicadas (Confirmado)

| DEC / ADR | Comportamento neste entrega |
| --- | --- |
| DEC-017 / ADR-0006 | Clerk **sem** Organizations; sem `orgId` como tenant |
| DEC-018 | `privateMetadata.superadmin === true` booleano, só backend; string/`publicMetadata` negados |
| DEC-020 / DEC-042 | Matriz de permissões owner vs attendant; config só owner |
| DEC-026 | Membership consultado por pedido; revogar A não afeta B (HTTP) |
| DEC-028 | Sem MFA/step-up |
| DEC-038 | Tenants/roles no D1 central; DO clínico não autoriza sozinho |

## Arquitetura

```text
Request → SessionAuthenticator (Clerk ou synthetic)
       → HumanPrincipal (clerkUserId + sessionId)
       → D1 async (memberships / tenant status)
       → Permission matrix (deny-by-default)
```

| Camada | Código |
| --- | --- |
| Auth | `src/auth/` |
| D1 async | `src/db/admin/async-store.ts`, `async-queries.ts` |
| Rotas | montadas em `src/worker/app.ts` via `createAuthRoutes()` |

### Principais

- **human** — sessão Clerk (ou `Bearer synth:<id>` em development)
- **superadmin** — subset de human após revalidação Backend API (sem cache positivo)
- **integration** — stub fail-closed até F3 (webhooks verificados)

### Rotas (#21)

| Método | Caminho | Authz |
| --- | --- | --- |
| GET | `/api/me` | sessão |
| GET | `/api/me/tenants` | sessão → memberships D1 ativos em tenants ativos |
| GET | `/api/tenants/:tenantId/context` | membership vigente; rejeita `X-Claimed-Role` forjada |
| GET | `/api/tenants/:tenantId/inbox-probe` | `clinic.inbox.read` (probe, não UI) |
| POST | `/api/tenants/:tenantId/config-probe` | `clinic.config.write` (owner) |
| GET | `/api/platform/tenants` | superadmin verificado |

CSRF: pedidos com cookie (sem Bearer) exigem `Origin`/`Referer` ∈ `CLERK_AUTHORIZED_PARTIES`. Bearer valida `azp` via Clerk.

## Configuração humana (Clerk Dashboard)

1. Criar aplicação Clerk (Development) **sem** Organizations habilitadas para o modelo de tenant do Tredane.
2. Copiar **Publishable key** e **Secret key**.
3. (Recomendado) JWT public key PEM → `CLERK_JWT_KEY` (verificação networkless).
4. Definir `privateMetadata.superadmin: true` (booleano) nos utilizadores Platform Admin via Backend API / Dashboard — nunca `publicMetadata`.
5. Segredos no Worker:
   - local: `.dev.vars` a partir de `.dev.vars.example`
   - staging/prod: `wrangler secret put CLERK_SECRET_KEY` (e vars `CLERK_PUBLISHABLE_KEY`, `CLERK_AUTHORIZED_PARTIES`, `AUTH_MODE=clerk`)
6. `CLERK_AUTHORIZED_PARTIES` = origens da Clinic App / Platform Admin (vírgula).

`AUTH_MODE=synthetic` só é honrado em `ENVIRONMENT=development`; staging/production forçam Clerk.

## Testes

- `src/auth/auth.test.ts` — sessão, superadmin, multi-tenant, revogação, matriz de permissões, fail-closed
- `src/auth/http.test.ts` — rotas Hono com fixtures `user_synth_*`
- Harness: `AUTH_MODE=synthetic` em `wrangler.runtime-test.jsonc`

## Fora deste PR

- Componentes/telas de login e seletor de clínica (#22)
- Revogação D1→DO/WebSocket (#23)
- Platform Admin CRUD — entregue em [#24](f1-platform-admin.md)
- Convites HTTP (#25); sessões de suporte / handoff cookies
- MFA (fora do MVP, DEC-028)
