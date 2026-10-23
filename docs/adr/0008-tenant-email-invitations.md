# ADR-0008 — Convites de atendentes por e-mail

**Estado:** aceito quanto ao mecanismo (DEC-021); parâmetros de expiração e reenvio em aberto.
**Origem/data:** opção A aprovada pelo responsável pelo Tredane em 23/10/2026.
**Relacionado:** [ADR-0006](0006-clerk-platform-admin.md), [REQ-008](../product/requirements.md), [JRN-13](../product/journeys.md), [AC-22](../product/acceptance.md).

## Decisão

Um **owner** pode convidar um **attendant** exclusivamente para tenant no qual possui membership owner ativo. O Tredane gera convite escopado ao tenant, endereço de e-mail e role fixa `attendant`, persiste-o no D1 e envia **link de uso único por e-mail**. Após seguir o link, a pessoa autentica-se no Clerk (com conta existente ou nova). O backend verifica se o **e-mail convidado está verificado na conta Clerk autenticada**. Só então o convite pode ser consumido atomicamente, criando ou confirmando membership attendant nesse tenant sem afetar memberships noutros tenants.

**Não usar Clerk Organizations**, e **não permitir que um owner crie convites para owner**. A gestão de owners é exclusiva do superadmin.

## Contrato técnico proposto para F1 (não implementado)

- `tenant_invitations` guarda ID, tenant_id, normalized_email, role=attendant, issued_by_clerk_user_id, verifier_hash, status, expires_at, accepted_by_clerk_user_id e timestamps.
- Credencial de alta entropia, única e não previsível. Guardar apenas hash/verificador do segredo, não o token em claro; mensagens e logs não devem expor token.
- Só criar convite se a identidade do emissor tiver membership owner vigente no tenant; autorização do backend.
- O aceite exige sessão Clerk real, e-mail verificado correspondente e convite válido não usado, não revogado, dentro do prazo. Ignorar role/tenant enviados pelo browser na aceitação.
- Transação de consumo do convite + criação idempotente de membership D1; replays não podem criar múltiplos memberships nem elevar role existente.
- Nunca sobrescrever automaticamente a role de um usuário já existente naquele tenant (por exemplo, owner); devolver resultado controlado e auditado.
- Toda emissão, revogação e aceitação deve ser auditável; tratamento de links encaminhados, expiração, antiabuso/rate limits e CSRF a detalhar.
- Se já existir conta Clerk pertencente a outro tenant, manter identidade e memberships anteriores.

## Pontos ainda em aberto

1. **Tempo de validade padrão e política de reenvio/substituição** — próxima decisão do produto.
2. Transportador de e-mail e endereço remetente; gestão de bounces e falhas de entrega.
3. Se owner pode revogar convite pendente antes do aceite e UX exata de convite cancelado (proposto: sim).
4. Revogação imediata de sessões HTTP e WebSockets após remoção de membership.
5. Política de privacidade, retenção de e-mails de convites e logs.

A decisão aqui documentada **não significa** implementação ou aprovação de integração com dados reais.
