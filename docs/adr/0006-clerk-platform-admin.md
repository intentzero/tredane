# ADR-0006 — Clerk, Platform Admin e usuários multi-tenant

**Estado:** Aceito quanto às decisões explícitas, com detalhes indicados como Proposto.
**Data/origem:** 23/10/2026; decisão do responsável pelo Tredane.
**Substitui parcialmente:** DEC-007 (identidade e multi-tenancy em aberto), DEC-012 (admin sem painel), DEC-013 (operador fora do MVP). O painel administrativo é uma app separada; o profissional da clínica continua sem login no primeiro recorte.

## Decisões confirmadas

1. **Identidade e sessões:** usar Clerk, sem Clerk Organizations. Não usar IDs `orgId`, Organization Memberships, Organizations Roles nem Organizations API para modelar clínicas.
2. **Superadmin:** o atributo global é **`privateMetadata.superadmin === true`** (booleano, sem underscore) num usuário Clerk. Apenas o backend consulta e verifica a flag; não confiar no browser, `publicMetadata`, `unsafeMetadata` ou uma claim desatualizada.
3. **Multi-tenant:** um usuário Clerk pode pertencer a vários tenants do Tredane, com `tenant_memberships` e roles **no D1**. Cada API e WebSocket verifica o tenant solicitado e a associação vigente; duas abas podem operar tenants diferentes.
4. **Platform Admin App:** aplicação restrita a superadmins para criar, editar, suspender, reativar e iniciar exclusão de tenants, além de gerir atribuições quando autorizado.
5. **Separação de privilégio:** flag global de superadmin não concede acesso automático ao conteúdo da clínica. O acesso operacional normal exige membership explícito, ou uma sessão de suporte/impersonação controlada conforme [ADR-0007](0007-support-impersonation.md).
6. **Exclusão:** "deletar tenant" é uma operação com confirmação reforçada e exclusão lógica no MVP. Purga física e recuperação dependem de política de dados/retensão ainda Em aberto.
7. **Impersonação de suporte:** um superadmin poderá entrar no contexto de um usuário com membership no tenant para manutenção, conforme [ADR-0007](0007-support-impersonation.md). A identidade real deve ficar atribuível em todas as operações.

## Responsabilidades por camada

| Camada | Responsabilidade |
| --- | --- |
| Clerk | Identidade, credenciais e sessão; `privateMetadata.superadmin` como autoridade de plataforma |
| D1 | Tenants, memberships, roles, estado de tenant e trilha de auditoria |
| API de administração | Validação server-side atual de `superadmin`, operações de ciclo de vida |
| API de clínica | Tenant escolhido validado pelo membership efetivo; autorização por role e estado do tenant |
| Interface Platform Admin | Cadastro/edição/suspensão/exclusão lógica; início/gestão de suporte |
| Interface Clinic | Inbox/agenda/pipeline escopados ao tenant; indicador visível de modo suporte |

## Segurança

- Para cada operação de administrador, validar Clerk session e o usuário atual com **Clerk Backend API**; permissões ausentes ou falha na verificação => negar (*fail closed*). A política de cache/limites da API será validada em F1.
- MFA obrigatório para Platform Admin é **proposto**, sujeito a definição da configuração/step-up.
- Revogação de membership precisa invalidar endpoints e eventos WebSocket daquele tenant; não pode desativar memberships válidos do mesmo usuário nos outros tenants.
- Operações administrativas ficam auditadas com ator, alvo, tenant, justificativa, timestamps e efeitos. Nenhum acesso oculto a conteúdo sensível.
- A app de administração pode ter frontend/API de deploy separados; a **separação de autorização é obrigatória**, independentemente da topologia física.

## Modelo D1 indicativo, não migração

`tenants(id, name, timezone, status, created_at, updated_at, deletion_requested_at?)`

`tenant_memberships(tenant_id, clerk_user_id, role, status, created_at, revoked_at?, PRIMARY KEY(tenant_id, clerk_user_id))`

`platform_admin_events(id, actor_clerk_user_id, tenant_id, action, before, after, occurred_at)`

Ver [modelo de dados](../architecture/data-model.md), [identidade e admin](../architecture/identity-and-admin.md), [MVP](../MVP.md) e [decisões](../product/decisions.md).

**Revisitar:** políticas LGPD/retensão, custo do Clerk Backend API, topologia de apps/Workers, capacidades finais do owner, onboarding de usuários e suporte.

**Referência:** https://clerk.com/docs/guides/users/extending
