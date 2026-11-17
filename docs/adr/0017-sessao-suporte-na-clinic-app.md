# ADR-0017 — Como a Clinic App aceita uma sessão de suporte

- **Estado:** **Direção Confirmada** (Paulo, 17/11/2026, «Aprovada»; DEC-195), ao planear a [#853](https://github.com/intentzero/tredane/issues/853). **Respostas do Paulo (17/11/2026): Q-SUP-01 = ler conversas; Q-SUP-02 = sim, auditar leituras; Q-SUP-03 = sim, interruptor ligado em staging.** **Q-SUP-04 = a sugestão de três camadas (revisão independente, testes adversariais na CI, pen-test curto) e a lista de verificação assinada: Confirmada pelo Paulo em 17/11/2026 («Aprovo»)**; **quem** faz a revisão e o pen-test: o mesmo colega de confiança (ver tabela). **Ainda bloqueiam a ligação em produção:** executar as três camadas, base legal e retenção (VAL-09, #43) e a lista assinada. As duas consequências de Q-SUP-01 (dados pessoais; telefone mascarado) também foram aprovadas. O PR 1 (porte para o D1) e o PR 2 (overlay) estão entregues; o PR 4 e o PR 5 estão em revisão. Revê e concretiza o «Fluxo técnico proposto» da [ADR-0007](0007-support-impersonation.md), cujos pontos de cookie, CSRF e handoff «devem passar por revisão de segurança antes do deployment real».
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
1. **Entregue** ([#860](https://github.com/intentzero/tredane/pull/860)): D1 do ciclo de vida (§6) e do pedido de cancelamento da superadmin, com testes de concorrência e de handoff único.
2. **Entregue** ([#863](https://github.com/intentzero/tredane/pull/863)): overlay em `requireTenantAccess` (`TenantContext.support`) + lista de leitura + testes de isolamento entre clínicas e de «escrita bloqueada» (§1 e §2), atrás do interruptor. Rotas lidas (só GET): `context`, `inbox/conversations`, `inbox/conversations/:id`, `inbox/contacts`, `inbox/contacts/:id`; permissões `clinic.context.read` e `clinic.inbox.read`. Cookie `Path=/api; HttpOnly; Secure; SameSite=Strict`. Telefones mascarados (últimos 4 dígitos) e `support.access` agregado por sessão/rota/minuto; **desde a #882**, as leituras de detalhe (`inbox/conversations/:id` e `inbox/contacts/:id`) registam também o tipo e o **id** da conversa ou do contato (nunca texto), numa entrada por (sessão, alvo, minuto), para responder a «quem viu esta conversa». A lista não tem alvo. **Limites:** números no texto livre das mensagens não são mascarados; pipeline, agenda e config continuam bloqueados até haver permissões de leitura próprias; CI deve validar os caminhos D1.
2b. **Entregue** ([#865](https://github.com/intentzero/tredane/pull/865), PR 1b): pedido de término do subject, decisão da owner (manter ou encerrar), lista e aviso no D1, com testes de corrida. A auditoria não é atómica com a transição (sem transações interativas no D1).
3. **Entregue** ([#867](https://github.com/intentzero/tredane/pull/867)): Clinic App com vista própria só de leitura (só Conversas), banner permanente com contagem decrescente, «Encerrar sessão» e ecrã de fim; mock em `docs/design/desktop/SuporteVista*`. Limite: as áreas Clientes, Agenda, Pipeline e Clínica não existem em suporte.
4. **Em revisão** ([#877](https://github.com/intentzero/tredane/pull/877)): bilhete WebSocket de suporte (só leitura, preso à sessão), entrega só de sinais sem payload e fence por sessão que não corta o subject real. Limite: sem alarme no Durable Object, uma ligação parada só cai na próxima entrega.
5. **Em revisão** ([#878](https://github.com/intentzero/tredane/pull/878)): Platform Admin com «Entrar», «Abrir», «Encerrar» e «Cancelar pedido»; a nota da #854 sai.

## Perguntas para o Paulo
| ID | Pergunta | Opções | Bloqueia |
| --- | --- | --- | --- |
| Q-SUP-01 | O suporte lê **conversas de clientes** (`clinic.inbox.read`) ou só diagnóstico? | **Resolvida (Paulo): (b) lê conversas**, com a aprovação da owner a cada sessão (DEC-029) | — (ver «Consequência de Q-SUP-01») |
| Q-SUP-02 | Auditar cada leitura de conteúdo (`support.access`)? | **Resolvida (Paulo): (a) sim**, agregada por rota e por minuto | — |
| Q-SUP-03 | O interruptor liga em **staging** já, e em produção só após revisão de segurança? | **Resolvida (Paulo): (a) sim** | — |
| Q-SUP-04 | Quem faz a revisão de segurança e o pen-test exigidos pela ADR-0007 antes de produção? | **Estrutura confirmada** (Paulo, 17/11/2026): as três camadas da sugestão abaixo. **Nomes confirmados** (Paulo, 17/11/2026): a revisão independente e o pen-test curto são feitos pelo mesmo colega de confiança (a independência entre as duas camadas fica menor do que a recomendada, que era um freelancer externo no pen-test; registar na lista de verificação assinada). **Base legal e retenção (VAL-09, #43):** o Paulo define e documenta — ainda pendente e a bloquear a ligação em produção. | ligar em produção |

## Consequência de Q-SUP-01: o suporte passa a ler dados pessoais de clientes
Ler conversas é o caso de maior risco desta ADR. O que muda (**Confirmado** pelo Paulo, 17/11/2026, «Aprovo»):
- `SUPPORT_READ_PERMISSIONS` inclui `clinic.inbox.read` e a leitura de contactos e do funil; **continua sem nenhuma escrita** e sem `clinic.contacts.delete`.
- O aviso ao subject (DEC-036) e o e-mail às owners (DEC-035) passam a dizer que a sessão **pode ler conversas de clientes**.
- A sessão de suporte **não vê o telefone completo** das clientes, como a Platform Admin já faz nas amostras (#857): só os 4 últimos dígitos. Q-SUP-05 **Resolvida** (Paulo, 17/11/2026): o suporte não precisa do número inteiro; ficam os 4 últimos dígitos. Os números escritos no texto livre das mensagens continuam sem máscara: limite conhecido a declarar na base legal.
- Fica a **base legal e a política de retenção** (VAL-09, #43), que o MVP já marca como «em aberto antes de dados reais». Esta decisão torna-as um **requisito para ligar em produção**, não um extra.

## Sugestão para Q-SUP-04 (Claude; **aprovada** pelo Paulo, 17/11/2026)
Como a equipa é pequena, proponho **três camadas, por esta ordem**, e **produção só liga depois das três**:
1. **Revisão independente do desenho e do código** por uma pessoa que não escreveu nada disto (colega, ou consultor de segurança por 1 a 2 dias), com esta ADR e o PR 2 como material. O foco é o overlay do `resolveTenantContext`, o isolamento entre clínicas e o bloqueio de escrita.
2. **Testes adversariais automáticos escritos no PR 2**, que correm sempre na CI: cookie de outra clínica, cookie de outra sessão Clerk, sessão expirada ou revogada a meio, subject sem membership, tenant suspenso, flag do actor retirada, tentativa de cada rota de escrita, WebSocket depois da revogação. Isto já é trabalho de engenharia e não custa extra.
3. **Pen-test curto e pontual** (2 a 3 dias, externo) só sobre as superfícies novas: handoff, cookie, overlay e WebSocket de suporte. Pode ser um freelancer de segurança de aplicações; não precisa de uma auditoria geral.

Antes de ligar: **lista de verificação assinada pelo Paulo** (as três camadas feitas, base legal e retenção definidas, textos de aviso revistos, interruptor ligado primeiro só numa clínica de teste). Alternativa mais barata e mais fraca: só as camadas 1 e 2 e ligar para **uma clínica piloto** com a owner informada por escrito; **não recomendo**, por causa da leitura de conversas.

## Fora do âmbito
Escrita em nome do subject (continua bloqueada até política explícita), extensão de sessão (DEC-033), MFA (DEC-028) e acesso de suporte a mais de uma clínica por sessão.
