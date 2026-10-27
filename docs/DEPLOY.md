# Deploy manual (GitHub Actions)

Workflow: [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) — **Actions → Deploy → Run workflow**.

- **Inputs:** `target` (`staging` | `production`, default `staging`) e `ref` (branch/tag/SHA, default `main`).
- **Job `resolve`:** resolve `ref` para um SHA. Para `production` recusa se (a) o workflow não foi disparado a partir de `main`, ou (b) o SHA não está contido em `origin/main`.
- **Job `deploy-staging`** (environment `staging`) / **`deploy-production`** (environment `production`, gate de aprovação pelo required reviewer): checkout do SHA resolvido → Node 22 → `npm ci` → `typecheck` → `lint` → `npm test` → `test:runtime` → `npm run deploy -- <target>`.
- `npm run deploy -- <target>` é o caminho existente ([`scripts/deploy.mjs`](../scripts/deploy.mjs)): `npm run build` com `CLOUDFLARE_ENV=<target>` → confirma que o Worker gerado é `tredane-dev-<target>` → `check-env-placeholders.mjs <target>` → `npx wrangler deploy --env <target>`.
- O **Version ID** publicado vai para o job summary (via `WRANGLER_OUTPUT_FILE_PATH`, com fallback para a linha `Current Version ID` do log).
- `permissions: contents: read`; `concurrency` por target (`deploy-staging` / `deploy-production`), sem cancelar deploys em curso.

### Âmbito / o que este workflow NÃO faz

- Publica **só o Worker principal** (painel/API): `tredane-dev-staging` / `tredane-dev-production` (`wrangler.jsonc` → `env.<target>.name`; `scripts/deploy.mjs` → `WORKER_BASE = 'tredane-dev'`).
- **Não** publica a landing page `site/` (Workers `tredane-site-staging` / `tredane-site-production`, `site/wrangler.jsonc`). `site/package.json` só tem `deploy:staging`; **não existe script de deploy de produção da landing**.
- **Não** aplica migrações D1 (`wrangler d1 migrations apply`) — continua manual, após revisão (ver [environments.md](implementation/environments.md)).
- **Não** cria/atualiza secrets do Worker (`wrangler secret put`).

## O que ainda falta (A3 — requer OK separado)

### 1. GitHub environments

| Environment | Configuração |
| --- | --- |
| `staging` | Criar. Opcional: deployment branches = `main` + branches de trabalho. |
| `production` | Criar. **Required reviewers: Paulo** (único colaborador do repo hoje: `intentzero` — confirmar que é o utilizador GitHub do Paulo). Ativar **Prevent self-review**. Deployment branches: **só `main`**. |

> Nota: se o mesmo utilizador (`intentzero`) dispara e aprova, o gate só é real com *Prevent self-review* ligado, ou se os deploys forem disparados por outra conta/bot.

### 2. Secrets / variables por environment

| Nome | Tipo | `staging` | `production` |
| --- | --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | environment **secret** | token staging (abaixo) | token production (abaixo) |
| `CLOUDFLARE_ACCOUNT_ID` | environment **variable** (ou secret; o workflow aceita os dois) | `fc4be5a9597f5f05126209205ee98339` | **UNKNOWN** |

Não usar secrets ao nível do repositório para isto — só ao nível do environment.

### 3. Tokens Cloudflare (mínimo, um por environment, account-owned, limitado à conta respetiva)

Derivado dos bindings de `wrangler.jsonc` (`env.staging` / `env.production`): D1 `DB`, Durable Object `CLINIC` (`ClinicDurableObject`, migração `v1-f0-clinic-do`), R2 `ATTACHMENTS`, Queue `INBOUND_EVENTS` (producer + consumer + DLQ), Workflow `TENANT_PURGE`, static assets, e — só em staging — custom domain `staging.app.tredane.com`.

| Permissão | Porquê | staging | production |
| --- | --- | --- | --- |
| Account · **Workers Scripts: Edit** | upload/deploy do Worker + assets, migração DO, Workflow `TENANT_PURGE`, `wrangler secret list` (usado por `check:env`) | ✅ | ✅ |
| Account · **Queues: Edit** | `wrangler deploy` regista o consumer de `tredane-inbound-<env>` (com DLQ) | ✅ | ✅ |
| Account · **Account Settings: Read** | wrangler lê a conta | ✅ | ✅ |
| Zone `tredane.com` · **Workers Routes: Edit** | custom domain `staging.app.tredane.com` (necessário enquanto o deploy adiciona/altera a ligação) | ✅ | ❌ (sem `routes` em `env.production` hoje) |
| Account · **D1: Edit** | só se o workflow passar a aplicar `wrangler d1 migrations apply` (hoje **não** aplica; o binding não precisa) | ❌ hoje | ❌ hoje |
| Account · **Workers R2 Storage** | não necessário: deploy só referencia o bucket já existente | ❌ | ❌ |

Primeiro deploy de um Worker que ainda não existe requer Workers Scripts Edit ao nível da conta (não por-Worker). Se o primeiro deploy falhar por permissão, ajustar e anotar aqui.

### 4. Contas Cloudflare

| Environment | Account ID | Fonte |
| --- | --- | --- |
| staging | `fc4be5a9597f5f05126209205ee98339` | indicado pelo Paulo (não está em `wrangler.jsonc`) |
| production | **UNKNOWN** | `wrangler.jsonc` e `site/wrangler.jsonc` não têm `account_id` |

### 5. Bloqueios de produção já existentes (o workflow vai falhar em `check:env` até resolver)

`scripts/check-env-placeholders.mjs production` recusa hoje porque:

- `env.production.d1_databases[0].database_id` é placeholder (`00000000-0000-4000-a000-0000000000ff`);
- `env.production.vars` não tem `CLERK_PUBLISHABLE_KEY` nem `CLERK_AUTHORIZED_PARTIES`;
- secrets do Worker `tredane-dev-production` obrigatórios: `CLERK_SECRET_KEY`, `ATTACHMENT_TOKEN_SECRET`, `TOKEN_ENCRYPTION_KEY` (+ Meta/Pix se `live`).

Também por provisionar na conta de produção: D1 `tredane-production`, R2 `tredane-attachments-production`, Queues `tredane-inbound-production` e `tredane-inbound-dlq-production`.
