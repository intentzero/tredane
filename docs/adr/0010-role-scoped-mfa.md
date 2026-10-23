# ADR-0010 — MFA condicional por responsabilidade e tenant

**Estado:** Política aprovada, DEC-027, opção B; métodos/recuperação/step-up por decidir.
**Origem:** aprovação do responsável pelo Tredane em 23/10/2026.
**Relacionados:** [ADR-0006](0006-clerk-platform-admin.md), [ADR-0007](0007-support-impersonation.md), [REQ-009](../product/requirements.md), [AC-25/26](../product/acceptance.md).

## Decisão confirmada

| Contexto | MFA |
| --- | --- |
| Todas as rotas da Platform Admin e ações globais de superadmin | **Obrigatório** |
| Clinic App/API operando um tenant no papel efetivo de `owner` | **Obrigatório** |
| Clinic App/API operando tenant no papel de `attendant` | **Opcional** |
| Criação de sessão própria de impersonação/suporte | **Obrigatório para o actor superadmin real** |

A mesma identidade Clerk pode ser owner em A e attendant em B. Sem MFA suficiente pode usar B como attendant, **não pode exercer owner em A** nem fazer operações de superadmin. O papel vem do D1 e a flag global `privateMetadata.superadmin === true` é lida no backend. Não há Clerk Organizations.

## Responsabilidade do Clerk e do Tredane

1. O Clerk é responsável por identidade, sessão e comprovação dos fatores. É necessário disponibilizar MFA na configuração do provedor.
2. **Não** ativar o toggle global `Require multi-factor authentication` no Clerk porque obrigaria também os attendants, contrariando DEC-027. O próprio Tredane fará as verificações por tenant, role e rota no backend.
3. O Worker/Hono deve validar sessão Clerk e **prova fiável de MFA cumprido** para a autorização privilegiada. Não aceitar parâmetros do frontend, `mfa: true`, simples status de MFA inscrito no perfil ou custom claim obsoleta como autorização sem confirmação de sessão.
4. Sem MFA suficiente, a Clinic App pode levar owner à configuração/completar desafio; as APIs owner/admin permanecem negadas (*fail closed*). Sem MFA não baixar implicitamente a role owner para attendant no mesmo tenant.
5. Attendant pode habilitar MFA voluntariamente; caso tenha habilitado, seu sign-in obedece aos desafios configurados pelo Clerk.
6. A impersonação própria do Tredane exige MFA **do actor**, independentemente de o subject ser owner ou attendant. Nenhuma operação sob impersonação substitui a identidade do actor.
7. MFA em production consta como recurso de **plano pago do Clerk** na documentação consultada em 23/10/2026; validar plano/preço antes de deploy.

## Abertos para F1

- **Métodos MFA**: TOTP com app autenticadora, SMS, passkeys como credencial multifator e códigos de recuperação; o produto ainda precisa escolher uma política.
- **Confirmação do nível MFA da sessão:** integrar o SDK/API Clerk na versão escolhida, cobrindo passkey que satisfaça MFA e idade de verificação sem assumir que `fva` isoladamente contemple todas as estratégias.
- **Reverificação recente (step-up)** para criar sessão de suporte, administrar owners e outras ações de maior risco: necessidade e janela de minutos pendentes de decisão.
- **Recuperação** e reset do MFA: não conceder privilégios de owner/superadmin sem verificação suficiente; adotar processo que não permita bypass por suporte.
- Testes com user owner A/attendant B, múltiplas abas, WebSockets, role promovido durante sessão, falhas do Clerk e proteção de APIs diretas.

## Cenários de aceite

1. Owner A/attendant B sem MFA: B como attendant permitido, A como owner negado.
2. Mesmo usuário com MFA válido: A como owner permitido com membership vigente.
3. Superadmin com `privateMetadata.superadmin === true` mas sem MFA: não usa Admin nem emite sessão de suporte.
4. Requisições forjadas, troca de role/tenant e bypass pelo frontend não elevam permissões.
5. Erro de autenticação/verificação do fator nega ações privilegiadas e WebSockets correspondentes.
6. Método MFA habilitado pelo attendant opcionalmente não pode ser ignorado para entrar.

**Referências do provedor:** https://clerk.com/docs/guides/configure/auth-strategies/sign-up-sign-in-options ; https://clerk.com/docs/guides/secure/reverification

**Documentação apenas:** não representa funcionalidade implementada nem validação de custo/segurança.
