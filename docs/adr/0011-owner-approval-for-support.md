# ADR-0011 — Aprovação de cada sessão de suporte pelo owner

**Estado:** DEC-029 confirmada (aprovação prévia por sessão) e DEC-030 confirmada (opção C: painel em tempo real + aviso por e-mail). Validade e UX complementar em aberto.
**Relacionados:** [ADR-0007](0007-support-impersonation.md), [DEC-028/029](../product/decisions.md), [REQ-007](../product/requirements.md), [AC-27](../product/acceptance.md).

## Decisão

O superadmin pode **solicitar** suporte, mas cada sessão própria de impersonação do Tredane requer **aprovação explícita de um owner ativo do próprio tenant** antes do acesso clínico. A solicitação `pending` não dá acesso a dados, HTTP, WebSockets, arquivos, handoff ou cookie de suporte. A flag global superadmin não substitui a decisão da clínica; um owner de outro tenant ou attendant não aprova.

A aprovação identifica pedido específico, actor superadmin autenticado como ele mesmo no Clerk, subject ativo, tenant, finalidade/motivo, escopo, owner aprovador e data. Não é permanente nem reutilizável para novas sessões, não transfere tenant/subject ou amplia escopo. Rejeição, expiração e revogação negam acesso. O modo inicial segue **somente leitura/diagnóstico**, com permissões intersetadas com a role do subject e política da plataforma. **MFA não exigido no MVP** (DEC-028), mas seguem obrigatórios handoff seguro, autenticação/autorizações, CSRF, TTL e auditoria.

## Canal e decisão — DEC-030 confirmada

1. Os **owners ativos** do tenant veem novos pedidos `pending` no painel da Clinic App, atualizados por eventos em tempo real via Durable Object/WebSocket somente daquele tenant. O pedido mostra superadmin solicitante, subject, motivo, capacidades requeridas e estado, sem exibir conteúdo clínico antes da autorização.
2. Os mesmos owners recebem **notificação por e-mail** com um link comum para a página do pedido no Tredane. **Não incluir token de aprovação, bearer de suporte ou informações clínicas no e-mail**; clicar exige login Clerk e membership owner ativa do tenant. O e-mail é apenas aviso e navegação.
3. Os botões **Aprovar** e **Rejeitar** só são oferecidos no painel. O Worker revalida Clerk, tenant, owner e estado pendente a cada decisão; primeira transição válida no D1 vence atomicamente e é auditada. Outros owners veem atualização em tempo real e não decidem novamente o mesmo pedido.
4. E-mails falhados, repetidos ou atrasados não mudam estado/autorização, nem impedem que um owner presente no painel decida. Se não houver owner elegível para decidir, nenhum acesso clínico é liberado. Retentativas, provedor de e-mail, limites de envio e prazo do pedido permanecem pendentes de especificação.
5. Ao reabrir o painel após estar offline, carregar pedidos pendentes do D1 e conciliar eventos WebSocket para evitar decisões duplicadas. Sem MFA no MVP (DEC-028).

## Contrato técnico candidato — não implementado

1. Superadmin autenticado com `privateMetadata.superadmin === true` verificado no backend cria `support_access_requests` em estado `pending` no D1, com actor/subject/tenant/motivo/escopo.
2. Owner da mesma clínica recebe o pedido em tempo real no painel e aviso por e-mail com link de navegação. Já autenticado pelo Clerk, com membership `owner` ativa revalidada pelo backend, vê os dados não sensíveis necessários para decidir e **aprova/rejeita expressamente somente no painel**. Sem resposta o pedido continua sem acesso.
3. A decisão é auditada com owner, actor, subject, tenant, escopo, resultado e data. Criar `support_sessions` exige pedido `approved` vigente; bind imutável ao pedido, sem permitir outra sessão pela mesma autorização ou mudar parâmetros.
4. Após aprovação, emitir handoff de uso único e cookie opaco seguro ligado à sessão Clerk do actor; cada pedido e cada entrega WebSocket valida sessão de suporte, decisão do owner, subject ativo, tenant, TTL e capacidades.
5. Retirada de aprovação, expiração de pedido/sessão, suspensão de tenant, remoção do subject e revogação da flag superadmin encerram a autorização; falha de consulta nega por padrão.
6. A auditoria de suporte preserva actor, subject e owner aprovador, motivo, decisão, operações realizadas e encerramento. A Clinic App exibe banner persistente de modo suporte.

### Modelo lógico proposto

`support_access_requests(id, tenant_id, actor_clerk_user_id, subject_clerk_user_id, reason, scope, status, decided_by_owner_clerk_user_id?, decided_at?, created_at, expires_at?, revoked_at?)`

`support_sessions` guarda `support_access_request_id` e `approved_by_owner_clerk_user_id`, sem impersonação/actor token Clerk.

Estados: `pending`, `approved`, `rejected`, `expired`, `revoked` e `cancelled`. Transições concorrentes e múltiplas sessões por autorização devem ser testadas.

## Pendências explícitas

- **Prazo de validade do pedido pendente** (próxima decisão). O canal já foi fixado em DEC-030: painel em tempo real e notificação por e-mail, com aprovação/rejeição somente no Tredane.
- **Por quanto tempo a solicitação ficará disponível e a sessão aprovada valerá**, e como funciona eventual renovação.
- Política de revogação pelo owner com sessão ativa, notificações e auditoria; sem autorização válida, bloquear por padrão.
- Privacidade/LGPD, retenção de pedidos e logs, política sem owner disponível e revisão de segurança com dados reais.

A decisão de produto não representa implementação nem aprovação para dados reais.
