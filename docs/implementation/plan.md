# Plano de implementação — Tredane MVP

**Estado:** plano proposto para engenharia, baseado em [MVP](../MVP.md), [requisitos](../product/requirements.md), [critérios](../product/acceptance.md) e [arquitetura](../architecture/overview.md). Nenhuma etapa abaixo está marcada como construída.

## Sequência por fatias verificáveis

| Fase | Entregáveis | Gate verificável |
| --- | --- | --- |
| F0: ambiente | Workspace TS, React, Worker/Hono, Drizzle/D1 local, lint/test/build, Wrangler, CI, seeds sintéticas; base de UI: `tokens.css`, catálogo de componentes, prova de conceito da biblioteca de componentes ([ADR-0007](../adr/0007-design-system-components.md)), `check_contrast` e `check_mocks` no CI | Testes e build reproduzíveis; dois tenants de teste; nenhum segredo versionado |
| F1: identidade/tenant | Bindings gerados no deploy para o D1 por clínica, com medição do limite e do tempo de ativação (ADR-0002); D1 central; integração com o Clerk; associações e seletor de clínica; provisionamento de clínica; app de superadmin mínimo; autorização no Worker; WebSocket autorizado no DO da clínica | REQ-001/002/003/005/006/080: ID forjado, troca de clínica e revogação não expõem dados/eventos de outra clínica nem abrem seu D1 |
| F2: domínio local | Serviços, recursos, horários, contactos, Inbox e Pipeline com dados sintéticos; CRUD mínimo + auditoria | Duas sessões da mesma clínica convergem e outra clínica não vê alterações |
| F3: integração Meta | Associação verificada de número de teste, webhooks, deduplicação, outbox, envio manual e status | Reentrega não duplica; falhas e resultado incerto permanecem observáveis |
| F4: reservas | Consulta de disponibilidade, bloqueios, criação/cancelamento/reagendamento atómicos | Disputa concorrente por profissional e sala permite no máximo um compromisso |
| F5: IA assistiva | Adaptador Claude via AI Gateway sem registro de conteúdo; sugestão e resumo com revisão humana; contexto de REQ-060; fallback | Nenhuma sugestão é enviada sem clique humano; casos sensíveis são tratados adequadamente |
| F6: piloto | Testes ponta a ponta, monitorização, consentimentos, retenção e revisão de segurança | Aprovação das questões pendentes e de cenários da clínica piloto antes de dados reais |

## Backlog técnico por épico

### EP-T01 — Base de execução e CI
- Monorepo pequeno ou workspace com apps/web, apps/api e packages/shared (escolha de organização proposta).
- Scripts dev/test/typecheck/build e D1 local; migrações Drizzle testáveis.
- Ambientes dev/staging/prod separados e .dev.vars.example sem credenciais.
- Testes de schema/migrations, fixtures sintéticas e pipeline de validação.

### EP-T02 — Segurança e tenancy
- Middleware de identidade e associação por tenant; principal humano, superadmin e integração verificada.
- Resolução clínica → D1 a partir do D1 central; repositórios escopados e FKs compostas no D1 da clínica; testes automáticos de leitura/escrita cruzada e de abertura do banco errado.
- Migrações aplicadas a todos os D1 de clínica com registro de versão por clínica.
- Revogação de membro, sessão e WebSocket, com auditoria.
- R2 privado e controlo de acesso para anexos quando a política de dados estiver fechada.

### EP-T03 — Inbox e Pipeline
- Contactos/conversas/mensagens/oportunidades separados e eventos de histórico.
- Inbox partilhada com responsáveis; atualização de estado via WebSocket.
- Kanban com etapas propostas e auditoria; sem automações de IA em estados comerciais.

### EP-T04 — WhatsApp oficial
- Verificação de webhook e associação de canal/tenant.
- Inbox de eventos idempotente, Queue + DLQ; outbox de mensagens com reconciliation em resultados incertos.
- Janela de 24 h: texto livre bloqueado fora dela e envio por modelo aprovado (DEC-018). Modelos a cadastrar e custos por mensagem em aberto para confirmação antes de envio real.

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

Decididos em 23/10/2026: DEC-005, DEC-007 a DEC-010 e, em parte, DEC-011. Ainda bloqueiam dados reais: mecanismo do D1 por clínica (ADR-0002), verificação como Tech Provider (DEC-009), revisão jurídica e não retenção da IA (DEC-011) e custo e residência de dados do Clerk (DEC-007, DEC-012). O épico [#1](https://github.com/intentzero/tredane/issues/1) permanece aberto até validação do produto.

## Primeira tarefa recomendada

Abrir EP-T01 como primeiro épico de engenharia e criar scaffold + CI **sem integrar contas reais**. O checkpoint do sprint é demonstrar, com dois tenants fictícios, os elementos básicos de autenticação, persistência e atualização entre sessões.
