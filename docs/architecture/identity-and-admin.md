# Identidade e administração do Tredane

**Estado:** contrato de arquitetura proposto com decisões confirmadas de [ADR-0006](../adr/0006-clerk-platform-admin.md) e requisito confirmado em [ADR-0007](../adr/0007-support-impersonation.md). Rotas e esquema definitivos sujeitos à F1.

## Fontes de verdade

- **Clerk:** identidade e sessão; `privateMetadata.superadmin` booleano define administrador global. Sem Clerk Organizations.
- **D1:** `tenants`, `tenant_memberships` N:N, roles por tenant, auditoria e **`support_sessions` próprias do Tredane**; não há Clerk Organizations nem actor tokens.
- **API de plataforma:** confirma superadmin atual via Clerk Backend API; controla criação/edição/suspensão/exclusão lógica de tenants.
- **API clínica:** exige membro ativo no tenant **ou** sessão de suporte validada e restrita ao subject e tenant, conforme ADR-0007. Nenhum superadmin ganha acesso implícito aos dados operacionais.

## Fluxo multi-tenant

1. Usuário faz login no Clerk.
2. `GET /api/me/tenants` devolve lista de memberships ativos obtida do D1.
3. UI seleciona tenant no contexto da aba/rota; não usar `orgId` nem tenant global no Clerk.
4. Para cada request, backend valida autenticação, membership do usuário e role naquele tenant, e estado do tenant.
5. Revogar membership A invalida APIs e WebSockets de A, mas não interfere com o acesso a B. Troca de contexto não pode transferir caches/eventos entre tenants.

## Delegação da equipa — opção B confirmada

- Superadmin cria tenant e atribui o primeiro owner. Apenas superadmin cria, transfere ou remove owners.
- Owner autenticado convida/remove apenas attendants do seu tenant; backend Hono verifica role e tenant ativos no D1 a cada ação. Attendant não gere membros.
- Um Clerk user pode ser owner em A e attendant em B. Revogar A não altera B; ações são auditadas com autor, tenant e alvo.
- Convites, expiração e revogação de sessões/WS precisam de especificação na F1.

## Convites por e-mail (DEC-021 — confirmado)

Owner de tenant ativo cria convite para e-mail e role **fixa attendant**. O Tredane envia um link de uso único, cuja credencial de alta entropia não é persistida em texto claro no D1. Na aceitação, o backend exige sessão Clerk do destinatário e e-mail **verificado** correspondente ao endereço convidado, e consome o convite atomicamente ao criar membership D1. A pessoa pode já integrar outros tenants, sem alterar esses vínculos. Concessão de owner continua exclusiva de superadmin. **DEC-022:** 7 dias (168 horas) desde emissão, verificados pelo servidor com `expires_at` persistido no D1; abrir link/login Clerk não prorroga. **DEC-023:** reenvio pelo owner gera novo token de uso único e novo `expires_at` de 7 dias; transação no D1 invalida o token antigo antes do despacho do novo e-mail. Aceite e reenvio simultâneos precisam de comportamento serializado e testes de concorrência. **DEC-024:** backend limita reenvios por par tenant/e-mail normalizado a um intervalo mínimo de 10 minutos e máximo de 5 em janela móvel de 24 horas; verificações de quota e rotação de tokens devem resistir a concorrência e não recomeçar contagem com novo link. Rejeitar sem revogar o link vigente. Cancelamento manual e provedor de entrega continuam pendentes. Consultar [ADR-0008](../adr/0008-tenant-email-invitations.md).

## Fluxo Platform Admin

1. Superadmin autentica no Clerk.
2. Worker confere `privateMetadata.superadmin === true` pelo Backend API; rejeita valor ausente, string ou API indisponível.
3. Admin lista/cria/edita/suspende/reabilita/inicia exclusão lógica de tenants com auditoria.
4. Só o backend emite e valida sessões de suporte; a UI nunca consegue conceder impersonação por parâmetros arbitrários.
5. Admin pode selecionar tenant e usuário membro e iniciar impersonação para manutenção com banner visível, motivo, TTL e auditoria (ADR-0007).

## Contratos de API candidatos

**Operação da clínica**
- `GET /api/me/tenants` lista memberships do login.
- `GET /api/tenants/:tenantId/context` resolve tenant e role do usuário (ou da sessão de suporte).
- `/api/tenants/:tenantId/...` exige tenant-scoped authorization.

**Admin da plataforma**
- `GET /api/platform/tenants`
- `POST /api/platform/tenants`
- `PATCH /api/platform/tenants/:id`
- `POST /api/platform/tenants/:id/suspend`
- `POST /api/platform/tenants/:id/reactivate`
- `DELETE /api/platform/tenants/:id` inicia **exclusão lógica**, não destruição imediata.
- `GET /api/platform/tenants/:id/members` lista memberships e permite ao superadmin gerir owners.
- `POST /api/tenants/:tenantId/invitations` (proposto): owner convida exclusivamente attendants.
- `DELETE /api/tenants/:tenantId/members/:clerkUserId` (proposto): owner remove apenas attendants, sem alterar tenants diferentes.
- `POST /api/platform/support-sessions` cria uma sessão **própria do Tredane** vinculada à sessão Clerk do superadmin, tenant, subject e motivo; entrega código de handoff único de curta duração.
- `POST /api/platform/support-sessions/:id/revoke` encerra a sessão e impede acesso posterior (HTTP/WebSocket).
- `POST /api/support/exchange` (Clinic App, contrato proposto) troca o código único por credencial opaca de suporte em cookie seguro HttpOnly, vinculada à sessão Clerk **do actor**.
- `GET /api/platform/support-sessions` lista eventos e sessões vigentes do superadmin.

Estes caminhos não são código implementado nem contratos congelados; F1 confirmará URL, dados de retorno, proteção CSRF e idempotência.

## Modelo lógico mínimo de memberships

```text
Clerk user (clerk_user_id)
  1:N
tenant_memberships (tenant_id, clerk_user_id, role, status, revoked_at)
  N:1
tenants (id, status, name, timezone)
```

**Exemplo fictício:** user_A participa em tenant_1 como owner e tenant_2 como attendant. Nenhuma Organization do Clerk representa estas associações.

## Contrato de autorização sob impersonação

Contexto resolvido internamente no Worker:

```ts
type EffectivePrincipal =
  | { mode: 'direct'; clerkUserId: string; tenantId: string; role: 'owner' | 'attendant' }
  | {
      mode: 'support'
      actorClerkUserId: string
      subjectClerkUserId: string
      tenantId: string
      role: 'owner' | 'attendant'
      supportSessionId: string
    }
```

Em `mode: 'support'`, o actor **continua autenticado no Clerk como ele mesmo**; o contexto efetivo é resolvido da sessão própria de suporte no D1. Cada operação valida superadmin, sessão de suporte, alvo e seu membership/role **naquela clínica**, aplicando uma política adicional de ações permitidas. A atribuição em auditoria grava actor e subject distintos. Não utilizar um header `X-Impersonate-User` de cliente como fonte de permissão.

## Questões ainda em aberto

- **Confirmado:** a impersonação será exclusivamente implementada no Tredane; Clerk fornece somente a identidade/sessão original do superadmin. Em aberto o protocolo exato de handoff, cookies, CSRF, step-up MFA e política de operações de escrita.
- Política de aviso/aprovação de suporte e tratamento de dados pessoais.
- Passos exatos de MFA, mecanismo de revogação em WebSocket e topologia definitiva das apps/Workers.
- Política de exclusão física/retensão e mecanismos de provisionamento, convite e alteração de membros.
