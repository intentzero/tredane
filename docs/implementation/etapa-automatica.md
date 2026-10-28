# Etapa automática na conversa — plano de implementação

**Estado:** plano **Proposto** (28/10/2026). As decisões que o motivam estão **Confirmadas**: [DEC-062](../product/decisions.md) (a etapa muda sozinha), DEC-064 (um só «Agendar»), DEC-065 (folha do Pix) e DEC-066 (encerrar não move a etapa). Nada deste plano está implementado. Mocks: [M-02](../design/screens.md), M-40, M-45 a M-48.

## O que existe hoje (verificado no código)

| Peça | Onde | Observação |
| --- | --- | --- |
| Etapas | `src/clinic/constants.ts` (`OPPORTUNITY_STAGES`) | `novo_contato`, `em_atendimento`, `horario_proposto`, `agendado`, `concluido`, `perdido` |
| Mover etapa | `moveOpportunityStageOp` em `src/clinic/pipeline/operations.ts`; rota em `src/worker/clinic-do.ts`; gateway `src/pipeline/gateway.ts` | Grava histórico (`opportunity_stage_history`); nunca cria compromisso (DEC-040) |
| «Agendado» automático | `src/clinic/scheduling/booking.ts` e `holds.ts`; `src/clinic/pix/signal-charge.ts` | Já existe (DEC-052); o plano não o altera |
| Assumir / transferir | `assignConversationOp` em `src/clinic/inbox/operations.ts` | Não toca na etapa |
| Primeira resposta | `sendOutboundMessageOp` atribui a conversa a quem escreve se não houver responsável | Também não toca na etapa |
| Detalhe da conversa | `getConversationDetailOp`; tipo `InboxConversationDetail` em `src/client/panel/api.ts` | **Não traz a oportunidade nem a etapa** |
| Oportunidade da conversa | `findOpenOpportunityForConversation` em `src/clinic/pipeline/opportunities.ts` | Reutilizável para o detalhe |

## Lacunas

1. A tela de conversa não consegue mostrar a etapa (o detalhe não a devolve).
2. Nada move `novo_contato` → `em_atendimento` ao assumir ou ao responder pela primeira vez.
3. O menu ⋮ não tem «Corrigir etapa» nem «Marcar como perdida».

## Regras propostas (aplicam DEC-062 e DEC-066)

| Evento | Efeito na etapa |
| --- | --- |
| Alguém assume a conversa ou envia a primeira resposta | `novo_contato` → `em_atendimento`. Só avança a partir de `novo_contato`. |
| Compromisso confirmado | `agendado` (já implementado, DEC-052) |
| Transferir a conversa | Não altera |
| Encerrar a conversa | Não altera (DEC-066) |
| Cliente escreve de novo numa oportunidade já terminal | Segue a regra de ciclos existente (`maxCycleForConversation`); fora deste plano |
| Correção manual no ⋮ | **Horário proposto** e **Perdido**; qualquer etapa pode ser corrigida por quem atende |

Nunca retrocede sozinha: se a etapa já é `horario_proposto`, `agendado` ou terminal, assumir não a muda.

## Alterações por camada

**Backend (PR 1)**
- `getConversationDetailOp` devolve `opportunity: { id, stage, label, updatedAt } | null` (via `findOpenOpportunityForConversation`; `null` se não houver oportunidade aberta).
- Função interna `advanceToInService(db, tenantId, conversationId, actor, now)`, chamada em `assignConversationOp` e em `sendOutboundMessageOp` **dentro da mesma transação**, com `updateOpportunityStage` e `insertStageHistory` (nota «Automática: assumiu a conversa»). Não reutilizar `moveOpportunityStageOp`, que abre a sua própria transação e exige `expectedUpdatedAt`.
- Evento em tempo real da mudança de etapa na mesma outbox, para a faixa e o funil atualizarem sem recarregar (confirmar o tipo de evento que o Acompanhamento já escuta antes de criar outro).
- Auditoria: ator = a pessoa que assumiu; origem registrada como automática.

**Cliente (PR 2)**
- Tipo `InboxConversationDetail.opportunity`.
- `InboxThread.tsx`: cabeçalho com 3 alvos (voltar, contato, ⋮); faixa de contexto com a **etapa só de leitura** e **Agendar**; resumo da IA move-se para a folha do ⋮ (M-40); «Corrigir etapa» e «Marcar como perdida» chamam o endpoint de mover etapa existente (`api.moveOpportunity`).
- Testes de `InboxThread` que dependem do botão «Resumo da IA» e do `Agendar` no cabeçalho precisam de ajuste.

**Cliente (PR 3)**
- Faixa compacta de Pix pendente com «Detalhes» (folha M-47) no lugar do cartão atual dentro da conversa; reaproveita Copiar Pix e Cancelar cobrança já existentes. «Reenviar cobrança» precisa de endpoint (ver Em aberto).

## Testes

- Assumir com etapa `novo_contato` → `em_atendimento`, com linha em `opportunity_stage_history`.
- Assumir com etapa `horario_proposto`, `agendado` ou terminal → não muda.
- Primeira resposta de quem não é responsável → atribui e avança; a segunda resposta não duplica histórico.
- Encerrar a conversa não altera a etapa.
- Isolamento: o evento e a leitura não vazam para outro tenant.
- Detalhe devolve `opportunity: null` sem oportunidade aberta.
- Cliente: faixa mostra a etapa e muda após evento em tempo real; ⋮ corrige para «Horário proposto» e «Perdido».

## Em aberto

| # | Pergunta | Decide | Bloqueia |
| --- | --- | --- | --- |
| 1 | «Reenviar cobrança» do Pix (DEC-065): a API da Woovi permite reenviar a mesma cobrança, ou gera uma nova? | Engenharia + Paulo | PR 3, só a ação |
| 2 | Texto da nota no histórico de etapa para mudanças automáticas | Paulo | PR 1 (não bloqueia a lógica) |
| 3 | A conversa sem oportunidade (caso raro) cria uma ao assumir ou fica sem etapa? | Paulo | PR 1 |
| 4 | Quando a atendente corrige a etapa, a próxima ação automática pode sobrescrevê-la? Proposta: não, porque a regra só avança a partir de `novo_contato` | Paulo | PR 1 |

## Ordem sugerida

PR 1 (backend + testes) → PR 2 (cabeçalho, faixa, ⋮) → PR 3 (Pix). Cada PR cita as DEC e os mocks M-xx.
