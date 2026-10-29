# Limites de abuso das automações (S7, #178)

Estado: **implementado**. Valores das quotas: **Confirmado (Paulo, 29/10/2026)**. Enable efetivo: **por clínica**, fail-closed (`abuse_limits_enabled` default off até a owner ligar no painel). Env `ABUSE_LIMIT_*` = tetos opcionais / bootstrap da plataforma; `ABUSE_LIMITS=on` no env é só legado (não liga a clínica sozinho).

Código: `src/clinic/ai/abuse-limits.ts` (`DEFAULT_ABUSE_LIMITS`, `resolveAbuseLimits`), persistência em `clinic_settings` (migração 30), API owner `GET|PATCH /api/tenants/:id/config/abuse-limits`, UI `AutomationLimitsCard`. Aplicado em `autodraft.ts` e `proposals.ts`. Testes: `abuse-limits.test.ts`, `abuse-limits.http.test.ts`, `proposals.test.ts`.

## Controlo: painel da clínica (owner) + tetos de plataforma

- **Confirmado (Paulo, chat 29/10/2026 — «quero ui»):** a responsável vê e ajusta os limites em Clínica → Configurações, cartão **Limites das automações** (junto a Sugestões com IA). Atendentes não vêem o cartão (403 na API).
- **Aplicar limites de proteção:** liga/desliga a aplicação das quotas nesta clínica (default off).
- **Pausar novas marcações automáticas por botão:** impede novos efeitos de confirmação automática nesta clínica; **não cancela** compromissos já marcados; **não bloqueia** ações manuais. `AI_AUTOBOOK=off` na plataforma continua a vencer (fail-closed global) — a pausa da clínica não reativa o que a plataforma desligou.
- Números: min 1, máx = teto da plataforma (hard caps no servidor; `ABUSE_LIMIT_*` no env pode apertar uma chave). Salvar e «Restaurar padrões» (valores Confirmados). Auditoria `config.abuse_limits_updated`.
- Ações manuais da equipe (painel / Agendar) **continuam sem limite**.

## Valores Confirmados (Paulo, 29/10/2026)

| Limite | Valor | Estado | Porquê |
|---|---|---|---|
| Janela das quotas | 24 h rolantes | **Confirmado (Paulo, 29/10/2026)** | Simples de explicar e alinhada com o limite diário de rascunhos já aprovado. |
| Rascunhos automáticos por contato | 20 / 24 h | **Confirmado (Paulo, 29/10/2026)** | Uma conversa normal raramente passa de 10 mensagens/dia; 20 só corta inundações. |
| Rascunhos por clínica | 300 / dia | **Já aprovado** (`AI_DAILY_DRAFT_CAP`) | Mantido; não duplicado na UI. |
| Marcações pela IA por contato | 1 / 24 h | **Confirmado (Paulo, 29/10/2026)** | Uma cliente raramente precisa de mais de uma marcação nova por dia; o resto vai à equipe. |
| Marcações pela IA por clínica | 20 / 24 h | **Confirmado (Paulo, 29/10/2026)** | Limite de segurança contra muitos números a encher a agenda; uma clínica piloto pequena fica abaixo disso. |
| Compromissos futuros por contato | 3 | **Confirmado (Paulo, 29/10/2026)** | Evita que um contato prenda vários horários; com 3 já marcados, a equipe confirma. |
| Cobranças Pix pendentes por contato | 2 | **Confirmado (Paulo, 29/10/2026)** | Evita várias cobranças em aberto para a mesma pessoa. |
| Propostas pendentes por contato | 1 | **Confirmado (Paulo, 29/10/2026)**; contagem em `appointment_proposals` (S3) | Uma proposta de cada vez evita confusão sobre qual botão vale. Substituição da versão aberta não conta como segunda pendente. |
| Propostas criadas por contato | 5 / 24 h | **Confirmado (Paulo, 29/10/2026)**; contagem em S3 | Dá margem para trocar de horário algumas vezes sem permitir inundação. |
| Propostas criadas por clínica | 100 / 24 h | **Confirmado (Paulo, 29/10/2026)**; contagem em S3 | Limite global de segurança, folgado para uma clínica piloto. |

## Ao atingir o limite

- O **novo efeito automático não acontece** (o rascunho não é gerado / a IA não marca / a proposta automática não é criada). Nada já feito é desfeito.
- A atendente vê o motivo (nota no rascunho, job `skipped` com `abuse_limit:<limite>`, ou `ConflictError` `abuse_limit_reached` na criação de proposta), e pode agir manualmente: **ações da equipe não são limitadas**.
- Auditoria `abuse.limit_reached` no DO, no máximo uma vez por contato/limite/janela, e log `abuse.limit_reached` (sem conteúdo pessoal).
- O contato **não é bloqueado**; os outros contatos da clínica seguem normais. Nunca há bloqueio permanente baseado no LLM.

## Garantias e limites

- Contagem nas tabelas de efeitos no próprio DO da clínica (escopo de tenant explícito, single-threaded); jobs em geração contam. Webhook repetido é deduplicado a montante e não cria efeito novo.
- Com o S2 (#191) a IA não marca por texto livre; a quota de marcações aplica-se ao caminho do botão (S5/#176) quando a capacidade estiver ligada e a owner não tiver pausado marcações automáticas. Quotas de propostas: valores **Confirmados**; `createProposal` / `createOrSupersedeProposal` aplicam o efeito `proposal` quando os limites da clínica estão ligados.
- Regra de enable: **clínica** (`abuse_limits_enabled`); env `ABUSE_LIMITS` não liga sozinho. Fora do escopo: Platform Admin a editar todos os tenants; attendant a editar; ligar `AI_AUTOBOOK` globalmente; templates Meta.
