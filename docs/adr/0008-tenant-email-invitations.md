# ADR-0008 — Convites de atendentes por e-mail

**Estado:** confirmados mecanismo por e-mail (DEC-021), validade de 7 dias (DEC-022) e reenvio que invalida o link anterior (DEC-023); limites quantitativos em aberto.
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

## Validade confirmada — DEC-022

O convite vale **7 dias (168 horas) a partir do instante da emissão**, calculados e conferidos pelo backend em UTC. O D1 guarda `issued_at` e `expires_at`. Aceitar requer `now < expires_at` no momento da operação atómica de consumo do convite e criação do membership. No instante exato da expiração ou depois, o aceite é negado. Abrir o link e autenticar-se no Clerk não prolongam a validade. Testar limites temporais, token usado e relógio do cliente adulterado.

## Reenvio — decisão confirmada (DEC-023)

- O owner autorizado pode reenviar convite para o mesmo e-mail e tenant enquanto houver convite pendente.
- Cada reenvio **gera novo token de uso único** e novo prazo integral de **7 dias (168 horas)** a contar do reenvio/emissão.
- Ao substituir o convite, o **token anterior torna-se inválido imediatamente**, mesmo dentro do prazo antigo. A substituição e invalidação têm de ser atómicas no D1; aceitar o token anterior após a substituição é sempre negado.
- Reenvio não permite criar owner nem alterar tenant/e-mail/role; não modifica memberships existentes noutros tenants.
- Devem existir controles contra abuso e envios excessivos; **quantidade por período/cooldown ainda não está definida** e não deve ser inventada na implementação.
- Auditar emissor, tenant, e-mail de destino, substituição e estado da entrega sem registrar token em logs. Testar disputa entre dois reenvios, aceite simultâneo, token antigo e convites já aceitos.



## Pontos ainda em aberto

1. **Limites numéricos de frequência de reenvio (cooldown/quota)** — requisito de proteção confirmado, valores ainda não escolhidos.
2. Transportador de e-mail e endereço remetente; gestão de bounces e falhas de entrega.
3. Se owner pode revogar convite pendente antes do aceite e UX exata de convite cancelado (proposto: sim).
4. Revogação imediata de sessões HTTP e WebSockets após remoção de membership.
5. Política de privacidade, retenção de e-mails de convites e logs.

A decisão aqui documentada **não significa** implementação ou aprovação de integração com dados reais.
