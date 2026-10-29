# Limites de abuso das automações (S7, #178)

Estado: **implementado em PR, desligado por padrão** (`ABUSE_LIMITS=on` liga). Todos os valores são **Proposto — aguarda Paulo**. Não há dados de uso real; os números são pontos de partida simples, para rever com o piloto.

Código: `src/clinic/ai/abuse-limits.ts` (valores em `PROPOSED_ABUSE_LIMITS`, override por `ABUSE_LIMIT_*`), aplicado em `src/clinic/ai/autodraft.ts`. Testes: `src/clinic/ai/abuse-limits.test.ts`.

## Valores propostos

| Limite | Valor | Estado | Porquê |
|---|---|---|---|
| Janela das quotas | 24 h rolantes (`ABUSE_LIMIT_WINDOW_HOURS`) | Proposto — aguarda Paulo | Simples de explicar e alinhada com o limite diário de rascunhos já aprovado. |
| Rascunhos automáticos por contato | 20 / 24 h (`ABUSE_LIMIT_AUTO_DRAFTS_PER_CONTACT`) | Proposto — aguarda Paulo | Uma conversa normal raramente passa de 10 mensagens/dia; 20 só corta inundações. |
| Rascunhos por clínica | 300 / dia | **Já aprovado** (`AI_DAILY_DRAFT_CAP`) | Mantido; não duplicado. |
| Marcações pela IA por contato | 1 / 24 h (`ABUSE_LIMIT_AI_BOOKINGS_PER_CONTACT`) | Proposto — aguarda Paulo | Uma cliente raramente precisa de mais de uma marcação nova por dia; o resto vai à equipe. |
| Marcações pela IA por clínica | 20 / 24 h (`ABUSE_LIMIT_AI_BOOKINGS_PER_CLINIC`) | Proposto — aguarda Paulo | Limite de segurança contra muitos números a encher a agenda; uma clínica piloto pequena fica abaixo disso. |
| Compromissos futuros por contato | 3 (`ABUSE_LIMIT_FUTURE_APPOINTMENTS_PER_CONTACT`) | Proposto — aguarda Paulo | Evita que um contato prenda vários horários; com 3 já marcados, a equipe confirma. |
| Cobranças Pix pendentes por contato | 2 (`ABUSE_LIMIT_PENDING_PIX_PER_CONTACT`) | Proposto — aguarda Paulo | Evita várias cobranças em aberto para a mesma pessoa. |
| Propostas pendentes por contato | 1 (`ABUSE_LIMIT_PENDING_PROPOSALS_PER_CONTACT`) | Proposto — aguarda Paulo; contagem ligada em S3 (#174) via efeito `proposal` | Uma proposta de cada vez evita confusão sobre qual botão vale. Substituição da versão aberta não conta como segunda pendente. |
| Propostas criadas por contato | 5 / 24 h (`ABUSE_LIMIT_PROPOSALS_PER_CONTACT`) | Proposto — aguarda Paulo; contagem ligada em S3 | Dá margem para trocar de horário algumas vezes sem permitir inundação. |
| Propostas criadas por clínica | 100 / 24 h (`ABUSE_LIMIT_PROPOSALS_PER_CLINIC`) | Proposto — aguarda Paulo; contagem ligada em S3 | Limite global de segurança, folgado para uma clínica piloto. |

## Ao atingir o limite

- O **novo efeito automático não acontece** (o rascunho não é gerado / a IA não marca). Nada já feito é desfeito.
- A atendente vê o motivo (nota no rascunho ou job `skipped` com `abuse_limit:<limite>`), e pode agir manualmente: **ações da equipe não são limitadas**.
- Auditoria `abuse.limit_reached` no DO, no máximo uma vez por contato/limite/janela, e log `abuse.limit_reached` (sem conteúdo pessoal).
- O contato **não é bloqueado**; os outros contatos da clínica seguem normais. Nunca há bloqueio permanente baseado no LLM.

## Garantias e limites

- Contagem nas tabelas de efeitos no próprio DO da clínica (escopo de tenant explícito, single-threaded); jobs em geração contam. Webhook repetido é deduplicado a montante e não cria efeito novo.
- Com o S2 (#191) a IA não marca por texto livre; a quota de marcações fica pronta para o botão (S5/#176). Quotas de propostas: valores ainda **Proposto**; `createProposal` / `createOrSupersedeProposal` aplicam o efeito `proposal` quando `ABUSE_LIMITS=on` (S3 #174).
- Desligado por padrão: ligar exige decisão do Paulo sobre os valores e configuração do Worker (fora deste PR).
