# ADR-0008 — Convites de atendentes por e-mail

**Estado:** confirmados convite por e-mail (DEC-021), validade de 7 dias (DEC-022), reenvio com rotação (DEC-023), limites de frequência (DEC-024) e cancelamento por owner do tenant (DEC-025).
**Origem/data:** opção A aprovada pelo responsável pelo Tredane em 23/10/2026.
**Relacionado:** [ADR-0006](0006-clerk-platform-admin.md), [REQ-008](../product/requirements.md), [JRN-13](../product/journeys.md), [AC-22](../product/acceptance.md).

## Decisão

Um **owner** pode convidar uma pessoa exclusivamente para tenant no qual possui membership owner ativo. O Tredane gera convite escopado ao tenant, endereço de e-mail e role `attendant` ou `owner` (DEC-103), persiste-o no D1 e envia **link de uso único por e-mail**. Após seguir o link, a pessoa autentica-se no Clerk (com conta existente ou nova). O backend verifica se o **e-mail convidado está verificado na conta Clerk autenticada**. Só então o convite pode ser consumido atomicamente, criando ou confirmando membership com a role persistida nesse tenant sem afetar memberships noutros tenants. Role no body do cliente é ignorada.

**Não usar Clerk Organizations**, e **não permitir que um owner crie convites para owner**. A gestão de owners é exclusiva do superadmin.

## Contrato técnico para F1

**Estado de implementação:** API + adaptador simulado em [#25](https://github.com/intentzero/tredane/issues/25) / [f1-team-invites.md](../implementation/f1-team-invites.md). Provedor real de e-mail continua Em aberto.

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
- **DEC-024 confirmado:** reenvio exige um intervalo mínimo de **10 minutos** desde o reenvio autorizado anterior e permite, no máximo, **5 reenvios por janela móvel de 24 horas**, contabilizados para o par `(tenant_id, normalized_email)` independentemente da rotação dos tokens. A criação inicial do convite não é um reenvio.
- O Worker usa relógio do servidor e verifica cooldown/quota de forma resistente a requisições concorrentes, antes da substituição atómica do token. Se for limitado, responde sem enviar novo link e **sem invalidar** o token vigente. A quota mantém-se entre links substitutos para o mesmo par tenant/e-mail.
- Testar limites de 10 minutos, 24 horas, sexto reenvio, normalização de e-mail, dois reenvios simultâneos e eventuais pedidos de origens diferentes. Medidas antiabuso globais continuam a detalhar.
- Auditar emissor, tenant, e-mail de destino, substituição e estado da entrega sem registrar token em logs. Testar disputa entre dois reenvios, aceite simultâneo, token antigo e convites já aceitos.



## Cancelamento — decisão confirmada (DEC-025)

- **Qualquer owner ativo do tenant** pode cancelar **qualquer convite pendente daquele tenant**, independentemente do owner emissor. Não pode cancelar convites de outro tenant.
- No backend, após verificar Clerk session, membership e role atual, atualizar o convite de `pending` para `cancelled` **atomicamente no D1**, invalidando imediatamente o token/link antigo. Auditar actor, tenant, convite, destinatário, instante e resultado; nunca guardar o token em logs.
- Cancelamento **não altera memberships existentes**. Convite aceite não pode ser cancelado para remover attendant; remover membership exige ação própria.
- Reenvio não reativa convite `cancelled`; eventual novo convite exige emissão explícita separada.
- Se aceite e cancelamento coincidirem, somente uma operação produz efeito: se aceite vencer, membership criado e o cancelamento não o desfaz; se cancelamento vencer, o link não concede acesso. Testar concorrência, owner diferente do emissor, owner de B, attendant, token cancelado e idempotência.

## Pontos ainda em aberto

1. **Controles adicionais contra abuso** (por owner, IP e entrega) além dos limites confirmados de 10 minutos / 5 reenvios por 24 horas.
2. Transportador de e-mail e endereço remetente; gestão de bounces e falhas de entrega.
3. UX de confirmação/estado de convite cancelado e eventual notificação ao destinatário, sem assumir envio automático.
4. Revogação imediata de sessões HTTP e WebSockets após remoção de membership.
5. Política de privacidade, retenção de e-mails de convites e logs.

A decisão aqui documentada **não significa** implementação ou aprovação de integração com dados reais.
