# ADR-0017 — Como a Clinic App aceita uma sessão de suporte

- **Estado:** **Direção Confirmada** (Paulo, 17/11/2026, «Aprovada»; DEC-195), ao planear a [#853](https://github.com/intentzero/tredane/issues/853). **As perguntas Q-SUP-01 a Q-SUP-04 continuam em aberto**: o PR 1 (porte para o D1) não depende delas; Q-SUP-01 e Q-SUP-02 bloqueiam o PR 2, Q-SUP-03 o PR 5 e Q-SUP-04 o uso em produção. Os valores «proposto» da tabela não são respostas. Revê e concretiza o «Fluxo técnico proposto» da [ADR-0007](0007-support-impersonation.md), cujos pontos de cookie, CSRF e handoff «devem passar por revisão de segurança antes do deployment real».
- **Relacionados:** [ADR-0006](0006-clerk-platform-admin.md), [ADR-0007](0007-support-impersonation.md), [ADR-0011](0011-owner-approval-for-support.md), [platform-admin.md](../product/platform-admin.md), DEC-029 a DEC-037.

## Problema (o que o código faz hoje)

1. **Nenhuma rota da Clinic App aceita uma sessão de suporte.** O cookie `tredane_support` só é lido por `GET /api/support/session`. As rotas do painel autenticam por `Authorization: Bearer` (Clerk) e autorizam por `requireTenantAccess`, que exige **membership real** do utilizador: um superadmin sem membership recebe 403 em tudo o que é de clínica (é o que garante «a flag não abre conteúdo», ADR-0006 §6).
2. **O ciclo só existe no store síncrono.** Ativar, trocar o handoff, ler a sessão, encerrar, revogar pela owner e o pedido de fim a pedido do subject respondem **503 `support_session_sync_required` no D1 de produção**. Só criar, ler, listar e decidir pedidos têm versão D1.
3. Por isso hoje **não é possível entrar**: a Platform Admin só pede e lista (#854).

## Proposta

### 1. Um overlay no contexto de tenant, não um caminho de autenticação novo
`resolveTenantContext` (o ponto único que `requireTenantAccess` usa) ganha um passo **antes** do membership: se o pedido traz o cookie de suporte **e** o `:tenantId` da rota coincide com o tenant da sessão, carrega a sessão e devolve `TenantContext { role: <papel atual do subject>, support: { sessionId, actorClerkUserId, subjectClerkUserId, expiresAt } }`. Sem cookie, nada muda. Um cookie de **outro** tenant é recusado (403 `support_tenant_mismatch`), nunca ignorado em silêncio.
- A sessão só vale se **todas** as condições do ADR-0007 §4 se verificarem **no pedido atual**: Bearer Clerk do **actor**, `privateMetadata.superadmin === true` agora, `actor_clerk_session_id` igual ao do Bearer, hash do cookie igual ao do D1, `status = 'active'`, `now < expires_at`, tenant `active`, membership do subject ainda ativo. Qualquer falha → 403 e o cookie é limpo.
- **Rotas que não passam por `requireTenantAccess` continuam a exigir membership real**: o overlay não abre nada por omissão, só o que for ligado de propósito.

### 2. Permissões: o papel do subject **intersectado** com uma lista de leitura
`effectivePermissions = matriz(role do subject) ∩ SUPPORT_READ_PERMISSIONS`. Deny-by-default: tudo o que não está na lista de leitura responde 403 `support_write_blocked` (código que já existe). Lista inicial **proposta**: `clinic.context.read`, `clinic.inbox.read`, e leituras de pipeline e agenda **depois de as nomear** (hoje `clinic.pipeline.move` e `clinic.agenda.operate` são só de escrita e não há permissões de leitura separadas: **é preciso criá-las**; ver Q-SUP-01). `clinic.support.decide`, `clinic.members.*` e `clinic.config.write` ficam sempre fora, mesmo que o subject seja owner: **um suporte nunca aprova o seu próprio acesso nem mexe em membros**.

### 3. Cookie e CSRF
- `HttpOnly; Secure; SameSite=Strict; Path=/api` (hoje `Lax` e `Path=/`): só viaja em chamadas same-origin à API, nunca em navegações. A Platform Admin e a Clinic App são o **mesmo SPA e origem** (DEC-192), o que dispensa a ponte entre subdomínios que a ADR-0007 temia.
- As leituras são `GET`; os dois únicos pedidos que mudam estado (`handoff` e `end`) já exigem `Origin` em `authorizedParties` quando o transporte é cookie.
- O cookie é por origem, não por aba: duas abas partilham-no. A defesa é o tenant fixo na sessão (§1) e a Clinic App em modo suporte **não oferecer troca de clínica**.

### 4. WebSocket
O bilhete (`ws-ticket`) emitido em contexto de suporte é **só de leitura**, leva `supportSessionId` e expira com a sessão. A revogação/expiração fecha as ligações por **sessão** (hoje o fence é por utilizador e tenant: precisa de um fence por `supportSessionId`, para não cortar o subject real que esteja ligado ao mesmo tempo).

### 5. Clinic App
- `GET /api/support/session?tenantId=` decide se a app entra em modo suporte. **Banner permanente** («Modo suporte · [actor] atuando como [subject] · [clínica] · restam N min · Encerrar»), que a UI nunca esconde (ADR-0007 §6).
- Modo suporte: ações de escrita **ocultas ou desativadas com a frase do motivo**, sem seletor de clínica, sem notificações push nem som, e **sem cache do service worker** do conteúdo lido (o logout já limpa as caches, #42).
- Fim por prazo, revogação pela owner ou encerramento: ecrã «A sessão de suporte terminou» e regresso à Platform Admin. Sem renovação (DEC-033).

### 6. Porte para o D1
`activate`, `handoff`, `ler`, `encerrar`, `revogar` (owner) e `fim a pedido` sem transações interativas: `UPDATE … WHERE status = 'active'` com `changes = 1` como barreira de concorrência e `batch` para estado + auditoria. O handoff é de **uso único** (`handoff_hash` passa a `NULL` no mesmo `UPDATE` que o consome). A expiração é verificada em cada leitura pelo `expires_at`; não depende de um cron.

### 7. Interruptor
Uma variável `SUPPORT_SESSIONS_ENABLED`, **desligada por omissão em produção**: com ela desligada, `activate` e `handoff` respondem 404 `support_sessions_disabled` e a Platform Admin não mostra «Entrar». Liga-se primeiro em staging; em produção só depois da revisão de segurança e do pen-test que a ADR-0007 exige.

### 8. Auditoria
Cada sessão já audita pedido, aprovação, ativação, handoff, expiração e revogação (DEC-029–037). Proposta nova: **cada leitura de conteúdo em contexto de suporte grava `support.access`** (sessão, rota, clínica), agregada por rota e por minuto para não inundar a auditoria (Q-SUP-02).

## Fatiamento proposto (PRs pequenos, por ordem)
1. D1 do ciclo de vida (§6) e do pedido de cancelamento da superadmin, com testes de concorrência e de handoff único, ainda **sem** ninguém a consumir a sessão.
2. Overlay em `resolveTenantContext` + lista de leitura + testes de isolamento entre clínicas e de «escrita bloqueada» (§1 e §2), atrás do interruptor.
3. Clinic App: banner, modo só de leitura, fim da sessão (§5).
4. Bilhete WebSocket de leitura e fence por sessão (§4).
5. Platform Admin: «Entrar como…», «Encerrar», contador, «Cancelar pedido», com a nota da #854 a sair.

## Perguntas para o Paulo
| ID | Pergunta | Opções | Bloqueia |
| --- | --- | --- | --- |
| Q-SUP-01 | O suporte lê **conversas de clientes** (`clinic.inbox.read`) ou só diagnóstico (contagens, configuração, estado da agenda)? | (a) só diagnóstico no início; (b) também conversas, com a aprovação da owner (DEC-029) | PR 2 |
| Q-SUP-02 | Auditar cada leitura de conteúdo (`support.access`)? | (a) sim, agregada por rota e minuto (proposto); (b) só início e fim da sessão | PR 2 |
| Q-SUP-03 | O interruptor liga em **staging** já, e em produção só após revisão de segurança? | (a) sim (proposto); (b) nem em staging até à revisão | PR 5 |
| Q-SUP-04 | Quem faz a revisão de segurança e o pen-test exigidos pela ADR-0007 antes de produção? | a indicar | ligar em produção |

## Fora do âmbito
Escrita em nome do subject (continua bloqueada até política explícita), extensão de sessão (DEC-033), MFA (DEC-028) e acesso de suporte a mais de uma clínica por sessão.
