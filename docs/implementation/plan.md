# Plano de implementação — Tredane MVP

**Estado:** plano proposto para engenharia, baseado em [MVP](../MVP.md), [requisitos](../product/requirements.md), [critérios](../product/acceptance.md) e [arquitetura](../architecture/overview.md). A fundação F0 tem scaffold com lockfile e checks de CI; falta apenas revisão visual local humana antes de considerar o checkpoint F0 encerrado. As fases seguintes não foram implementadas.

## Sequência por fatias verificáveis

| Fase | Entregáveis | Gate verificável |
| --- | --- | --- |
| F0: ambiente | Workspace TS, React, Worker/Hono, Drizzle/D1 local, lint/test/build, Wrangler, CI, seeds sintéticas | Testes e build reproduzíveis; dois tenants de teste; nenhum segredo versionado |
| F1: identidade/tenant | Login e associação de membro; autorização no Worker; papéis do painel; integração WebSocket autorizada | REQ-001/002/003: ID forjado e revogação não expõem dados/eventos de outra clínica |
| F2: domínio local | Serviços, recursos, horários, contactos, Inbox e Pipeline com dados sintéticos; CRUD mínimo + auditoria | Duas sessões da mesma clínica convergem e outra clínica não vê alterações |
| F3: integração Meta | Associação verificada de número de teste, webhooks, deduplicação, outbox, envio manual e status | Reentrega não duplica; falhas e resultado incerto permanecem observáveis |
| F4: reservas | Consulta de disponibilidade, bloqueios, criação/cancelamento/reagendamento atómicos | Disputa concorrente por profissional e sala permite no máximo um compromisso |
| F5: IA assistiva | Sugestão de texto e resumo com revisão humana, política de contexto, fallback | Nenhuma sugestão é enviada sem clique humano; casos sensíveis são tratados adequadamente |
| F6: piloto | Testes ponta a ponta, monitorização, consentimentos, retenção e revisão de segurança | Aprovação das questões pendentes e de cenários da clínica piloto antes de dados reais |

## F1 — decisões adicionais confirmadas

- **Clerk** para autenticação/sessões, sem Organizations.
- **Memberships N:N no D1** para usuários com acesso a mais de uma clínica, com roles específicas.
- **Delegação confirmada:** superadmin provisiona owners; owner convida/remove attendants do próprio tenant. Convites/aceitação e revogação HTTP/WS ainda a definir.
- **Platform Admin interna** com autorização no backend por `privateMetadata.superadmin === true` booleano, capaz de criar, editar, suspender, reativar e iniciar exclusão lógica de tenants.
- **Impersonação própria do Tredane:** sessões de suporte no D1 ligam administrador real, membro alvo, clínica e motivo; sem funcionalidades de impersonação do Clerk. Permissões resultam da role do alvo e limites adicionais, com auditoria dupla.

**Ordem proposta:** integrar Clerk → memberships e seletor de tenant → API Platform Admin → sessões próprias de suporte, com TTL/revogação e banner → validar segurança, MFA, dados pessoais e eventos WebSocket. Ver [ADR-0006](../adr/0006-clerk-platform-admin.md) e [ADR-0007](../adr/0007-support-impersonation.md).

## Backlog técnico por épico

### EP-T01 — Base de execução e CI
- Monorepo pequeno ou workspace com apps/web, apps/api e packages/shared (escolha de organização proposta).
- Scripts dev/test/typecheck/build e D1 local; migrações Drizzle testáveis.
- Ambientes dev/staging/prod separados e .dev.vars.example sem credenciais.
- Testes de schema/migrations, fixtures sintéticas e pipeline de validação.

### EP-T02 — Segurança e tenancy
- Middleware de identidade e associação por tenant; principal humano vs integração verificada.
- APIs para superadmin gerir owners e owner gerir attendants, com negação de promoção indevida ou alteração cross-tenant.
- Repositórios D1 escopados e FKs compostas; testes automáticos de leitura/escrita cruzada.
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
- Prova de conceito das garantias atómicas no D1; confirmar duração/buffers no piloto.
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

Identidade e administração de utilizadores (DEC-007), regras de recurso/agenda (DEC-008), WhatsApp da clínica (DEC-009), decisão de topologia D1 (DEC-010), política de dados e provedor IA (DEC-011), suporte/operador (DEC-012). O épico [#1](https://github.com/intentzero/tredane/issues/1) permanece aberto até validação do produto.

## Primeira tarefa recomendada

Abrir EP-T01 como primeiro épico de engenharia e criar scaffold + CI **sem integrar contas reais**. O checkpoint do sprint é demonstrar, com dois tenants fictícios, os elementos básicos de autenticação, persistência e atualização entre sessões.
