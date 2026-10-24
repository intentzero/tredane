# ADR-0011 — Aprovação de cada sessão de suporte pelo owner

**Estado:** DEC-029 confirmada (opção A), 23/10/2026. Canal/validade/UX ainda em aberto.
**Relacionados:** [ADR-0007](0007-support-impersonation.md), [DEC-028/029](../product/decisions.md), [REQ-007](../product/requirements.md), [AC-27](../product/acceptance.md).

## Decisão

O superadmin pode **solicitar** suporte, mas cada sessão própria de impersonação do Tredane requer **aprovação explícita de um owner ativo do próprio tenant** antes do acesso clínico. A solicitação `pending` não dá acesso a dados, HTTP, WebSockets, arquivos, handoff ou cookie de suporte. A flag global superadmin não substitui a decisão da clínica; um owner de outro tenant ou attendant não aprova.

A aprovação identifica pedido específico, actor superadmin autenticado como ele mesmo no Clerk, subject ativo, tenant, finalidade/motivo, escopo, owner aprovador e data. Não é permanente nem reutilizável para novas sessões, não transfere tenant/subject ou amplia escopo. Rejeição, expiração e revogação negam acesso. O modo inicial segue **somente leitura/diagnóstico**, com permissões intersetadas com a role do subject e política da plataforma. **MFA não exigido no MVP** (DEC-028), mas seguem obrigatórios handoff seguro, autenticação/autorizações, CSRF, TTL e auditoria.

## Contrato técnico candidato — não implementado

1. Superadmin autenticado com `privateMetadata.superadmin === true` verificado no backend cria `support_access_requests` em estado `pending` no D1, com actor/subject/tenant/motivo/escopo.
2. Owner da mesma clínica, com membership `owner` atual revalidado no backend, vê os dados não sensíveis necessários para decidir, e **aprova/rejeita expressamente** o pedido. Sem resposta o pedido continua sem acesso.
3. A decisão é auditada com owner, actor, subject, tenant, escopo, resultado e data. Criar `support_sessions` exige pedido `approved` vigente; bind imutável ao pedido, sem permitir outra sessão pela mesma autorização ou mudar parâmetros.
4. Após aprovação, emitir handoff de uso único e cookie opaco seguro ligado à sessão Clerk do actor; cada pedido e cada entrega WebSocket valida sessão de suporte, decisão do owner, subject ativo, tenant, TTL e capacidades.
5. Retirada de aprovação, expiração de pedido/sessão, suspensão de tenant, remoção do subject e revogação da flag superadmin encerram a autorização; falha de consulta nega por padrão.
6. A auditoria de suporte preserva actor, subject e owner aprovador, motivo, decisão, operações realizadas e encerramento. A Clinic App exibe banner persistente de modo suporte.

### Modelo lógico proposto

`support_access_requests(id, tenant_id, actor_clerk_user_id, subject_clerk_user_id, reason, scope, status, decided_by_owner_clerk_user_id?, decided_at?, created_at, expires_at?, revoked_at?)`

`support_sessions` guarda `support_access_request_id` e `approved_by_owner_clerk_user_id`, sem impersonação/actor token Clerk.

Estados: `pending`, `approved`, `rejected`, `expired`, `revoked` e `cancelled`. Transições concorrentes e múltiplas sessões por autorização devem ser testadas.

## Pendências explícitas

- **Como o owner receberá e aprovará a solicitação:** painel interno, e-mail ou ambos (próxima decisão).
- **Por quanto tempo a solicitação ficará disponível e a sessão aprovada valerá**, e como funciona eventual renovação.
- Política de revogação pelo owner com sessão ativa, notificações e auditoria; sem autorização válida, bloquear por padrão.
- Privacidade/LGPD, retenção de pedidos e logs, política sem owner disponível e revisão de segurança com dados reais.

A decisão de produto não representa implementação nem aprovação para dados reais.
