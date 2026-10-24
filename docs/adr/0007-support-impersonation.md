# ADR-0007 — Impersonação interna para suporte e manutenção

- **Estado:** **Aceito** — mecanismo **próprio do Tredane**, sem usar Clerk impersonation, actor tokens ou sessão Clerk do usuário alvo.
- **Data/origem:** 23/10/2026; decisão explícita do responsável pelo Tredane.
- **Relacionados:** [ADR-0006](0006-clerk-platform-admin.md), [requisitos](../product/requirements.md), [contratos de identidade](../architecture/identity-and-admin.md).

## Objetivo

Um superadmin autenticado na Platform Admin poderá escolher um **tenant** e um **usuário que seja membro ativo desse tenant**, declarar a finalidade de manutenção e abrir a Clinic App no contexto de permissões desse usuário. A experiência funcional deve corresponder ao papel do usuário selecionado, **sem falsificar a identidade de autenticação nem atribuir falsamente as ações ao usuário**.

**DEC-029 exige aprovação explícita de um owner ativo da clínica para cada sessão de suporte antes de qualquer acesso clínico. DEC-030 prevê pedido em tempo real no painel e e-mail informativo, com decisão exclusivamente no painel autenticado.** O owner autoriza a sessão de suporte, não o login do subject. [ADR-0011](0011-owner-approval-for-support.md).

O superadmin continua autenticado **como ele mesmo no Clerk**. O Tredane aplica um **contexto efetivo de suporte** sobre a autorização tenant-scoped em D1. Não se cria sessão Clerk para o usuário alvo, não se altera sua senha, não se pede consentimento de login e não se utiliza a feature comercial de impersonação do Clerk.

## Decisões confirmadas

1. A própria plataforma emite, valida, expira, revoga e audita sessões de suporte.
2. Toda sessão tem exatamente um **actor** (superadmin real), um **subject** (usuário alvo), um **tenant**, um motivo e um prazo.
3. A autorização usa o **papel atual do subject naquele tenant** e restrições adicionais da política de suporte. `superadmin` nunca eleva privilégios de conteúdo.
4. A auditoria preserva actor e subject separadamente em todas as mutações e operações sensíveis; nunca regista a ação como se o subject real a tivesse realizado.
5. Impersonação não concede acesso global entre tenants nem permissão para agir como usuário sem membership vigente.

## Fluxo técnico proposto

1. Na Platform Admin, o actor entra com sessão Clerk válida. O Worker verifica `privateMetadata.superadmin === true` no backend, a existência do tenant e o membership do subject.
2. O actor seleciona subject, motivo e escopo. O sistema cria `support_access_requests` no D1 em estado `pending`, **sem conceder acesso clínico**, com `expires_at` a **24 horas de sua emissão** (DEC-031). Aprovação exige pedido ainda pendente e dentro do prazo. Owners do tenant veem o pedido via painel em tempo real e recebem e-mail de aviso com link para a página autenticada; o e-mail não aprova. Somente após owner ativo do mesmo tenant aprovar expressamente o pedido (DEC-029), o backend cria `support_sessions` vinculada ao pedido/aprovador e ao actor, subject, tenant, motivo, escopo e prazo.
3. **Após aprovação válida do owner**, a app de administração abre a Clinic App numa sessão de suporte isolada. A transferência segura de contexto deverá usar **código de uso único, curtíssima validade e troca server-to-server/same-origin**, com cookie de suporte `HttpOnly; Secure; SameSite=Lax` com escopo mínimo no domínio da Clinic App. Nunca colocar um bearer persistente em URL, localStorage ou query string.
4. A cada pedido, a API valida (0) aprovação vigente para aquele actor/subject/tenant/motivo/escopo, (a) sessão Clerk **do actor**, (b) a flag global atual, (c) cookie opaco do suporte ligado ao actor/sessão, (d) linha ativa em D1, TTL e tenant fixo, (e) tenant ativo, (f) membership atual e role do subject, (g) permissão da operação segundo **interseção** entre role do subject e política de suporte.
5. O segredo da sessão de suporte não é armazenado em texto claro no D1: somente hash seguro/verificador; troca/consumo do código de handoff é atômica e impede reuso. Na revogação ou expiração, cookie perde valor e WebSockets devem deixar de receber eventos.
6. A Clinic App exibe banner persistente com **"Modo suporte · Superadmin [actor] atuando no contexto de [subject] · [tenant]"**, identificação clara de ações desabilitadas e botão **Encerrar**. A UI nunca oculta o modo de suporte.

**Os detalhes de cookie, ponte entre subdomínios, proteção CSRF, troca one-time são propostas de F1**, e devem passar por revisão de segurança antes do deployment real. Não reutilizar o contexto de suporte de uma aba para mudar o tenant noutra.

## Modelo lógico mínimo (proposto, sem migração executada)

```text
support_access_requests (
  id,
  tenant_id,
  actor_clerk_user_id,
  subject_clerk_user_id,
  reason,
  scope,
  status,
  decided_by_owner_clerk_user_id,
  decided_at,
  created_at,
  expires_at,
  revoked_at
)

support_sessions (
  id,
  support_access_request_id,
  approved_by_owner_clerk_user_id,
  token_verifier_hash,
  actor_clerk_user_id,
  actor_clerk_session_id,
  subject_clerk_user_id,
  tenant_id,
  reason,
  scope,
  status,
  created_at,
  activated_at,
  expires_at,
  revoked_at,
  last_used_at
)

support_audit_events (
  id,
  support_session_id,
  actor_clerk_user_id,
  subject_clerk_user_id,
  tenant_id,
  operation,
  resource_type,
  resource_id,
  outcome,
  occurred_at
)
```

A associação com a sessão Clerk do actor e as chaves entre tenants devem ser validadas a cada pedido. Nunca confiar em `X-Impersonate-User`, `X-Tenant` ou valores de cliente para conceder privilégios.

**DEC-028 — sem MFA no MVP:** o superadmin real não precisa de MFA para iniciar suporte. Permanecem obrigatórios motivo, autenticação Clerk válida, flag superadmin consultada no backend, sessão própria D1, TTL, handoff seguro, cookie HttpOnly, CSRF, auditoria dupla, controle de capacidades e revisão de segurança antes de dados reais.

## DEC-032 — TTL de 30 minutos após aprovação

Ao aprovar pedido de owner válido, criar sessão de suporte com `activated_at` UTC e `expires_at = activated_at + 30 minutos`. O prazo começa na ativação, sem extensão por handoff, navegação ou reconexão. Após esse prazo ou encerramento antecipado pelo superadmin, negar novas APIs e entrega de eventos WebSocket (inclusive DO hibernado), invalidando cookie/token e mantendo a sessão Clerk global. Encerramento auditado. A janela de 24 horas do pedido pendente (DEC-031) é separada; continuação por novo pedido e aprovação (DEC-033).

## Continuação após 30 minutos — DEC-033

Nenhuma sessão de suporte pode ser prolongada. Após expiração ou encerramento antecipado, continuar exige **novo pedido pendente**, **nova aprovação de owner do tenant** e outra sessão com credenciais e TTL próprios. Proibir atualização de `expires_at`, reaproveitamento da autorização anterior e endpoints de extensão. O acesso HTTP/WebSocket antigo permanece invalidado até que haja nova sessão efetivamente aprovada.

## Políticas mínimas de segurança

- **TTL da sessão (DEC-032):** 30 minutos fixos desde ativação, com encerramento antecipado e sem renovação automática. O prazo de 24 horas da DEC-031 é apenas para decidir o pedido pendente.
- **Início:** exigir motivo, sessão Clerk válida, autorização superadmin e **aprovação do owner para cada sessão (DEC-029)**. Sem MFA/step-up no MVP (DEC-028); não iniciar automaticamente por abertura de página.
- **Modo inicial:** acesso de leitura e diagnóstico; operações de manutenção que modificam dados só após política de capacidades explícita, limitada ao papel do alvo e com auditoria. Proibir por padrão credenciais, alteração de membership/papéis, faturação, segredos, exportação em massa e ações destrutivas. Envio WhatsApp e alterações de agendamento exigem aprovação específica antes de ativar.
- **Revogação (DEC-026):** retirar `superadmin`, revogar sessão Clerk, remover membership do subject **no tenant da sessão**, suspender tenant ou expirar/revogar suporte faz pedidos e WebSockets daquele contexto falharem **fechados**, sem fallback a permissões globais. Revogar A não deve desligar a sessão Clerk global nem afetar o acesso direto legítimo a B.
- **Aprovação (DEC-029/030/031):** pedidos pendentes expiram em 24 horas desde a criação e não podem ser aprovados no instante do vencimento ou depois. A sessão aprovada antes desse limite tem TTL independente. owner decide apenas na Clinic App após Clerk login e membership owner verificado no backend. E-mail não fornece credenciais para aprovar; pedido pendente, rejeitado ou com aprovação expirada/revogada nunca autoriza leitura ou eventos HTTP/WebSocket. Auditoria regista o owner aprovador. A aprovação não autoriza sessões adicionais.
- **Observabilidade:** logs técnicos e trilha de auditoria que não reproduzem desnecessariamente conteúdo pessoal; política de retenção, base legal, notificação e eventual autorização do cliente/tenant devem ser fechadas antes de usar dados reais.
- **Não repúdio:** qualquer alteração de negócio por suporte deve guardar quem realmente a executou (`actor`) e em cujo contexto (`subject`); preservar correlação com solicitação/ticket de suporte.

## Critérios de aceitação

1. Só `privateMetadata.superadmin === true` booleano no Clerk autoriza criar sessões de suporte; string `"true"` não funciona.
2. Actor sem membership no tenant pode entrar apenas via sessão de suporte ativa; sem ela, API operacional nega.
3. Subject precisa ser membro ativo do tenant; role em A não se transfere para B.
4. Trocar tenant/subject nos parâmetros, cabeçalhos, cookie ou URL não muda o escopo da sessão.
5. Com acesso revogado, sessão expirada ou Clerk indisponível: HTTP e WebSocket negam operações e novos dados.
6. Banner de suporte explícito; encerramento invalida cookie e registro D1.
7. Toda mutação fica com `actor`, `subject`, tenant, motivo e ID da sessão, sem atribuição falsa.
8. Ações proibidas pela política de suporte nunca podem ser executadas, mesmo que o subject fosse owner.
9. Código de handoff de uso único não é reutilizável; testes cobrem replay, CSRF, session fixation e troca de subdomínio.

## Alternativas descartadas

**Clerk impersonation/actor tokens: rejeitados expressamente pelo responsável pelo produto.** Não adicionar essa integração ou dependência para este recurso. O Clerk continua exclusivamente como provedor de autenticação e identidade.

## Implementação pendente

A capacidade e a abordagem são **confirmadas**, mas o código, a migração, os endpoints finais, a autorização de writes, a política de dados e a revisão de segurança ainda **não** foram implementados/aprovados. A F1 deverá conter um plano de testes adversariais para estes pontos.
