# Plano de implementação — Tredane MVP

**Estado:** plano de engenharia **Proposto** (decomposição/ordem), alinhado a decisões **Confirmadas** em [MVP](../MVP.md) / [decisões](../product/decisions.md). A execução do sistema segue o [épico #14](https://github.com/intentzero/tredane/issues/14) e as issues #15–#45; este documento **não** renumera DEC/REQ e **não** declara módulos de negócio implementados.

**F0 (baseline):** scaffold + lockfile + CI + prova visual local ([PR #47](https://github.com/intentzero/tredane/pull/47), issue #3); ambientes, fixtures com memberships, harness Cloudflare e checks de design na issue [#15](https://github.com/intentzero/tredane/issues/15) ([f0.md](f0.md), [environments.md](environments.md)). Encerramento formal da #3 depende da confirmação humana da evidência visual. Prova de componentes (DEC-041 / [#16](https://github.com/intentzero/tredane/issues/16)); biblioteca-base **Confirmada** em DEC-048 (React Aria; [ADR-0013](../adr/0013-design-system-components.md)). Pix simulado = [#17](https://github.com/intentzero/tredane/issues/17). **F1 parcial:** D1 admin [#19](f1-admin-d1.md); Clinic DO [#20](f1-clinic-do.md); Clerk HTTP [#21](f1-clerk-auth.md); login/nav UI [#22](f1-login-nav.md); WS/revogação [#23](f1-realtime-ws.md); Platform Admin [#24](f1-platform-admin.md); biblioteca Confirmada DEC-048.

## Sequência por fatias verificáveis

| Fase | Entregáveis | Gate verificável |
| --- | --- | --- |
| F0: ambiente | Workspace TS, React, Worker/Hono, Drizzle/D1 local, lint/test/runtime/build, Wrangler, CI, seeds sintéticas com memberships, contratos dev/staging/prod ([environments.md](environments.md)); harness DO/SQLite/WS/R2/Queue; `check_contrast`/`check_mocks` no CI. Base de UI: prova #16 + DEC-048 React Aria Confirmado ([ADR-0013](../adr/0013-design-system-components.md)); Pix = #17 | `npm ci` + `npm run verify`; dois tenants + memberships; nenhum segredo versionado; placeholders de staging/prod bloqueados |
| F1: identidade/tenant | D1 administrativo (#19), DO + SQLite por clínica (#20), login/memberships Clerk (#21), WebSocket/reconciliação/revogação (#23); login UI (#22) | REQ-001/002/003: ID forjado e revogação não expõem dados/eventos de outra clínica |
| F2: domínio local | Serviços/recursos/horários (#28 / [f2-clinic-config.md](f2-clinic-config.md)), contactos/Inbox (#29 / [f2-inbox.md](f2-inbox.md)), Acompanhamento (#30 / [f2-pipeline.md](f2-pipeline.md)) com dados sintéticos; CRUD mínimo + auditoria | Duas sessões da mesma clínica convergem e outra clínica não vê alterações |
| F3: integração Meta | Associação verificada de número de teste ([#31](f3-whatsapp-connection.md)), webhooks/fila/dedup ([#32](f3-whatsapp-webhooks.md)), envio manual e status (#33) | Reentrega não duplica; falhas e resultado incerto permanecem observáveis |
| F4: reservas | Consulta de disponibilidade, bloqueios, criação/cancelamento/reagendamento atómicos | Disputa concorrente por profissional e sala permite no máximo um compromisso |
| F5: IA assistiva | Sugestão de texto e resumo com revisão humana, política de contexto, fallback | Nenhuma sugestão é enviada sem clique humano; casos sensíveis são tratados adequadamente |
| F6: piloto | Testes ponta a ponta, monitorização, consentimentos, retenção e revisão de segurança | Aprovação das questões pendentes e de cenários da clínica piloto antes de dados reais |

## F1 — decisões adicionais confirmadas

- **Clerk** para autenticação/sessões, sem Organizations.
- **Memberships N:N no D1** para usuários com acesso a mais de uma clínica, com roles específicas.
- **Delegação confirmada:** superadmin provisiona owners; owner convida/remove attendants do próprio tenant. Convites HTTP + e-mail simulado = [#25](https://github.com/intentzero/tredane/issues/25) / [f1-team-invites.md](f1-team-invites.md); revogação HTTP/WS = [#23](https://github.com/intentzero/tredane/issues/23). Pedidos de suporte + aprovação owner = [#26](https://github.com/intentzero/tredane/issues/26) / [f1-support-requests.md](f1-support-requests.md); ativação de sessão/TTL/encerramento = [#27](https://github.com/intentzero/tredane/issues/27) / [f1-support-session.md](f1-support-session.md).
- **Platform Admin interna** com autorização no backend por `privateMetadata.superadmin === true` booleano, capaz de criar, editar, suspender, reativar e iniciar exclusão lógica de tenants.
- **Impersonação própria (DEC-029):** pedido de suporte não concede acesso; sessão ativa no D1 somente após aprovação de owner da clínica. Auditoria vincula actor, subject, owner aprovador, tenant, motivo e escopo; sem impersonação do Clerk. Permissões resultam da role do alvo e limites adicionais, com auditoria dupla.

**Ordem proposta:** integrar Clerk → memberships e seletor de tenant → API Platform Admin → sessões próprias de suporte, com TTL/revogação e banner → validar segurança, dados pessoais e eventos WebSocket, sem MFA no MVP. Ver [ADR-0006](../adr/0006-clerk-platform-admin.md) e [ADR-0007](../adr/0007-support-impersonation.md).

**Convite por e-mail confirmado (DEC-021):** registar convite de attendant no D1, emitir link de uso único, enviar e-mail, validar destinatário autenticado no Clerk por e-mail verificado e consumir convite + ativar membership atomicamente. Cobrir testes de replay, mudança de tenant, role e múltiplos memberships. **DEC-022:** prazo fixo de 7 dias (168 horas), com teste de limite em `expires_at` no backend. **DEC-023:** implementar reenvio com novo token e nova validade de 7 dias, invalidação atómica do link anterior, auditoria, proteção contra envios excessivos e testes de concorrência/replay. **DEC-024 fixa limites:** cooldown 10 minutos e 5 reenvios por janela móvel de 24 horas por tenant/e-mail. O Worker deve aplicar limite antes da rotação do token, com registos de uso resistentes a corrida. Adicionar testes de sexto reenvio, fronteira de 10 minutos, 24 horas e concorrência. **DEC-025:** endpoint de cancelamento de convites pending por qualquer owner do tenant, invalidação imediata e auditoria, testando concorrência com aceite/reenvio e impedimento cross-tenant.

**DEC-028 — MVP sem MFA:** excluir configuração, enrollment e guards MFA do escopo F1. Manter Clerk login/sessão, middleware de flag superadmin, memberships/roles D1, segurança da sessão própria de suporte, auditoria, TTL e CSRF. Priorizar testes de autorização e revogação, sem MFA. Revisitar só depois do MVP.

**DEC-029 — aprovação antes do suporte:** implementar pedidos pendentes, aprovação/rejeição por owner tenant-scoped, nenhum handoff/HTTP/WebSocket antes da aprovação, auditoria e vinculação actor/subject/owner/aprovação/escopo. Testar concorrência, reuso, revogação, owners de outros tenants e permissões. Canal confirmado em DEC-030 (painel em tempo real + e-mail informativo, decisão autenticada no painel); validade do pedido fixada em **24 horas** (DEC-031); TTL da sessão fixado em 30 minutos (DEC-032). [ADR-0011](../adr/0011-owner-approval-for-support.md).

**DEC-030 — painel e e-mail para suporte:** publicar pedido persistido no D1 em tempo real para owners ativos do tenant e enviar e-mail com link não privilegiado para a solicitação. Aprovação ou rejeição exclusivamente na Clinic App após login Clerk, verificação server-side owner e decisão atómica, auditada. Testar owners offline, e-mail falhado/duplicado, link sem login, isolamento de eventos, decisão simultânea e recuperação após reconexão. Provedor de e-mail pendente; validade do pedido de 24 horas aprovada (DEC-031).

**DEC-031 — pedido de suporte expira em 24h:** armazenar `created_at`/`expires_at` server-side UTC no D1; bloquear aprovação se `now >= expires_at` com decisão atómica mesmo sem job de expiração. Testar competição de decisão, envio de e-mail tardio, relógio cliente falsificado, novo pedido após expiração e nenhuma ativação indevida; TTL da sessão definido como 30 minutos (DEC-032); continuação via novo pedido e aprovação confirmada em DEC-033.

**DEC-032 — duração do suporte:** criar `activated_at` e `expires_at = activated_at + 30 minutos` em D1 quando o owner aprovar. Implementar expiração server-side, corte de HTTP/DO-WebSocket no limite mesmo após hibernação, revogação manual auditada e UI de sessão expirada; testar clocks, fan-out em corrida e ausência de limpeza agendada. Handoff e atividade não estendem prazo. Continuação definida em DEC-033: nova solicitação e aprovação.

**DEC-033 — continuação do suporte:** não implementar extensão de sessão nem alterar `expires_at` de sessão ativa/expirada. Exigir novo pedido de 24 horas, nova aprovação no painel por owner e nova sessão de 30 minutos com credenciais/auditoria próprias. Testar replay da aprovação anterior, handoff/cookie expirados, tentativa de API `extend`, WebSocket antigo e isolamento multi-tenant.

**DEC-034 — revogação por owner:** UI de sessão de suporte em curso na Clinic App com botão **Encerrar suporte** para qualquer owner vigente do tenant, mesmo se outro owner aprovou. Superadmin actor também pode encerrar voluntariamente a sua. Implementar transição atómica no D1, auditoria de revogador/sessão/tenant/instante, invalidação de cookie/handoff e corte de HTTP/DO-WebSocket, com proteção de fan-out. Testar O1/O2, owner B, attendant, superadmin não actor, races, sockets hibernados e falha de notificação DO.

**DEC-035 — alertas do ciclo do suporte:** emitir e-mail de **início somente após `support_sessions.status=active`**, separado do pedido pendente; enviar a owners ativos do tenant, com idempotência por sessão/destinatário e sem PHI/segredos. Atualizar painel em tempo real no início e em todos os tipos de encerramento; **nenhum e-mail no término**. Persistir auditoria e reidratar estado após reconexão. Testar retrials/duplicatas de e-mail, canal indisponível, tenant errado, expiração normal, revogação por owner e término voluntário do superadmin. Fornecedor/transporte pendentes.

**DEC-036 — aviso de suporte ao subject:** durante sessão `active`, owners veem acompanhamento completo; subject representado vê aviso específico na sua Clinic App, usando sua **sessão Clerk própria**, sem alteração de identidade ou privilégios. Filtrar push DO/WebSocket por tenant + subject, sem broadcast a outros attendants; reconciliar após reconexão/hibernação e remover estado ativo ao término. Sem e-mail adicional ao subject (DEC-035), sem botão de aprovação/revogação do subject. Testar duas clínicas/duas abas, subject owner, attendants distintos e estado stale ao expirar.

**DEC-037 — pedir encerramento sem revogação direta:** adicionar ação **Solicitar encerramento** ao banner do subject, API Clerk/tenant/subject verificada no Worker, registro D1 e auditoria de pedido, evento DO/WebSocket restrito aos owners. Owners decidem **Encerrar** (DEC-034) ou **Manter**, com decisão auditada e status para o subject; pedidos repetidos pendentes idempotentes. Sem pausar/estender sessão de 30 minutos enquanto aguarda. Testar outro attendant, outra clínica, sessão expirada, múltiplos owners, duplo clique, reconexão e fim natural. Prazo de resposta owner ainda por decidir.

## DEC-038 — persistência operacional por clínica

**Confirmado:** [ADR-0012](../adr/0012-clinic-durable-object-sqlite.md). D1 central para administração/memberships/convites/suporte; um DO + SQLite por clínica para domínio operacional, histórico/outbox e WebSockets; R2 para anexos. Não executar migrações remotas nesta alteração.

- **F1:** classe/namespace SQLite e roteamento autorizado + runner SQL por instância — [#20](f1-clinic-do.md). Migrations D1 centrais — [#19](f1-admin-d1.md). Clerk HTTP + authz tenant — [#21](f1-clerk-auth.md). Barreira de revogação D1/DO/WS ainda pendente (#23).
- **F2:** entidades operacionais e histórico/outbox no SQLite correto; duas clínicas sintéticas e reconexão/hibernação sem vazamento. Adaptar ORM/repositórios ao backend.
- **F3:** deduplicação/outbox local, efeitos externos fora de transação, resultados devolvidos ao DO correto; contrato de resolução de integração e reconciliação.
- **F4:** transação SQLite para reserva e alocações; prova de concorrência, rollback e manutenção da reserva original em falha de remarcação.
- **Antes de F6/dados reais:** ensaio de recuperação por clínica com D1/R2/filas/provedor, sem reativar permissões ou repetir mensagens; medir capacidade e observar latência/armazenamento. Relatórios globais via agregados são possibilidade futura, não módulo aprovado.

F0 mantém seu histórico de scaffold D1/Drizzle; não reescrever migrações já aplicadas. Adaptação ainda não implementada.

## Backlog técnico por épico

### EP-T01 — Base de execução e CI
- Monorepo pequeno ou workspace com apps/web, apps/api e packages/shared (escolha de organização proposta).
- Scripts dev/test/typecheck/build e D1 local; migrações Drizzle testáveis.
- Ambientes dev/staging/prod separados e .dev.vars.example sem credenciais.
- Testes de schema/migrations, fixtures sintéticas e pipeline de validação.

### EP-T02 — Segurança e tenancy
- Middleware de identidade e associação por tenant; principal humano vs integração verificada.
- APIs para superadmin gerir owners e owner gerir attendants, com negação de promoção indevida ou alteração cross-tenant.
- DEC-038: repositórios administrativos D1 escopados e dados operacionais no SQLite por DO; validar roteamento, referências locais e memberships centrais sem FKs entre stores. Testar leitura/escrita cruzada e autorização em RPC/filas.
- **DEC-026 — revogação por tenant:** o owner remove attendant de A e o D1 regista revogação + auditoria; API verifica membership por request; invalidar WebSockets DO de A com proteção de fan-out e hibernação, e negar sessões de suporte com subject revogado. **Não revogar Clerk session nem tenants B.** Implementar casos de teste de corrida entre revogação e publicação, cache positivo obsoleto, retomada após hibernação e falha de notificação.
- Revogação de membro, sessão e WebSocket, com auditoria.
- R2 privado e controlo de acesso para anexos quando a política de dados estiver fechada.

### EP-T03 — Inbox e Pipeline
- Contactos/conversas/mensagens/oportunidades separados e eventos de histórico.
- Inbox partilhada com responsáveis; atualização de estado via WebSocket.
- Kanban com etapas propostas e auditoria; sem automações de IA em estados comerciais.

### EP-T04 — WhatsApp oficial
- Verificação de webhook e associação de canal/tenant.
- Inbox de eventos idempotente, Queue + DLQ; outbox de mensagens com reconciliation em resultados incertos.
- Modelos WhatsApp, política de janela de atendimento e custos por mensagem em aberto para confirmação antes de envio real.

### EP-T05 — Agenda e consistência
- Serviços, profissionais, salas/equipamentos, disponibilidade e bloqueios.
- Prova de conceito das garantias atómicas no SQLite do DO (não D1 batch); confirmar duração/buffers no piloto.
- Reagendamento sem libertar compromisso antigo até nova confirmação; eventos pós-commit.

### EP-T06 — IA e qualidade
- Provedor intercambiável, contexto mínimo autorizado e sugestão editável.
- Testes de segurança, recuperação de falhas e avaliação de respostas em português brasileiro.
- Registro de revisão humana e observabilidade de custo/latência.

## Critérios de pronto comuns a todos os épicos

1. Requisitos relacionados e testes de aceite referenciados no PR.
2. Autorização por tenant em leituras, escritas, eventos e anexos; logs sem PII excessiva.
3. Sem segredo no repo; testes e typecheck executam no CI.
4. Falhas transientes e duplicação de eventos exercitadas onde aplicável.
5. Documentação atualizada (MVP resumido, ADR quando decisão for aceite e migração versionada).

## Dependências que bloqueiam dados reais

Identidade e administração de utilizadores (DEC-007), regras de recurso/agenda (DEC-008), WhatsApp da clínica (DEC-009), validação técnica da topologia confirmada DEC-038 (resolve DEC-010), política de dados e provedor IA (DEC-011), suporte/operador (DEC-012). O épico [#1](https://github.com/intentzero/tredane/issues/1) permanece aberto até validação do produto.

## Primeira tarefa recomendada

O scaffold F0 (histórico EP-T01 / issue #3) já está na main. A execução atual começa por [#15](https://github.com/intentzero/tredane/issues/15) no [épico #14](https://github.com/intentzero/tredane/issues/14), **sem** reconstruir o scaffold e **sem** integrar contas reais. Em seguida: #16 (UI), #17 (Pix), #18 (liberações) e F1 (#19+#20) em frentes independentes.
