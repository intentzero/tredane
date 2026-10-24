# ADR-0011 — Aprovação de cada sessão de suporte pelo owner

**Estado:** DEC-029 (aprovação por sessão), DEC-030 (painel + e-mail) e **DEC-031 (24 horas para pedido pendente)** confirmadas. Duração da sessão confirmada em 30 minutos (DEC-032); continuação por nova solicitação/aprovação definida em DEC-033; UX complementar em aberto.
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

## Expiração do pedido pendente — DEC-031

- Pedido de suporte permanece pendente por **24 horas** desde `created_at` em UTC calculado pelo backend. Persistir `expires_at = created_at + 24 horas` em D1.
- Aprovar exige `status = pending` e `now < expires_at` numa transição atómica. No instante exato de `expires_at` ou depois, rejeitar aprovação e impedir qualquer criação de sessão, handoff, cookie ou acesso HTTP/WebSocket. Fazer validação mesmo que job de expiração esteja atrasado/indisponível.
- E-mail atrasado, reabertura da página, reconexão WebSocket e login no Clerk não prolongam o prazo. Pedido vencido precisa de **nova solicitação e nova aprovação**, sem reativação do antigo.
- Após aprovação **dentro das 24 horas**, a sessão de suporte ativada segue **TTL fixo de 30 minutos desde a ativação (DEC-032)**; não confundir 24 horas de decisão pendente com duração de sessão. Revogação do owner continua aplicável.
- Testes: aprovação imediatamente antes, no limite e após expiração; corrida entre owners; falta de limpeza agendada; relógio do browser alterado; e-mail atrasado; pedido expirado tentando ativar sessão.

## Prazo da sessão de suporte — DEC-032

Após aprovação válida do owner, o Tredane ativa a sessão com `activated_at` UTC do servidor e `expires_at = activated_at + 30 minutos` no D1. A contagem inicia **na ativação**, não no primeiro acesso ou handoff. Exigir sessão `active` e `now < expires_at` em cada API e entrega WebSocket. No instante de vencimento ou depois, negar dados e invalidar ou fechar WebSockets e credenciais de suporte mesmo após hibernação ou sem job de limpeza.

O superadmin pode encerrar a sessão antes dos 30 minutos, com auditoria e invalidação imediata de acesso. Reabrir, manter ativo, autenticar novamente e reconectar não renovam o prazo. **DEC-033 proíbe extensão/renovação: continuar exige novo pedido e aprovação.** A validade de 24 horas do pedido pendente (DEC-031) **não** limita a sessão já aprovada, que tem prazo independente de 30 minutos. Testar no limite, antes, depois, encerramento voluntário, socket ativo/hibernado e corrida com fan-out.

## Continuação do suporte — DEC-033

A sessão própria do superadmin termina ao expirar ou encerrar antecipadamente: **não existe extensão ou renovação da sessão de 30 minutos**. Para continuar, superadmin cria **novo pedido de suporte**, independente, válido por 24 horas, e precisa obter **nova aprovação expressa de owner ativo do tenant**. Apenas depois dessa decisão é criada **nova sessão própria de 30 minutos**, com ID, handoff, cookie, `activated_at`, `expires_at` e auditoria independentes. Não reativar sessão encerrada, reaproveitar aprovação, estender `expires_at` ou oferecer API `extend/renew`. Espera por nova aprovação não concede HTTP/WebSocket. Testar replay, concorrência, troca de owner e isolamento entre tenants.

## Revogação de sessão ativa — DEC-034

**Qualquer owner ativo do mesmo tenant** pode encerrar **qualquer sessão de suporte ativa**, independentemente de quem a aprovou. O superadmin actor pode terminar voluntariamente a própria sessão. O backend valida sessão Clerk, role owner atual no D1 e tenant, ou, para encerramento pelo superadmin, identidade do actor **daquela** sessão; outro superadmin não recebe autorização implícita para terminá-la.

A Clinic App exibe aos owners ativos sessões de suporte do seu tenant e ação **Encerrar suporte**. A API transiciona o estado de `active` para `revoked/ended` **atomicamente** no D1, com revogador, tenant, sessão e instante auditados. Encerramentos repetidos não reativam a sessão. Desde a confirmação, bloquear HTTP e novas entregas WebSocket do suporte, invalidando cookie e handoff. O Durable Object deve encerrar/inutilizar sockets mesmo se hibernados ou se a sinalização falhar; checar autorização vigente antes do fan-out para evitar permissões obsoletas.

Owner de outro tenant e attendant não podem encerrar sessão de A; revogar acesso de suporte não remove o subject do tenant nem encerra Clerk do actor ou outros tenants. Qualquer continuação exige novo pedido e aprovação (DEC-033). Testar O1 aprovador/O2 revogador, solicitações simultâneas, websocket hibernado, concorrência com publicação, replay de cookie e auditoria.

## Notificações após ativação — DEC-035 (opção B)

- Após a transição efetiva para **sessão de suporte `active`** no D1, publicar o evento `support.session.started` apenas aos owners com membership vigente daquele tenant no painel em tempo real e enviar-lhes **e-mail informativo de início**, distinto do e-mail de solicitação pendente (DEC-030). Não emitir aviso de início só por criar ou aprovar um pedido que ainda não tenha resultado numa sessão ativa.
- O painel de owners mostra estado da sessão, identidade do superadmin actor, subject, motivo/escopo, `activated_at`, horário-limite de 30 minutos e botão **Encerrar suporte** (DEC-034). Quando a sessão **expira ou é encerrada antecipadamente**, o painel muda o estado em tempo real; owner offline recupera o histórico atual ao regressar.
- **Não enviar e-mail de término** por expiração, encerramento manual pelo superadmin, ou revogação por owner no MVP. Preservar no D1 e auditoria quem iniciou, quem aprovou, quem encerrou, datas e causas do fim; não perder o estado quando um aviso em WebSocket falha.
- O e-mail de início é somente informativo, sem PHI/dados clínicos, cookie, handoff, token ou link de autorização. Se houver link, leva à página de estado dentro do Tredane, exigindo Clerk e membership owner atual no tenant. Enviar **uma notificação lógica por sessão/destinatário**, com chave idempotente para duplicações/retries. Provedor, entrega e política de retentativas continuam a especificar.
- A sessão é autorizada pela aprovação válida e pelo estado do D1, **nunca pela entrega de e-mail**; atraso/falha do e-mail não impede início nem modifica prazo, revogação ou a auditoria. Não mostrar sessões de A a owners apenas de B. Testar início uma vez, reconexão, e-mail duplicado/perdido e as três formas de término.

## Visibilidade para owners e utilizador representado — DEC-036

- Durante uma sessão de suporte `active`, **todos os owners ativos daquele tenant** acompanham actor, subject, estado, início, prazo e encerramento no painel, incluindo a ação **Encerrar suporte** (DEC-034).
- **Além dos owners, apenas o próprio utilizador representado (`subject_clerk_user_id`) vê na sua sessão normal da Clinic App um aviso visível e específico** indicando que um superadmin está a atuar no contexto da sua conta **naquele tenant**. É transparência, **não uma sessão Clerk do superadmin autenticada como o subject**. O aviso mínimo mostra estado de suporte ativo e identificação do suporte, sem expor pedidos de aprovação, segredos ou conteúdo clínico.
- O subject recebe o aviso via evento **restrito a tenant + identidade Clerk do subject**, não por broadcast a todos os attendants. Outros attendants da mesma clínica não são notificados, salvo se forem também owners autorizados noutro contexto — o que não deve permitir dados de outra clínica. Se o subject também for owner, apresenta-se uma UI coerente sem avisos duplicados.
- O aviso começa só após a ativação efetiva da sessão. Quando a sessão expira em 30 minutos ou é encerrada por owner/actor, o aviso no painel do subject cessa ou mostra o estado final; após reconexão, recarregar estado autoritativo para não deixar indicadores desatualizados. Se o subject não estiver online, não existe exigência de notificação offline nesta decisão.
- **DEC-035 permanece:** o e-mail de início é dirigido aos owners, **não** ao subject (salvo se também tiver role owner); não criar novo e-mail para subject sem decisão futura.
- O aviso de subject **não concede** aprovação, revogação ou outros privilégios além da membership habitual. DEC-034 continua a definir quem encerra a sessão. Casos de teste: subject attendant, subject owner, dois attendants na mesma clínica, dois tenants no mesmo Clerk user, múltiplas abas, WebSocket hibernado e logout/remoção de membership.

## Contrato técnico candidato — não implementado

1. Superadmin autenticado com `privateMetadata.superadmin === true` verificado no backend cria `support_access_requests` em estado `pending` no D1, com actor/subject/tenant/motivo/escopo.
2. Owner da mesma clínica recebe o pedido em tempo real no painel e aviso por e-mail com link de navegação. Já autenticado pelo Clerk, com membership `owner` ativa revalidada pelo backend, vê os dados não sensíveis necessários para decidir e **aprova/rejeita expressamente somente no painel**. Sem resposta o pedido continua sem acesso.
3. A decisão é auditada com owner, actor, subject, tenant, escopo, resultado e data. Criar `support_sessions` exige pedido `approved` vigente; bind imutável ao pedido, sem permitir outra sessão pela mesma autorização ou mudar parâmetros.
4. Após aprovação, emitir handoff de uso único e cookie opaco seguro ligado à sessão Clerk do actor; cada pedido e cada entrega WebSocket valida sessão de suporte, decisão do owner, subject ativo, tenant, TTL e capacidades.
5. Retirada de aprovação, expiração de **pedido ainda pendente antes da ativação**, expiração do **TTL próprio da sessão já ativada**, suspensão de tenant, remoção do subject e revogação da flag superadmin impedem ou encerram acesso conforme o estado; falha de consulta nega por padrão.
6. A auditoria de suporte preserva actor, subject e owner aprovador, motivo, decisão, operações realizadas e encerramento. A Clinic App exibe banner persistente de modo suporte.

### Modelo lógico proposto

`support_access_requests(id, tenant_id, actor_clerk_user_id, subject_clerk_user_id, reason, scope, status, decided_by_owner_clerk_user_id?, decided_at?, created_at, expires_at?, revoked_at?)`

`support_sessions` guarda `support_access_request_id` e `approved_by_owner_clerk_user_id`, sem impersonação/actor token Clerk.

Estados: `pending`, `approved`, `rejected`, `expired`, `revoked` e `cancelled`. Transições concorrentes e múltiplas sessões por autorização devem ser testadas.

## Pendências explícitas

- **Revogação de sessão ativa por qualquer owner do tenant confirmada em DEC-034**; notificações e UX detalhada ainda em aberto. Prazo de pedido pendente fixado em 24 horas por DEC-031.
- **DEC-035 fixou aviso de início por e-mail e atualização de encerramento apenas no painel**; falta validar UX detalhada, persistência e entregabilidade. Decisão de quem revoga fechada em DEC-034. Pedido pendente expira em 24 horas (DEC-031).
- **DEC-034 confirmou que qualquer owner ativo da clínica revoga sessão de suporte**, inclusive aprovada por outro; DEC-035 confirma **e-mail no início e encerramento só no painel**, com UX complementar por validar.
- Privacidade/LGPD, retenção de pedidos e logs, política sem owner disponível e revisão de segurança com dados reais.

A decisão de produto não representa implementação nem aprovação para dados reais.
