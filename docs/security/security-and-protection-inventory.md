# Inventário de proteção e segurança

> Levantamento feito em 28/10/2026 (BRT) a partir do código da `main` em `4807146`, dos documentos em `docs/`, das issues e dos PRs abertos, e do histórico do workflow `deploy.yml` (`gh run list` / `gh run view`). **Nenhuma chamada foi feita à Cloudflare.** Documento só descritivo: não muda decisões nem autoriza merge, deploy ou ativação.

## Como ler os estados

| Estado | Significado neste documento |
|---|---|
| **em produção** | publicado no Worker `tredane-dev-production` com evidência |
| **em staging** | na `main` e incluído num deploy de staging com sucesso do `deploy.yml` |
| **na main sem deploy** | na `main`, mas depois do último deploy de staging com sucesso |
| **em PR aberto** | só num PR ainda não integrado |
| **planeado (issue)** | só existe como issue/decisão |

**Não verificado** = não foi possível confirmar o estado real do ambiente sem consultar a Cloudflare.

### Evidência de deploy (histórico do `deploy.yml`)

- O workflow foi executado 17 vezes (27–28/10/2026), todas por `workflow_dispatch`. **Em todas, o job `Deploy production` ficou `skipped`.** Não há nenhum deploy de produção registrado por este workflow. `docs/DEPLOY.md` §5 indica que a produção ainda não está provisionada (`database_id` placeholder, faltam vars/secrets; `check:env -- production` falha). Por isso **nenhuma funcionalidade está marcada como "em produção"**; o estado real do Worker de produção é **não verificado**.
- O último deploy de staging com sucesso foi criado em 28/10/2026 20:12 BRT, com SHA `317d163` (#192). Antes: run `40782048011`, 19:42 BRT, `96c1bb8`. Tudo até `317d163` está **em staging**. O commit `4807146` (merge do #181, só docs) está **na main sem deploy** (sujeito à configuração de vars/secrets do Worker, que não foi verificada).
- Deploys anteriores de staging: `40af67e` (#153, 15:37 BRT), `bf28ec3` (#152, 15:29), `9011c27` (#150, 15:00), `471d490` (#148, 27/10 19:28). O run `40593261557` (`9a9e427`, 27/10) falhou.
- Configuração de runtime fora do código (registro do Paulo, não verificado via Cloudflare): **desde 28/10/2026 19:58 BRT o Worker de staging tem `AI_AUTOBOOK=off`**, definido pelo Paulo. A produção nunca recebeu o #155.
- **Atenção:** houve um novo deploy de staging (20:12 BRT) depois dessa alteração. `wrangler.jsonc` não define `AI_AUTOBOOK` nem `keep_vars`. Se o `off` foi gravado como variável de texto (e não como secret), um `wrangler deploy` pode tê-lo removido. **Persistência do `AI_AUTOBOOK=off` depois das 20:12: não verificado.**

## Inventário

### 1. Autenticação e isolamento por clínica

| Campo | Detalhe |
|---|---|
| Estado | **em staging** (produção: não verificado) |
| Onde | `src/auth/middleware.ts:42` (`requireAuth`), `:55` (`requireSuperadmin`), `:72` (`requireTenantAccess`); `src/auth/authorize.ts:102` (`requireClinicPermission`); `src/auth/superadmin.ts:38`; um Durable Object por clínica: `src/worker/app.ts:318` (`idFromName(tenantId)`), `src/worker/clinic-do.ts:187-190` (recusa DO sem nome estável ou com `tenantId` diferente), `:1128`, `:1248`; `src/clinic/tenant.ts:58` |
| Decisão | ADR 0006 (Clerk), 0010 (MFA por papel), 0012 (DO com SQLite); DEC-043 (Clerk no piloto) |
| Testes | `src/auth/auth.test.ts`, `src/auth/http.test.ts`, `src/clinic/clinic.test.ts`, `src/realtime/ticket.test.ts`, `src/security/hardening.test.ts`, `src/worker/runtime.harness.test.ts` |
| Limites | Modo `synthetic` (`Bearer synth:<id>`, `src/auth/synthetic.ts:8`) só em development; rotas de harness devolvem 404 fora de dev (`src/security/env-gate.ts`). Produção sem `CLERK_PUBLISHABLE_KEY`/`CLERK_AUTHORIZED_PARTIES` (DEPLOY.md §5). |

### 2. Bloqueio de contato (só interno, com aviso de Pix)

| Campo | Detalhe |
|---|---|
| Estado | **em staging** (#150 `9011c27`, #151 `8947b37`) |
| Onde | `src/clinic/inbox/operations.ts:361` (`blockContactOp`, `blocked_at`, auditoria `contact.blocked` em `:447`); `src/inbox/routes.ts`; UI `src/client/panel/screens/inbox/BlockContactDialog.tsx:24` (`hasPendingPix`) |
| Decisão | DEC-046 (mensagens ofensivas) — sem DEC própria para o bloqueio |
| Testes | `src/clinic/inbox/block.test.ts`, `src/client/panel/screens/inbox/BlockContactDialog.test.tsx` |
| Limites | Bloqueio só no Tredane: **não** bloqueia nem denuncia na Meta (#182). **Limite aceite (decisão do Paulo, 28/10/2026):** bloqueio e pausa ficam só internos; integração com a Meta fora de escopo. Hoje não desliga todas as automações; a negação central de automações para contato bloqueado (`checkConversationProtection`) está **em PR aberto** #191; pausa = #187. |

### 3. Reset de staging bloqueado em produção

| Campo | Detalhe |
|---|---|
| Estado | **em staging** (#152 `bf28ec3`) |
| Onde | `src/clinic-reset/routes.ts:2-6`, `:48`, `:86` (404 se `ENVIRONMENT !== 'staging'`, antes da auth); `src/security/env-gate.ts:39` (`isStagingEnv`); `src/clinic/retention/operational-reset.ts` |
| Decisão | Pedido do Paulo, 28/10/2026 (STAGING-ONLY) — sem DEC |
| Testes | `src/clinic-reset/reset.http.test.ts` |
| Limites | Depende de `ENVIRONMENT` correto em cada Worker (`wrangler.jsonc`); exige `confirmName`. |

### 4. AI_AUTOBOOK (agendamento pela IA) e contenção

| Campo | Detalhe |
|---|---|
| Estado | Código: **em staging** (#155 `695fed3`, incluído nos deploys `96c1bb8` e `317d163`). Runtime staging: `AI_AUTOBOOK=off` definido em 28/10 19:58 BRT (registro do Paulo); a persistência depois do deploy das 20:12 BRT **não foi verificada**. Produção: nunca recebeu o #155. |
| Onde | `src/clinic/ai/deps.ts:24-25`, `:45` (`rpc.autoBook !== false`), `:55-60` — **ligado por padrão**: só `off` desliga; `src/clinic/ai/autobook.ts` (actor `system:ai-autobook`, `:386-420`, auditoria `appointment.ai_booked` em `:398`); `src/worker/bindings.ts:58` |
| Decisão | DEC-060 (`docs/product/decisions.md:58`); DEC-006 anotado |
| Testes | `src/clinic/ai/autobook.test.ts`, `src/clinic/ai/amanha-tarde.regression.test.ts` |
| Limites | Padrão inseguro (fail open): sem a var, marca por texto livre. Qualquer novo Worker/ambiente sem `AI_AUTOBOOK=off` ativa a funcionalidade. Contenção atual depende de uma var manual. **PR aberto #191** (S2/#173) inverte: só liga com `on` exato + clínica em `AI_AUTOBOOK_TENANTS`, e texto livre deixa de marcar. |

### 5. DEC-060, DEC-061 e confirmação por botão

| Campo | Detalhe |
|---|---|
| Estado | DEC-060: **em staging** (#155 `695fed3`; docs #157 `48e9661`). DEC-061: **na main sem deploy** (PR #181 integrado em `4807146`, só docs; redação aprovada pelo Paulo em 28/10, registro D-20261028-200500-CUR). Persistência da proposta (S3 #174), envio do botão (S4 #175) e clique→marcação/Pix (S5 #176): **no código / main sem deploy**. |
| Onde | `docs/product/decisions.md:58` (DEC-060), `:59` (DEC-061); `docs/architecture/conversational-hybrid-model.md`; ADR 0004 (via #181) |
| Decisão | DEC-061 substitui os caminhos de autorização por texto livre da DEC-060: só o toque da cliente no botão de uma proposta versionada pelo backend autoriza marcação |
| Testes | Nenhum para o botão (não implementado). |
| Limites | A decisão mudou, mas o código ainda não: `autobook.ts` continua a marcar por texto livre até o #191 (S2) ser integrado. |

### 6. Validação no backend

| Campo | Detalhe |
|---|---|
| Estado | **em staging** |
| Onde | Revalidação de marcação na transação pelo mesmo caminho das marcações manuais: `src/clinic/scheduling/booking.ts`, `check.ts`, `holds.ts`; horários passados (#156 `cf21d82`); validação de anexos `src/attachments/validate.ts:72`; saída da IA `src/ai/reply-output.ts:110` (`parseReplyOutput`) |
| Decisão | ADR 0005 (consistência de marcação); DEC-060 (revalidação) |
| Testes | `src/clinic/scheduling/booking.test.ts`, `scheduling.test.ts`, `past-slots.test.ts`, `holds.test.ts`, `src/ai/reply-output.robust.test.ts`, `src/attachments/attachments.test.ts` |
| Limites | Validação independente do LLM para propostas/cliques = #176 (planeado). |

### 7. Pix sem reserva de horário antes do pagamento

| Campo | Detalhe |
|---|---|
| Estado | **em staging** |
| Onde | `src/clinic/pix/signal-charge.ts:2-3`, `:135`; IA não marca serviço com sinal: `src/clinic/ai/autobook.ts:246`, `:336-345` |
| Decisão | DEC-047; ADR 0014 |
| Testes | `src/clinic/pix/signal-charge.test.ts:167`, `payment.test.ts`, `exceptions.test.ts`, `pix.test.ts`, `autobook.test.ts` |
| Limites | Pix real depende de `PIX_MODE`/`PIX_TOKEN_SECRET` e gate GATE-08; modo em staging não verificado. |

### 8. Anexos no R2 privado e leitura autenticada

| Campo | Detalhe |
|---|---|
| Estado | **em staging** |
| Onde | `src/attachments/r2.ts:36`, `:111` (`private, no-store`); `src/attachments/routes.ts:187-203` (`requireAuth` + `requireTenantAccess` + permissão); `src/attachments/tokens.ts` (`ATTACHMENT_TOKEN_SECRET`); `src/worker/clinic-do.ts:1248` (anexo de outra clínica ignorado); ingestão `media-ingest` |
| Decisão | #34; DEC-011 |
| Testes | `src/attachments/attachments.test.ts` |
| Limites | Imagens ainda não visíveis na conversa; cartão oculto/visualização sob demanda = #184/#185 (planeado). Retenção/exclusão de anexos sinalizados em aberto (#182). |

### 9. Imagens fora da IA (DEC-011)

| Campo | Detalhe |
|---|---|
| Estado | **em staging** |
| Onde | `src/clinic/ai/context.ts` (anexos nunca entram; só contagem em `_debugExcluded`) |
| Decisão | DEC-011 (`docs/product/decisions.md`, "confirmado parcialmente"); DEC-067 |
| Testes | `src/clinic/ai/ai.test.ts` (AC-37); `src/clinic/ai/context-minimization.test.ts` (S8) |
| Limites | IA ainda não avisa que há imagem não analisada (#188). Legenda é entrada não confiável. |

### 9b. Minimização / retenção do contexto IA (S8 / #179)

| Campo | Detalhe |
|---|---|
| Estado | **implementado em PR** (inventário + enforcement; gates jurídicos Em aberto) |
| Onde | `docs/security/ai-context-minimization.md`; `src/clinic/ai/context.ts`; `src/ai/rules.ts` (`redactProhibitedFromText`); `src/clinic/ai/operations.ts` (`ai_commands` mínimo); Gateway `cf-aig-collect-log-payload: false` + `cf-aig-skip-cache: true`; retenção `contact-delete` / `tenant-purge-local` |
| Decisão | DEC-011; REQ-072; H2 #159 divergência **Em aberto** (Paulo) |
| Testes | `context-minimization.test.ts`, `ai.test.ts`, `retention.test.ts` |
| Limites | Conjunto clinic/slots vs DEC-011; GATE-04/06; retenção proposta/clique após S3 |

### 10. Prompt injection

| Campo | Detalhe |
|---|---|
| Estado | **implementado em PR** (S6 / #177; reland para `main` após #198 ter entrado na base errada). Sem deploy. |
| Onde | `src/ai/untrusted.ts`, `src/ai/prompt.ts`, `src/ai/reply-output.ts` (`guardReplyOutput`), `src/ai/rules.ts`, `src/clinic/ai/operations.ts`; doc `docs/security/prompt-injection.md`; adaptador simulado recusa injection/tool calls; IA não envia mensagens (rascunho para a atendente) |
| Decisão | DEC-006, DEC-046; DEC-061 retira do LLM a autorização (S2/#191 já em `main`) |
| Testes | `src/clinic/ai/prompt-injection.test.ts` (ataques + zero efeitos); `src/ai/reply-output.robust.test.ts`, `src/clinic/ai/ai.test.ts` |
| Limites | Heurística `injection_suspected` é Proposta (só aviso). Resumo (`kind: summary`) não passa pelo schema fechado. Não afirma imunidade total; rascunho continua a exigir revisão humana. S9 (#180) consolida CI sintético + gates; liberação piloto continua Em aberto. |

### 11. Limites de abuso (por contato e por clínica)

| Campo | Detalhe |
|---|---|
| Estado | **implementado** — valores **Confirmado (Paulo, 29/10/2026)**; UI owner; enable por clínica (default off); issue #178 (S7) |
| Onde | `src/clinic/ai/abuse-limits.ts` + `clinic_settings` (migração 30); `AutomationLimitsCard`; autodraft + propostas; doc [abuse-limits.md](abuse-limits.md); também `AI_DAILY_DRAFT_CAP = 300` |
| Decisão | Valores aceites sob DEC-061 (nota S7, Paulo 29/10/2026); UI owner **Confirmado** (chat 29/10/2026); enable por clínica; ações manuais sem limite |
| Testes | `src/clinic/ai/abuse-limits.test.ts`; quotas de propostas em `proposals.test.ts` |
| Limites | Fail-closed por clínica até a owner ligar; env `ABUSE_LIMIT_*` aperta tetos; `AI_AUTOBOOK=off` vence; liberação H10/S9 humana continua Em aberto |

### 12. Épicos e PRs em curso

| Item | Estado | Onde |
|---|---|---|
| Épico SEG-IA #171 (#172–#180) | **parcial**: S1–S6/S8/S5 em `main`; S7 valores Confirmados (flag off); S9 harness sintético em `main` **sem** liberar piloto | #172 S1 · #173 S2 · #174 S3 · #175 S4 · #176 S5 · #177 S6 · #178 S7 · #179 S8 · #180 S9 |
| S1 / #172 | **na main sem deploy** (#181) | DEC-061 |
| S2 / #173 | **na main sem deploy** (#191) | texto livre nunca marca; `AI_AUTOBOOK` off por padrão |
| S3 / #174 | **na main sem deploy** (#264) | propostas versionadas |
| S4 / #175 | **na main sem deploy** (#267) | botões WhatsApp + resultados determinísticos |
| S5 / #176 | **na main sem deploy** (#268) | clique autenticado → book/Pix uma vez (`executeProposalConfirmOp`) |
| S6 / #177 | **na main sem deploy** (#263 reland) | `untrusted.ts`, `guardReplyOutput`, testes de ataque |
| S8 / #179 | **na main sem deploy** (#266) | inventário + redacção + retenção AI + testes isolamento |
| S9 / #180 | **harness + docs (PR); NO-GO piloto** | [seg-ia-s9-e2e-validation.md](seg-ia-s9-e2e-validation.md), `src/seg-ia-validation/`, kill switch runbook |
| Épico PROTEÇÃO #182 (#183–#189) | **planeado (issue)**, todas abertas | #183 P1 · #184 P2 · #185 P3 · #186 P4 · #187 P5 · #188 P6 · #189 P7 |
| P1 / #183 | **em PR aberto** #190 (docs; CI verde em `b42639d`) | DEC-062 **Proposto**, aguarda Paulo (P-1–P-3); `docs/product/protecao-equipe.md` |

### 13. Segredos e chaves (só nomes, nenhum valor)

Fonte: `src/ops/secrets.ts` (inventário em código, `npm run ops:secrets`), `wrangler.jsonc`, `docs/implementation/environments.md`, `docs/DEPLOY.md`.

| Worker / local | Nomes | Onde ficam |
|---|---|---|
| `tredane-dev` (development local) | conforme modo: `CLERK_SECRET_KEY`, `META_*`, `VAPID_*` | `.dev.vars` (fora do git) |
| `tredane-dev-staging` | Obrigatórios: `CLERK_SECRET_KEY`, `ATTACHMENT_TOKEN_SECRET`, `TOKEN_ENCRYPTION_KEY`; com Meta live: `META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_TOKEN_SECRET`; Pix: `PIX_TOKEN_SECRET`; IA: `CF_ACCOUNT_ID`, `AI_GATEWAY_ID`, `AI_GATEWAY_TOKEN` (+ `ANTHROPIC_API_KEY` se BYOK); push: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`; `DEMO_SEED_TOKEN` (staging-only). Opcional: `CLERK_JWT_KEY` | `wrangler secret put --env staging` (secrets do Worker) |
| `tredane-dev-production` | Obrigatórios `CLERK_SECRET_KEY`, `ATTACHMENT_TOKEN_SECRET`, `TOKEN_ENCRYPTION_KEY` (+ Meta/Pix se live). IA/push/demo **não** autorizados sem novo OK | Ainda não provisionados (DEPLOY.md §5) |
| GitHub environments `staging`/`production` | `CLOUDFLARE_API_TOKEN` (secret), `CLOUDFLARE_ACCOUNT_ID` (variable) | Secrets/variables por environment (não ao nível do repo) |

Proteções relacionadas: tokens WhatsApp/Pix cifrados com `TOKEN_ENCRYPTION_KEY` (`src/security/sealed-secret.ts`, teste `sealed-secret.test.ts`); `scripts/check-env-placeholders.mjs` bloqueia deploy com placeholders; o deploy não cria secrets.

**Plano de chaves — 28/10/2026:** itens 3, 11 e 14 feitos. Item 14: removido o `SENTRY_AUTH_TOKEN` do Worker `doohnut-api-production` (projeto Lucimark, fora deste repo). Itens 3 e 11: rotação do meta verify token do staging (`META_VERIFY_TOKEN`) e atualização do `.dev.vars`, com backups locais. Para o detalhe: feito em 28/10, ver plano de chaves. Estado atual dos secrets nos Workers: **não verificado** (sem chamadas à Cloudflare).

### 14. Dados fictícios e gates #18/#45

| Campo | Detalhe |
|---|---|
| Estado | Dados sintéticos **em staging** (seed `npm run db:seed:local` no CI; `src/clinic/demo`); gates: #18 **fechada** em 24/10/2026 (COMPLETED), mas com a checklist da issue sem marcas; #45 (validação ponta a ponta e liberação do piloto) **aberta** |
| Decisão | DEC-009, DEC-011, DEC-043, DEC-047 |
| Testes | CI (`.github/workflows/ci.yml`: seed fictício + "Env placeholder guard"); `src/mvp-validation/` |
| Limites | Dados reais e ativação dependem de #45 e de H10 (#167). O fecho do #18 não traz evidência visível na issue de aprovações Meta/jurídicas/terceiros — tratar como não verificado. |

### 15. Auditoria

| Campo | Detalhe |
|---|---|
| Estado | **em staging** |
| Onde | DO por clínica: tabela `operational_audit` (`src/clinic/migrations/0001_clinic_foundation.ts`), `src/clinic/audit.ts`; marcações pela IA: `appointment.ai_booked` / `appointment.ai_book_conflict` com actor `system:ai-autobook` (`src/clinic/ai/autobook.ts:386-420`); D1 central: `central_audit_events` (`db/migrations/0003_admin_d1_central.sql:111`, índice `:125`), escrita em `src/team/d1-ops.ts:33` |
| Decisão | ADR 0002, 0007, 0011; DEC-060 (auditoria da IA) |
| Testes | `src/clinic/ai/autobook.test.ts`, `src/clinic/clinic.test.ts`, testes de equipa/suporte |
| Limites | Sem trilha de auditoria de propostas/cliques (#174/#176); sem alertas automáticos sobre eventos de auditoria. |

## Lacunas conhecidas (priorizadas)

1. **Agendamento por IA ligado por padrão no código** (`src/clinic/ai/deps.ts:60`). Staging contido só por `AI_AUTOBOOK=off` manual; correção em PR aberto #191 (S2).
2. **Texto livre não marca** (S2); botão versionado S3–S5 em `main`, com `AI_AUTOBOOK` fail-closed por padrão até gates S9/H10 humanos.
2a. **`AI_AUTOBOOK=off` no staging pode ter sido apagado pelo deploy das 20:12 BRT** (não verificado).
3. **Limites de abuso Confirmados** (#178, Paulo 29/10/2026) com UI owner; enable por clínica (default off).
4. **Prompt injection** S6 em `main`; S9 harness sintético + runbook prontos — **liberação controlada do botão ainda Em aberto** (#180).
5. **Bloqueio de contato não para todas as automações e não existe pausa** (#191 parcial, #187). Não chegar à Meta é **limite aceite** (decisão do Paulo, 28/10/2026): bloqueio e pausa continuam só internos.
6. **Produção sem provisionamento e sem deploy registrado**; secrets de produção ausentes (DEPLOY.md §5).
7. **Gates de dados reais**: #45 aberta; #18 fechada sem evidência visível na issue.
8. **Imagens**: sem cartão oculto, sinalização ou fila de revisão (#184–#186); DEC-062 só proposta.
9. **Minimização/retenção IA (S8/#179):** inventário e enforcement em PR; DEC-011 parcial — Paulo fecha conjunto vs H2; GATE-04/06 e propostas S3 Em aberto.
10. **Estado real dos secrets e vars nos Workers não verificado** neste levantamento (sem chamadas à Cloudflare).
