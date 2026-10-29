# Contratos de ambientes e bindings — F0 / F6

**Estado:** contrato de engenharia **Proposto** para execução (issues [#15](https://github.com/intentzero/tredane/issues/15), [#44](https://github.com/intentzero/tredane/issues/44); épico [#14](https://github.com/intentzero/tredane/issues/14)). Não declara provisionamento remoto concluído nem autoriza dados reais.

## Ambientes

| Ambiente | Uso | Worker name (Wrangler) | IDs de recurso |
| --- | --- | --- | --- |
| **development** (raiz do `wrangler.jsonc`) | `npm run dev`, migrate/seed local, CI local | `tredane-dev` | Placeholder local explícito; **nunca** deploy remoto |
| **staging** (`env.staging`) | Validação pré-piloto | `tredane-dev-staging` | Substituir placeholders após provisionar — **Em aberto** até conta CF |
| **production** (`env.production`) | Clínica piloto / produção | `tredane-dev-production` | Substituir placeholders após provisionar — **Em aberto** |

Bindings **não são herdados** entre ambientes Wrangler: cada `env.*` declara o conjunto completo. `npm run check:env -- staging` (e `production`) falha se ainda houver IDs fictícios. **Nunca** usar D1 placeholder no caminho documentado do piloto.

## Contrato de bindings (nomes estáveis)

| Binding | Tipo | Papel (DEC-038 / ADRs) | Estado |
| --- | --- | --- | --- |
| `DB` | D1 | Tenants, memberships, convites, suporte, auditoria admin | Local + contrato staging/prod |
| `CLINIC` | Durable Object (`ClinicDurableObject`, SQLite) | Um DO por clínica; operação + WebSockets | Domínio #20–#43 |
| `ATTACHMENTS` | R2 (privado) | Anexos; sem URL pública permanente | #34; política fina Em aberto |
| `INBOUND_EVENTS` | Queue (producer + consumer + DLQ) | Webhooks WhatsApp + drain outbox DO; DLQ `tredane-inbound-dlq-*` | #32/#33 |
| `TENANT_PURGE` | Workflow (`TenantPurgeWorkflow`) | Expurgo de clínica ≤30 dias (#43) | **Confirmado** em development/runtime-test; staging/prod: contrato declarado, provisionamento na conta CF **Em aberto** |
| `AUTH_MODE` / `CLERK_*` | vars/secrets | Sessão Clerk + authorized parties (#21) | Synthetic em development; Clerk em staging/prod |
| `APP_BASE_URL` / `EMAIL_TRANSPORT` | vars | Links de convite + transporte de e-mail (#25) | `simulated` em development; provedor real Em aberto |
| `PUSH_MODE` / `VAPID_*` | vars/secrets | Web Push PWA (#42) | `synthetic` em development/CI; live exige VAPID |
| Observability | wrangler | Workers Observability (#44) | `observability.enabled: true` |

Variável `ENVIRONMENT`: `development` \| `staging` \| `production`.

## Inventário de secrets (nomes)

Código: `src/ops/secrets.ts` · `npm run ops:secrets` · API superadmin `/api/f6/ops/secrets-inventory`.

| Nome | Tipo | Staging/prod piloto | Gate |
| --- | --- | --- | --- |
| `CLERK_SECRET_KEY` | secret | obrigatório | GATE-05 |
| `CLERK_PUBLISHABLE_KEY` | var | obrigatório | GATE-05 |
| `CLERK_AUTHORIZED_PARTIES` | var | obrigatório | — |
| `CLERK_JWT_KEY` | secret | opcional | — |
| `META_APP_SECRET` / `META_VERIFY_TOKEN` / `META_TOKEN_SECRET` | secret | obrigatório para live | GATE-01/02 |
| `META_APP_ID` / `META_CONFIG_ID` | var | obrigatório para live | GATE-02 |
| `PIX_TOKEN_SECRET` | secret | obrigatório para sandbox/live | GATE-08 |
| `AI_GATEWAY_TOKEN` / `ANTHROPIC_API_KEY` | secret | se `AI_MODE=gateway` | GATE-06 |
| `VAPID_PRIVATE_KEY` | secret | se push live | — |
| `ATTACHMENT_TOKEN_SECRET` | secret | obrigatório | — |

- `.dev.vars.example` documenta auth e modos synthetic.
- Segredos reais entram só via `wrangler secret` / dashboard — **nunca** no git.
- Fixtures: `user_synth_*`, `clinic-demo-*`.

## Deploy controlado, migrations, smoke, rollback

### Pré-deploy

1. CI verde na branch.
2. `npm run check:env -- <staging|production>` — **bloqueia** placeholders.
3. Revisar migrações D1 novas (`db/migrations/`) e clinic (`src/clinic/migrations/`) em PR.
4. Confirmar inventário de secrets no ambiente alvo (`npm run ops:secrets`).

### Deploy (quando IDs reais existirem)

```bash
npm run check:env -- staging
npx wrangler d1 migrations apply tredane-staging --env staging   # após review
npx wrangler deploy --env staging
# smoke autenticado: GET /api/health + /api/f6/ops/smoke
```

**Em aberto:** execução destes comandos contra conta Cloudflare do projecto (não corridos neste PR).

### Smoke

| Check | Como |
| --- | --- |
| Health | `GET /api/health` → `observability: true` |
| Checklist local | `npm run ops:smoke` |
| Schema A/B | `GET /api/f6/ops/smoke` (auth) |
| Carga sintética | `POST /api/f6/ops/load` |
| Isolamento recovery | `POST /api/f6/ops/recovery/rehearse` |

### Rollback

1. Redeploy / `wrangler rollback` da versão Worker anterior.
2. Migração D1 já aplicada: preferir forward-fix; rollback SQL só com revisão explícita ([runbooks/recovery.md](runbooks/recovery.md)).
3. Não reprocessar DLQ às cegas ([runbooks/reprocess.md](runbooks/reprocess.md)).

## Observabilidade (#44)

Detalhe: [f6-ops.md](f6-ops.md) e [runbooks/](runbooks/README.md).

- Logs JSON com correlação; scrub de PII em `src/ops/log.ts`.
- Alertas Propostos: DLQ, outbox, status incerto, Meta/Pix/IA, revogação, purge, schema.
- Retenção/acesso a logs: **Em aberto** (REQ-070).
- Budgets de latência/custo: **Propostos** até medição live.

## O que ainda não está provisionado

Criação remota de D1/R2/Queues/DO namespaces, contas Meta/Clerk e revisão jurídica permanecem gates (#18/#44). Este documento fixa **nomes, guards e runbooks** para a implementação não divergir entre ambientes.

## Agendamento automático pela IA (`AI_AUTOBOOK`) — S2 (#173)

**Estado no código:** texto livre («sim», emoji, pedido completo, JSON) **nunca** cria compromisso, em nenhum ambiente e qualquer que seja a flag. A leitura do texto só gera nota à atendente. Propostas versionadas (S3 #174), envio do botão WhatsApp (S4 #175) e clique→marcação/Pix (S5 #176, DEC-061 **Decidido**) estão no código. O efeito transacional do botão **Confirmar** só corre quando a capacidade está ligada para o tenant (`AI_AUTOBOOK=on` + lista); texto continua a não marcar mesmo com a flag ligada. `AI_AUTOBOOK` permanece desligado por padrão (fail-closed).

| Variável | Valor | Efeito |
| --- | --- | --- |
| `AI_AUTOBOOK` | ausente, vazio, `off` ou qualquer valor ≠ `on` | Capacidade desligada (padrão) |
| `AI_AUTOBOOK` | `on` (exato, sem distinção de maiúsculas) | Capacidade ligada **só** para as clínicas de `AI_AUTOBOOK_TENANTS` |
| `AI_AUTOBOOK_TENANTS` | ids de tenant separados por vírgula | Lista de clínicas autorizadas; vazio = nenhuma |

| Ambiente | Estado esperado |
| --- | --- |
| development / staging / production | Desligado (sem `AI_AUTOBOOK=on`). Revisão da configuração publicada é gate de liberação (S9 #180, H10 #167). |

- O opt-in de sugestões da clínica (assistência de IA) é independente: ligá-lo não liga agendamento nem envio.
- A capacidade é relida na execução de cada job de rascunho (inclusive jobs já enfileirados); erro → negado.
- Contato bloqueado (e, quando existir, conversa/contato em pausa — TODO #182) nega qualquer ação automática nova (`src/clinic/ai/protection.ts`).
- **Interrupção:** remover `AI_AUTOBOOK` ou defini-lo diferente de `on` e republicar; efeito no próximo job. Relação com H1 (#158): esta é a contenção permanente por padrão; H1 continua a cobrir o kill switch.

## AI Gateway — logs e cache (S8 / #179)

**Expectativa efectiva no código** (DEC-011; inventário [ai-context-minimization.md](../security/ai-context-minimization.md)):

| Header / controlo | Valor | Motivo |
| --- | --- | --- |
| `cf-aig-collect-log-payload` | `false` | Não gravar corpos de prompt/resposta nos logs do Gateway (default Cloudflare é `true`) |
| `cf-aig-skip-cache` | `true` | Respostas personalizadas por conversa não devem ser servidas de cache |

**Dashboard do gateway (por ambiente):** cache de respostas **desligado** (default Cloudflare); logging de payload alinhado ao header. **Em aberto (GATE-06):** evidência de captura de ecrã / API de que o gateway em staging/produção não retém payloads; confirmação contratual Anthropic / ZDR. Logs internos do Worker (`ai.generated`) usam só IDs e métricas, sem texto de conversa.
