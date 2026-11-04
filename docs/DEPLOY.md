# Deploy manual (GitHub Actions)

Há **dois** workflows de publicação, ambos só por `workflow_dispatch` (sem push automático):

| O quê | Workflow | Actions UI | Workers |
| --- | --- | --- | --- |
| Painel / API | [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) | **Actions → Deploy → Run workflow** | `tredane-dev-staging` / `tredane-dev-production` |
| Landing page (`site/`) | [`.github/workflows/deploy-site.yml`](../.github/workflows/deploy-site.yml) | **Actions → Deploy landing → Run workflow** | `tredane-site-staging` / `tredane-site-production` |

**Porquê workflows separados (não um input a mais no Deploy):** o painel corre typecheck/lint/testes, migrate/smoke D1 e `check:env` do Worker principal; a landing é só `site/` (Astro estático + `wrangler deploy`). Misturar os dois no mesmo formulário aumentava o risco de publicar o Worker errado ou de saltar passos D1 por confusão de inputs.

Ambos reutilizam os GitHub Environments `staging` / `production` (secrets `CLOUDFLARE_API_TOKEN`, variable/secret `CLOUDFLARE_ACCOUNT_ID`), Node 22, e o mesmo guard de production (workflow a partir de `main` + SHA contido em `origin/main`).

---

## Deploy — painel / API

Workflow: [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) — **Actions → Deploy → Run workflow**.

- **Inputs:** `target` (`staging` | `production`, default `staging`), `ref` (branch/tag/SHA, default `main`), e `apply_d1_migrations` (boolean, default `false` — só afecta **production**).
- **Job `resolve`:** resolve `ref` para um SHA. Para `production` recusa se (a) o workflow não foi disparado a partir de `main`, ou (b) o SHA não está contido em `origin/main`.
- **Job `deploy-staging`** (environment `staging`): checkout do SHA → Node 22 → `npm ci` → `typecheck` → `lint` → `npm test` → `test:runtime` → **`db:migrate:remote` (D1)** → **`db:smoke:admin-schema`** → `npm run deploy -- staging`.
- **Job `deploy-production`** (environment `production`, gate de aprovação pelo required reviewer): igual aos testes, depois `npm run deploy -- production`. Migrate + smoke D1 **só** se `apply_d1_migrations=true` (opt-in + approval do environment); default = skip com aviso no log.
- `npm run deploy -- <target>` é o caminho existente ([`scripts/deploy.mjs`](../scripts/deploy.mjs)): `npm run build` com `CLOUDFLARE_ENV=<target>` → confirma que o Worker gerado é `tredane-dev-<target>` → `check-env-placeholders.mjs <target>` → `npx wrangler deploy --env <target>`.
- O **Version ID** publicado vai para o job summary (via `WRANGLER_OUTPUT_FILE_PATH`, com fallback para a linha `Current Version ID` do log).
- `permissions: contents: read`; `concurrency` por target (`deploy-staging` / `deploy-production`), sem cancelar deploys em curso.

### Ordem staging (Confirmado — Paulo, 03/11/2026)

Evita Worker novo com D1 atrasado (incidente `GET /api/me/tenants` → 500 / `SchemaNotReady`):

1. `npm run db:migrate:remote -- staging` → `wrangler d1 migrations apply tredane-staging --env staging --remote`
2. `npm run db:smoke:admin-schema -- staging` → `admin_schema_state.version == ADMIN_SCHEMA_VERSION` (hoje `16`); falha → job falha, **sem** deploy
3. `npm run deploy -- staging`

Scripts: [`scripts/d1-migrate-remote.mjs`](../scripts/d1-migrate-remote.mjs), [`scripts/d1-admin-schema-smoke.mjs`](../scripts/d1-admin-schema-smoke.mjs).

### Production — path de approval (não auto-apply por defeito)

- Default: **não** aplica migrações D1 no pipeline (continua manual após revisão, ou opt-in).
- Opt-in: `apply_d1_migrations=true` no Run workflow → steps migrate → smoke correm **dentro** do job com `environment: production` (required reviewers). Sem esse flag, o job regista skip e segue para o deploy do Worker.
- Não misturar apply cego sem smoke: quando o flag está ligado, a ordem é a mesma do staging.

### Âmbito / o que o Deploy do painel NÃO faz

- Publica **só o Worker principal** (painel/API): `tredane-dev-staging` / `tredane-dev-production` (`wrangler.jsonc` → `env.<target>.name`; `scripts/deploy.mjs` → `WORKER_BASE = 'tredane-dev'`).
- **Não** publica a landing page `site/` — ver secção seguinte.
- **Não** faz fan-out de migrações do SQLite dos Durable Objects (clinic).
- **Não** cria/atualiza secrets do Worker (`wrangler secret put`).

---

## Deploy landing — `site/`

Workflow: [`.github/workflows/deploy-site.yml`](../.github/workflows/deploy-site.yml) — **Actions → Deploy landing → Run workflow**.

- **Inputs:** `target` (`staging` | `production`, default `staging`), `ref` (default `main`). Sem `apply_d1_migrations` (a landing não usa D1).
- **Job `resolve`:** igual ao do painel (guard de production).
- **Jobs `deploy-staging` / `deploy-production`:** environment GitHub correspondente → checkout do SHA → Node 22 (cache `site/package-lock.json`) → `npm ci` em `site/` → `npm run build:staging` ou `build:production` → `npx wrangler deploy --env <target>` a partir de `site/` (`site/wrangler.jsonc`).
- Workers / domínios: `tredane-site-staging` → `https://staging.tredane.com`; `tredane-site-production` → `https://tredane.com` (apex).
- `concurrency`: `deploy-landing-staging` / `deploy-landing-production`, sem cancelar deploys em curso.
- Reutiliza `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID` dos environments (o token de deploy do painel com Workers Scripts Edit + Zone Workers Routes Edit cobre também os custom domains da landing). **Não** precisa de `CLOUDFLARE_API_TOKEN_D1`.

### Manual (equivalente local)

```bash
cd site
npm ci
npm run deploy:staging      # SITE_URL=https://staging.tredane.com + PUBLIC_NOINDEX=1 → wrangler --env staging
npm run deploy:production  # SITE_URL=https://tredane.com → wrangler --env production
```

### Como o Paulo corre no GitHub

1. Abrir o repositório → **Actions**.
2. Na lista da esquerda, escolher **Deploy landing** (não **Deploy** — esse é o painel).
3. **Run workflow** → *Use workflow from:* `main` (obrigatório para production) → `target` = `staging` ou `production` → `ref` (default `main`) → **Run workflow**.
4. Production: aguardar aprovação do environment `production` (required reviewers), como no Deploy do painel.
5. No fim do job, o summary mostra Worker, domínio e Version ID. Staging: `https://staging.tredane.com`. Production: `https://tredane.com`.

---

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
| `CLOUDFLARE_API_TOKEN_D1` | environment **secret** (opcional) | token com **D1: Edit** se o de deploy não tiver; senão o workflow usa `CLOUDFLARE_API_TOKEN` | idem (só usado se `apply_d1_migrations` no Deploy do painel) |
| `CLOUDFLARE_ACCOUNT_ID` | environment **variable** (ou secret; o workflow aceita os dois) | `fc4be5a9597f5f05126209205ee98339` | **UNKNOWN** |

Não usar secrets ao nível do repositório para isto — só ao nível do environment.

Se o token usado no migrate/smoke do **painel** **não** tiver Account · **D1: Edit**, o step falha com mensagem a apontar para este documento (alargar o token existente ou criar `CLOUDFLARE_API_TOKEN_D1`).

### 3. Tokens Cloudflare (mínimo, um por environment, account-owned, limitado à conta respetiva)

Derivado dos bindings de `wrangler.jsonc` (`env.staging` / `env.production`): D1 `DB`, Durable Object `CLINIC` (`ClinicDurableObject`, migração `v1-f0-clinic-do`), R2 `ATTACHMENTS`, Queue `INBOUND_EVENTS` (producer + consumer + DLQ), Workflow `TENANT_PURGE`, static assets, e — só em staging — custom domain `staging.app.tredane.com`. A landing (`site/wrangler.jsonc`) só precisa de Workers Scripts Edit + Zone Workers Routes Edit para `staging.tredane.com` / `tredane.com`.

| Permissão | Porquê | staging | production |
| --- | --- | --- | --- |
| Account · **Workers Scripts: Edit** | upload/deploy do Worker + assets, migração DO, Workflow `TENANT_PURGE`, `wrangler secret list` (usado por `check:env`); também deploy da landing | ✅ | ✅ |
| Account · **Queues: Edit** | `wrangler deploy` regista o consumer de `tredane-inbound-<env>` (com DLQ) | ✅ | ✅ |
| Account · **Account Settings: Read** | wrangler lê a conta | ✅ | ✅ |
| Zone `tredane.com` · **Workers Routes: Edit** | custom domains do painel (`staging.app.tredane.com`) e da landing (`staging.tredane.com`, apex `tredane.com`) | ✅ | ✅ (landing apex; painel production ainda sem `routes` no `wrangler.jsonc` raiz) |
| Account · **D1: Edit** | `wrangler d1 migrations apply` + smoke `d1 execute` no pipeline staging do painel (sempre); production só com `apply_d1_migrations` | ✅ **obrigatório** no token de migrate/smoke do painel | ✅ quando o opt-in for usado |
| Account · **Workers R2 Storage** | não necessário: deploy só referencia o bucket já existente | ❌ | ❌ |

Primeiro deploy de um Worker que ainda não existe requer Workers Scripts Edit ao nível da conta (não por-Worker). Se o primeiro deploy falhar por permissão, ajustar e anotar aqui.

### 4. Contas Cloudflare

| Environment | Account ID | Fonte |
| --- | --- | --- |
| staging | `fc4be5a9597f5f05126209205ee98339` | indicado pelo Paulo (não está em `wrangler.jsonc`) |
| production | **UNKNOWN** | `wrangler.jsonc` e `site/wrangler.jsonc` não têm `account_id` |

### 5. Bloqueios de produção já existentes (o Deploy do **painel** vai falhar em `check:env` até resolver)

`scripts/check-env-placeholders.mjs production` recusa hoje porque:

- `env.production.d1_databases[0].database_id` é placeholder (`00000000-0000-4000-a000-0000000000ff`);
- `env.production.vars` não tem `CLERK_PUBLISHABLE_KEY` nem `CLERK_AUTHORIZED_PARTIES`;
- secrets do Worker `tredane-dev-production` obrigatórios: `CLERK_SECRET_KEY`, `ATTACHMENT_TOKEN_SECRET`, `TOKEN_ENCRYPTION_KEY` (+ Meta/Pix se `live`).

Também por provisionar na conta de produção: D1 `tredane-production`, R2 `tredane-attachments-production`, Queues `tredane-inbound-production` e `tredane-inbound-dlq-production`.

A landing **não** passa por `check:env` do painel; o deploy de `tredane-site-production` depende só do token/conta com a zona `tredane.com` e dos environments GitHub.
