# Requisitos do MVP

**Estado:** catálogo proposto para revisão, derivado de [jornadas](journeys.md), [atores](actors-permissions.md) e [estados](states.md), com [cenários de aceite](acceptance.md). **Prioridade:** “MVP” indica candidato à primeira entrega, não aprovação definitiva. Os IDs são estáveis. Cada requisito deve ser demonstrado com duas clínicas de teste quando envolver dados ou eventos de tenant.

## Identidade e isolamento

### REQ-001 — Acesso por clínica

**Prioridade/estado:** MVP / Proposto. **Origem:** ACT-02, ACT-03; JRN-04, JRN-07. **Comportamento:** toda leitura, mutação e subscrição em tempo real usa uma associação vigente entre usuário e clínica. IDs recebidos do navegador não concedem acesso. **Aceite:** usuário da clínica A não consegue obter nem alterar conversa, contato, oportunidade, agendamento ou arquivo da clínica B por interface, URL, ID direto ou evento WebSocket. **Dados/eventos:** D1, R2, Durable Objects, Queues e Workflows preservam o contexto de tenant.

### REQ-002 — Permissão por papel e ação

**Prioridade/estado:** MVP / Confirmado para atendimento; administração em aberto. **Origem:** ACT-02, ACT-03; JRN-02, JRN-07. **Comportamento:** atendente e responsável podem ver todas as conversas da própria clínica, responder, atribuir, mover oportunidades e operar agendamentos; o responsável pode fazer tudo que o atendente faz. Gestão de attendants pelo owner está confirmada; outras permissões administrativas e integração estão em aberto. **Aceite:** ambos executam essas ações na própria clínica, mas são negados para outra clínica; ação administrativa não autorizada não altera dados. **Dados/eventos:** a resposta não revela conteúdo de outro tenant nem publica evento de ação negada.

### REQ-003 — Revogação de acesso por tenant

**Prioridade/estado:** MVP / Comportamento confirmado (DEC-026); protocolo técnico e testes em aberto. **Origem:** ACT-02, ACT-03; JRN-07, JRN-12, [ADR-0009](../adr/0009-tenant-membership-revocation.md). **Comportamento:** remover membership de A impede imediatamente novas leituras e mutações, eventos e conexões WebSocket no tenant A, com aviso à interface; a sessão Clerk continua válida e o usuário permanece autorizado em B quando tiver membership ativo. A revogação de acesso operacional de um subject em A torna inválidas as autorizações das sessões próprias de suporte que o representem em A. **Aceite:** após confirmação da revogação, nenhum pedido ou entrega posterior de conteúdo em A é autorizada; conexões antigas devem parar de receber eventos e ser encerradas/invalidadas, inclusive após hibernação/reconexão. Sessões do mesmo usuário em B não perdem acesso. **Dados/eventos:** transição do membership no D1 e auditoria de quem removeu, alvo, tenant e instante; projetar e testar sinalização ao Durable Object e verificação efetiva antes de entregar dados. Operações concorrentes e possíveis entregas anteriores à confirmação devem ser testadas, sem prometer recolher dados já recebidos.

### REQ-004 — Ativação e associação de membros

**Prioridade/estado:** MVP / Confirmado quanto à delegação (DEC-020); convite e revogação técnica em aberto. **Origem:** ACT-03/05, JRN-08/09/10/12. **Comportamento:** superadmin cria tenant e atribui primeiro owner; owner convida/remove attendants apenas nesse tenant. Exclusivamente superadmin pode atribuir, promover, substituir ou remover owners. Attendant não gere membros. Memberships N:N são guardados no D1 sem Clerk Organizations. **Aceite:** owner não pode promover outro owner nem alterar membros de tenant onde não é owner; remoção em A preserva B; impedir ativação de tenant sem owner; todas as alterações auditadas. **Confirmado em DEC-026:** revogação imediata por tenant, sem logout Clerk e sem afetar memberships de outras clínicas. **Pendente:** revisão do protocolo técnico de WebSocket, proteção do último owner e testes da F1.

### REQ-008 — Convite de attendant por e-mail

**Prioridade/estado:** MVP / Confirmados convite por e-mail (DEC-021), validade de 7 dias (DEC-022), reenvio com substituição (DEC-023) e limites (DEC-024): cooldown 10 minutos e quota 5 reenvios por janela móvel de 24 horas por tenant/e-mail. **Origem:** owner e Platform Admin, JRN-12. **Comportamento:** owner em A convida por e-mail apenas como attendant em A; o link contém token aleatório de uso único, cujo verificador é guardado no D1. Destinatário entra/cria conta Clerk; apenas e-mail verificado correspondente permite consumir o convite. Aceitação válida cria membership somente em A e mantém outros tenants. **Aceite:** token reutilizado, inválido/revogado/expirado, conta com e-mail verificado diferente, role alterada no cliente ou owner sem autorização não criam membership. A concessão do membership e o consumo do convite devem ser atómicos. **Prazo confirmado:** `expires_at = issued_at + 7 dias (168 horas)`. Aceitar exige `now < expires_at` verificado na transação no backend. **Reenvio (DEC-023):** owner autorizado emite token novo para o mesmo e-mail/tenant; nova expiração de 7 dias; o token anterior é invalidado **atomicamente** na substituição no D1. Se forem solicitados dois reenvios concorrentes, só o último token ativo pode ser aceite. **Limites confirmados (DEC-024):** verificar no backend, por tenant e e-mail normalizado, no mínimo 10 minutos desde o último reenvio e no máximo 5 reenvios autorizados durante as últimas 24 horas. Aplicar de modo atómico face a solicitações concorrentes; rejeição não invalida convite existente e não reinicia contador com token novo. **DEC-025:** qualquer owner ativo do tenant pode cancelar convite pendente do próprio tenant, ainda que emitido por outro owner, com mudança atómica pending→cancelled no D1, link invalidado de imediato e auditoria. Convite aceite não pode ser cancelado para remover membership; cancelamento versus aceite concorrentes resolve-se atomicamente. Um owner apenas de B não cancela convite de A. **Pendente:** provedor de entrega, revogação de membership e controles antiabuso adicionais.

### REQ-009 — MFA (postergado por DEC-028)

**Prioridade/estado:** **Posterior, fora do MVP**. Nenhuma role exige MFA no MVP, incluindo superadmin/owner/attendant. Não implementar inscrição, desafios, gates ou step-up MFA. Autenticação pelo Clerk continua obrigatória e toda autorização tenant-scoped, flag privada superadmin, auditoria e controles da impersonação própria permanecem vigentes. **Aceite:** usuários corretamente autenticados/autorizados podem operar Admin/Clinic App sem desafio MFA; identidades sem roles/flag são negadas. Reavaliar MFA em versão futura. [ADR-0010](../adr/0010-role-scoped-mfa.md).

### REQ-005 — Identidade Clerk e membership multi-tenant

**Prioridade/estado:** MVP / Confirmado na arquitetura. **Origem:** DEC-007/017, ACT-02/03, JRN-09. **Comportamento:** Clerk autentica identidade e sessão, sem Organizations; o D1 guarda `tenant_memberships` N:N, papel e estado para cada tenant. Um usuário pode ser responsável em A e atendente em B, com contexto explícito por aba/rota. **Aceite:** listagem mostra só tenants associados; cada acesso revalida role e associação e não permite cruzar recursos entre A e B; revogação em A não altera membership de B. **Dados/eventos:** identidade Clerk e memberships no D1; WS/Queues mantêm tenant.

### REQ-006 — Administração de tenants

**Prioridade/estado:** MVP interno / Confirmado como capacidade. **Origem:** DEC-018, ACT-05, JRN-10. **Comportamento:** a Platform Admin permite criar, editar, suspender, reativar e iniciar exclusão lógica de tenants. A API verifica no Clerk o valor **booleano exato** `privateMetadata.superadmin === true` no backend. **Aceite:** usuário não autenticado recebe 401, usuário sem flag válida recebe 403; ausência da flag, texto `"true"` ou indisponibilidade da verificação não concede acesso. Toda mutação é auditada e não expõe mensagens/agenda de clientes. **Dados:** cadastro de tenants no D1 e histórico administrativo.

### REQ-061 — TTL da sessão de suporte

**Prioridade/estado:** MVP interno / DEC-032 aprovada. Após a aprovação de owner ativar `support_sessions` com `activated_at` UTC e `expires_at = activated_at + 30 minutos` em D1. Autorizar HTTP e WebSocket apenas enquanto sessão está `active` e `now < expires_at` e demais verificações de identidade/tenant/role estejam válidas. Expiração ou encerramento manual antecipado invalidam sessão e conexões de suporte, com auditoria e sem logout global do Clerk. Não renovar por atividade, handoff, refresh ou reconexão. Expiração deve funcionar sem job; testes de limite e DO em hibernação. **Continuação por novo pedido e nova aprovação definida em DEC-033.** Prazo do pedido pendente é 24h pela DEC-031.

### REQ-062 — Continuar suporte requer novo pedido e aprovação

**Prioridade/estado:** MVP interno / DEC-033 confirmada. Sessões de suporte de 30 minutos não podem ser prolongadas. Para continuar, o superadmin cria outro pedido sujeito a validade de 24 horas e a aprovação explícita de owner ativo do tenant (DEC-029/030/031); só então ativa nova sessão de 30 minutos (DEC-032), com novas credenciais e auditoria. **Aceite:** bloquear `extend/renew`, atualização de prazo, reutilização de aprovação, handoff/cookie antigo e WebSocket da sessão encerrada. Nenhuma nova autorização surge sem nova decisão favorável.

### REQ-063 — Revogação de sessão ativa pelo owner da clínica

**Prioridade/estado:** MVP interno / Confirmado (DEC-034). Qualquer owner com membership ativo no tenant pode encerrar qualquer sessão de suporte `active` do próprio tenant, mesmo se aprovada por outro owner. O superadmin actor também pode encerrar a sua própria sessão. A API valida Clerk, membership owner vigente no tenant ou actor vinculado à sessão, e revoga atomicamente no D1, auditando revogador, tenant, sessão, instante e resultado. A revogação bloqueia imediatamente novas chamadas HTTP e entrega de eventos WebSocket, inclusive sockets hibernados/reconectados, e invalida cookie/handoff. Não alterar memberships, outras clínicas ou sessão Clerk. **Aceite:** O2 encerra sessão aprovada por O1 em A; attendant de A, owner exclusivo de B e superadmin não actor não ganham poder de revogação; concorrência/solicitações repetidas não reativam a sessão. Protocolo DO e testes em F1. [ADR-0011](../adr/0011-owner-approval-for-support.md).

### REQ-064 — Aviso de início e acompanhamento do suporte

**Prioridade/estado:** MVP interno / Comportamento confirmado (DEC-035), mecanismo de e-mail a implementar. **Comportamento:** ao ativar efetivamente uma sessão de suporte previamente aprovada, publicar mudança de estado no painel de owners ativos do mesmo tenant e enviar-lhes e-mail **informativo de início**, uma vez por sessão/destinatário. Painel indica sessão ativa, actor, escopo, `activated_at`, `expires_at`, estado e botão Encerrar suporte. Ao terminar, por expiração ou manualmente, atualizar painel em tempo real, manter auditoria do motivo/ator e **não enviar e-mail de término**. **Aceite:** pedido ainda pendente ou aprovado sem sessão ativa não dispara e-mail de início; owner de outro tenant não vê dados de A; e-mail sem PHI/tokens e sem autoridade para suporte; falha ou duplicação de envio não cria sessões nem muda seus estados; status após reconexão reflete D1. **Pendente:** provedor, retries/outbox, UX e segurança do fan-out DO. [ADR-0011](../adr/0011-owner-approval-for-support.md).

### REQ-065 — Aviso contextual ao utilizador representado

**Prioridade/estado:** MVP interno / Confirmado por DEC-036. Quando uma sessão própria de suporte está `active`, a Clinic App exibe a **todos os owners ativos do tenant** a visão de acompanhamento e, adicionalmente, ao **subject autenticado no Clerk** um aviso específico na **própria conta/tenant** de que há suporte atuando no seu contexto. O aviso ao subject não requer e-mail separado e **não é mostrado a outros attendants**. Deve ser encaminhado por eventos WebSocket identificados por tenant e subject e reconciliado por consulta autoritativa depois de login/reconexão; expiração/revogação remove ou altera o aviso. O e-mail inicial aprovado em DEC-035 continua apenas para owners. A exibição não cria permissão para aprovar/terminar suporte, nem simula login Clerk como subject. **Aceite:** owner O1/O2 veem painel de suporte; subject S vê aviso na sessão própria; attendant T não vê aviso relativo a S; vínculo B não mostra estado de A; após fim S deixa de ver sessão ativa. [ADR-0011](../adr/0011-owner-approval-for-support.md).

### REQ-066 — Subject pode pedir fim de sessão de suporte

**Prioridade/estado:** MVP interno / Comportamento confirmado em DEC-037; prazo de resposta de owner em aberto. **Comportamento:** durante sessão `active`, o subject autenticado no Clerk, com membership vigente no tenant correto, pode clicar em **Solicitar encerramento** no aviso da sua conta. Registrar pedido no D1 e auditoria, notificar todos os owners ativos do tenant **em tempo real no painel**, e deixar que owner decida encerrar via DEC-034 ou manter, documentando quem decidiu e quando. **Enquanto a decisão não ocorre, a sessão continua** até término manual ou os 30 minutos fixos. O subject não recebe poder de revogação; outros attendants e tenants não podem enviar pedidos em seu nome. Repetições do mesmo pedido pendente são idempotentes; expiração/revogação encerra o pedido ainda aberto. **Aceite:** API revalida subject/tenant/sessão ativa, nega forja; decisão de owner é atómica e auditada; indicação do subject e painel reconstituem estado após reconexão. **Em aberto:** SLA/timeout de pedido sem resposta, UX e antiabuso para novos pedidos após rejeição. [ADR-0011](../adr/0011-owner-approval-for-support.md).

### REQ-060 — Aviso e decisão de solicitações de suporte

**Prioridade/estado:** MVP interno / Canal DEC-030 e validade de **24 horas** do pedido DEC-031 confirmados; serviço de e-mail ainda em aberto; duração de sessão fixada em 30 minutos (DEC-032) e política de avisos em DEC-035. **Comportamento:** a Clinic App apresenta solicitações pendentes em tempo real aos owners ativos do tenant; também envia notificação por e-mail com link para abrir a página da solicitação, sem segredo/token de aprovação nem dados clínicos. A decisão de aprovar/rejeitar **só acontece na Clinic App**, com identidade Clerk e membership owner revalidados no Worker. **Aceite:** owners de A veem pedidos A, nunca de B; abrir link sem login não revela conteúdo ou aprova; uma única decisão transacional é aceita para vários owners; falha/reenvio do e-mail não concede suporte, nem impede decisão no painel. **Prazo DEC-031:** `expires_at = created_at + 24h`, server-side UTC; só aprovar `pending` com `now < expires_at` de modo atómico. Pedidos vencidos não concedem sessões/handoff, mesmo sem job de limpeza; requer novo pedido. **Pendente:** TTL da sessão ativada, fornecedor de e-mail, retentativas, antispam e detalhes de UX.

### REQ-007 — Impersonação própria para suporte

**Prioridade/estado:** MVP interno / Confirmado como capacidade e solução própria; detalhes de segurança e operação Em aberto. **Origem:** DEC-019, ACT-05, JRN-11, ADR-0007. **Comportamento:** superadmin pode solicitar sessão própria para agir no contexto de membro do tenant, mas **só poderá ativá-la depois de aprovação explícita de owner ativo daquele tenant para o pedido específico (DEC-029)**. Solicitação pendente, negada, expirada ou revogada não autoriza conteúdo clínico. Clerk continua autenticando o **actor real**; não usamos impersonação do Clerk. O subject determina a role efetiva, limitada adicionalmente pela política de suporte. Todas as ações registam actor, subject, tenant, motivo e sessão. **Aceite:** sem aprovação, nenhum handoff, cookie ou acesso de suporte HTTP/WebSocket; aprovação por owner atual do tenant vinculada a actor, subject, motivo e escopo, não reutilizável para nova sessão. Session expirada/revogada nega acesso; IDs alterados falham; auditoria distingue actor, subject e owner aprovador. **Dados/eventos:** `support_access_requests`, `support_sessions`, `support_audit_events` no D1, com aprovação e identidade do owner. Canal aprovado em DEC-030 e validade do pedido pendente em 24 horas definida na DEC-031; TTL da sessão confirmado em 30 minutos (DEC-032); handoff seguro e renovação em aberto; [ADR-0011](../adr/0011-owner-approval-for-support.md).

## WhatsApp e conversa

### REQ-010 — Contato e conversa

**Prioridade/estado:** MVP / Proposto. **Origem:** ACT-01, ACT-02; JRN-01. **Comportamento:** mensagem recebida de número conectado identifica ou cria contato e conversa dentro da clínica correta. **Aceite:** primeiro contato cria um registro; mensagem posterior do mesmo identificador nessa clínica reaproveita o contato e a conversa conforme regra de reabertura a definir. O mesmo número em outra clínica não compartilha dados. **Dados/eventos:** contato, conversa, tenant e evento de caixa de entrada.

### REQ-011 — Histórico e idempotência de entrada

**Prioridade/estado:** MVP / Proposto. **Origem:** ACT-02; JRN-01, JRN-06. **Comportamento:** guardar mensagem recebida com origem, identificador externo, horário e estado; reentrega do mesmo evento não cria duplicata. **Aceite:** repetir o webhook válido com o mesmo identificador mantém uma única mensagem lógica; evento inválido ou não associado a clínica não entra em conversa alguma. **Dados/eventos:** mensagem e trilha de processamento por tenant.

### REQ-012 — Resposta e estado de envio

**Prioridade/estado:** MVP / Proposto. **Origem:** ACT-02, ACT-03; JRN-02, JRN-06. **Comportamento:** usuário autorizado envia resposta pela integração oficial e acompanha tentativa, sucesso, falha, resultado desconhecido e estados de entrega disponíveis. **Aceite:** a interface não marca como enviada uma mensagem que falhou ou cujo resultado é desconhecido; uma nova tentativa não é iniciada automaticamente enquanto o resultado anterior estiver incerto. **Dados/eventos:** mensagem e estado publicados apenas ao tenant correto.

### REQ-013 — Falha recuperável

**Prioridade/estado:** MVP / Proposto. **Origem:** ACT-02, ACT-03; JRN-06. **Comportamento:** falha temporária de webhook, fila ou envio fica observável; eventos de entrada são reprocessáveis sem duplicar registros, e envios incertos exigem reconciliação antes de repetir. **Aceite:** em falha simulada, equipe vê o estado e o processamento posterior mantém histórico lógico único; falha permanente exige ação operacional identificável. **Dados/eventos:** registrar causa técnica sem expor credenciais ou dados pessoais em logs.

## Atendimento e pipeline

### REQ-020 — Caixa de entrada e responsável

**Prioridade/estado:** MVP / Confirmado quanto à visibilidade; atribuição proposta. **Origem:** ACT-02, ACT-03; JRN-02. **Comportamento:** ambos localizam todas as conversas da própria clínica, veem a última interação e podem assumir ou transferir o responsável. **Aceite:** conversas atribuídas a outro membro continuam visíveis aos dois perfis; a atribuição aparece em duas sessões autorizadas e disputa simultânea produz um responsável final claro. **Dados/eventos:** conversa, membro e evento de atribuição, sempre restritos ao tenant.

### REQ-021 — Histórico de atendimento

**Prioridade/estado:** MVP / Proposto. **Origem:** ACT-02, ACT-03; JRN-02. **Comportamento:** conversa mostra mensagens em ordem, estados, responsável e ações relevantes. **Aceite:** após atualização ou reconexão, a sequência e os estados correspondem ao registro persistido; usuário de outro tenant não consegue acessar o histórico. **Dados/eventos:** mensagens e auditoria mínima.

### REQ-022 — Resposta assistida por IA

**Prioridade/estado:** MVP / Proposto. **Origem:** ACT-02, ACT-03; JRN-02. **Comportamento:** IA pode sugerir resposta e resumo; pessoa autorizada revisa e aciona o envio. **Aceite:** a sugestão é identificada, editável e nunca vira mensagem enviada sem ação humana; falha da IA não bloqueia resposta manual. **Dados/eventos:** origem da sugestão e decisão de envio; provedor e contexto permitido ainda em aberto.

### REQ-023 — Oportunidade no pipeline

**Prioridade/estado:** MVP / Proposto. **Origem:** ACT-02, ACT-03; JRN-03, JRN-04. **Comportamento:** uma oportunidade vinculada ao contato/conversa mostra etapa, responsável, última interação e próximo compromisso; mudanças têm histórico. **Aceite:** mover etapa atualiza painel de duas sessões da clínica; clínica diferente não vê a oportunidade. **Dados/eventos:** etapas iniciais propostas em `docs/MVP.md`; transições e regra de reabertura ainda precisam de validação.

## Agenda própria

### REQ-030 — Disponibilidade

**Prioridade/estado:** MVP / Confirmado quanto aos tipos de recurso; detalhes em aberto. **Origem:** ACT-02, ACT-03; JRN-03. **Comportamento:** equipe consulta horários disponíveis conforme serviço, duração, expediente, bloqueios, profissional e sala/equipamento exigidos. **Aceite:** um intervalo ocupado ou bloqueado não aparece como disponível quando qualquer recurso necessário conflita; duração, buffers e regras de disponibilidade dependem da clínica piloto. **Dados/eventos:** serviço, recurso e disponibilidade sempre por tenant.

### REQ-031 — Confirmação sem conflito

**Prioridade/estado:** MVP / Proposto. **Origem:** ACT-02, ACT-03; JRN-03, JRN-05. **Comportamento:** confirmar horário cria agendamento ligado ao contato e à oportunidade somente se os recursos ainda estiverem livres. **Aceite:** duas tentativas simultâneas para o mesmo recurso e intervalo produzem no máximo uma confirmação; a outra recebe conflito compreensível. **Dados/eventos:** agendamento persistido antes do evento em tempo real.

### REQ-032 — Cancelamento e reagendamento

**Prioridade/estado:** MVP / Proposto. **Origem:** ACT-01, ACT-02, ACT-03; JRN-05. **Comportamento:** equipe registra cancelamento ou confirma novo horário, preservando histórico e liberando ou ocupando recursos de modo coerente. **Aceite:** agenda, conversa e oportunidade mostram o mesmo estado; conflito no novo horário não apaga o compromisso anterior. **Dados/eventos:** política de prazo e motivo obrigatório permanecem em aberto.

### REQ-033 — Comunicação do compromisso

**Prioridade/estado:** MVP / Proposto. **Origem:** ACT-01, ACT-02, ACT-03; JRN-03, JRN-05. **Comportamento:** equipe pode comunicar confirmação, cancelamento ou mudança ao contato via WhatsApp, com estado de envio separado do estado do agendamento. **Aceite:** falha de mensagem não reverte silenciosamente agendamento confirmado; painel mostra a falha para acompanhamento. **Dados/eventos:** conversa e agendamento vinculados.

### REQ-034 — Visão da agenda

**Prioridade/estado:** MVP / Proposto. **Origem:** ACT-02, ACT-03; JRN-04. **Comportamento:** membros autorizados veem compromissos da clínica com horário, recurso, contato e estado necessários à operação. **Aceite:** alteração feita em uma sessão aparece na outra e não expõe agenda de outra clínica. **Dados/eventos:** atendente e responsável acessam a agenda da própria clínica; permissões administrativas adicionais continuam em aberto.

## Tempo real

### REQ-040 — Eventos da clínica

**Prioridade/estado:** MVP / Confirmado como capacidade; eventos específicos propostos. **Origem:** ACT-02, ACT-03; JRN-01, JRN-03, JRN-04, JRN-07. **Comportamento:** após persistência, mudanças de mensagem, responsável, etapa e agendamento são enviadas por WebSocket com hibernação às sessões autorizadas da clínica. **Aceite:** duas sessões do tenant A veem a mudança sem recarregar; sessão do tenant B não recebe o evento nem dados associados. **Dados/eventos:** payload mínimo, com autorização no servidor.

### REQ-041 — Reconexão e convergência

**Prioridade/estado:** MVP / Proposto. **Origem:** ACT-02, ACT-03; JRN-02, JRN-07. **Comportamento:** após queda, hibernação ou evento perdido, o painel volta ao estado persistido por nova leitura da API. **Aceite:** mudar dados durante a desconexão e reconectar deixa as duas sessões com o mesmo estado canônico; eventos repetidos não duplicam itens na interface. **Dados/eventos:** memória do Durable Object não é fonte única de verdade.

### REQ-042 — Estado da conexão

**Prioridade/estado:** MVP / Proposto. **Origem:** ACT-02, ACT-03; JRN-04, JRN-07. **Comportamento:** painel informa quando pode estar desatualizado e retoma sincronização sem depender de recarga manual. **Aceite:** durante desconexão simulada há indicação de estado; ao reconectar, dados são reconciliados e a indicação some. **Dados/eventos:** não apresentar alterações locais não confirmadas como persistidas.

## Integrações e dados

### REQ-050 — Associação verificada do webhook

**Prioridade/estado:** MVP / Proposto. **Origem:** ACT-06; JRN-01, JRN-06. **Comportamento:** webhook da API oficial é validado e roteado para a clínica associada à conta/número conectado. **Aceite:** payload inválido ou número desconhecido não cria contato, mensagem ou evento em qualquer tenant. **Dados/eventos:** credenciais e identificadores de integração não entram em logs públicos.

### REQ-051 — Conexão da conta WhatsApp

**Prioridade/estado:** MVP / Em aberto. **Origem:** ACT-03, ACT-05; JRN-08. **Comportamento:** o MVP precisa de forma controlada de associar uma conta/número oficial a uma clínica. **Aceite:** definir fluxo e responsável antes de ligar números reais; uma conta conectada não pode ser roteada para duas clínicas por engano. **Dados/eventos:** onboarding e gestão de segredo dependem da decisão de integração.

### REQ-052 — Configuração mínima da clínica

**Prioridade/estado:** MVP / Em aberto quanto ao fluxo de configuração. **Origem:** ACT-03; JRN-08. **Comportamento:** antes de agendar, clínica configura serviços, durações, profissionais, salas/equipamentos e disponibilidade mínimos. **Aceite:** o fluxo de ativação não libera agendamentos sem configuração exigida pela regra de agenda aprovada. **Dados/eventos:** escopo de autosserviço e papel que edita ainda em aberto.

### REQ-060 — Dados usados pela IA

**Prioridade/estado:** MVP / Em aberto. **Origem:** ACT-02, ACT-03; JRN-02. **Comportamento:** contexto enviado à IA deve ser limitado ao necessário para a sugestão e ao tenant da conversa. **Aceite:** antes de uso com dados reais, documentar campos permitidos, provedor, retenção e revisão; teste entre duas clínicas não permite contexto cruzado. **Dados/eventos:** não usar dados reais enquanto a política estiver pendente.

### REQ-070 — Observabilidade do fluxo

**Prioridade/estado:** MVP / Proposto. **Origem:** ACT-02, ACT-03; JRN-06. **Comportamento:** falhas de entrada, fila, envio e atualização em tempo real podem ser identificadas sem expor conteúdo sensível em logs. **Aceite:** para falhas simuladas, é possível localizar tenant, tipo de evento, etapa e resultado técnico; a equipe vê falhas que exigem ação no painel. **Dados/eventos:** retenção e acesso a logs ainda precisam de política.

## Racional de prioridade — proposta para aprovação

Os requisitos abaixo estão categorizados como **MVP candidato** (ou **MVP interno** para gestão da plataforma) porque contribuem para a primeira jornada demonstrável, para a segurança multi-tenant ou para operar a plataforma sem depender de intervenção no banco. Estas justificativas **não significam aprovação final**, nem liberam uso de dados reais. Quando parte do comportamento estiver em aberto, a aprovação da prioridade não fecha a regra de produto.

| ID | Prioridade proposta | Porquê nesta fase |
| --- | --- | --- |
| REQ-001 | MVP | Isolamento de dados é pré-condição de qualquer operação multi-tenant. |
| REQ-002 | MVP | Atendente e responsável precisam de autorizações distintas da administração global. |
| REQ-003 | MVP | Revogação tem de cortar acesso real, inclusive conexões em tempo real. |
| REQ-004 | MVP | Clínica precisa de responsável e membros associados para ativação controlada. |
| REQ-005 | MVP | A mesma identidade pode pertencer a várias clínicas; role depende do tenant. |
| REQ-006 | MVP interno | Platform Admin é o mecanismo definido para criar e gerir tenants. |
| REQ-007 | MVP interno | Acesso de manutenção exigido pelo produto; limitar primeiro a leitura/diagnóstico até política de segurança aprovada. |
| REQ-010 | MVP | Criação de contacto/conversa inicia toda a jornada de atendimento. |
| REQ-011 | MVP | Idempotência é necessária para não duplicar histórico e oportunidades. |
| REQ-012 | MVP | Resposta manual é núcleo do atendimento; estado real evita sucesso falso. |
| REQ-013 | MVP | Falhas de integração precisam ser recuperáveis sem mensagens duplicadas. |
| REQ-020 | MVP | Inbox partilhada e atribuição permitem que a equipe assuma conversas. |
| REQ-021 | MVP | Histórico é indispensável para continuidade do atendimento. |
| REQ-022 | MVP | Testar utilidade de IA assistiva sem autorizar ação autónoma. |
| REQ-023 | MVP | Pipeline liga interesse e acompanhamento ao compromisso. |
| REQ-030 | MVP | Sem disponibilidade por recursos não há reserva válida. |
| REQ-031 | MVP | Concorrência de reserva não pode criar conflitos reais. |
| REQ-032 | MVP | Remarcação e cancelamento são exceções essenciais do agendamento. |
| REQ-033 | MVP | Comunicar mudança é necessário, mantendo estado da mensagem separado do compromisso. |
| REQ-034 | MVP | Equipa deve localizar e gerir compromissos da própria clínica. |
| REQ-040 | MVP | Tempo real entre sessões foi assumido como requisito arquitetural do produto. |
| REQ-041 | MVP | Reconciliação após queda evita visões permanentemente incorretas. |
| REQ-042 | MVP | Equipa precisa de sinalização de desconexão para não confiar em estado obsoleto. |
| REQ-050 | MVP | Webhook autenticado e número associado ao tenant são fronteira de segurança. |
| REQ-051 | MVP | Sem vinculação verificável de número, não existe atendimento WhatsApp real. |
| REQ-052 | MVP | Agenda exige serviços, recursos e disponibilidade configurados. |
| REQ-060 | MVP | É preciso definir e limitar o contexto antes de usar IA com clientes. |
| REQ-070 | MVP | Suporte e piloto dependem de diagnóstico de falhas sem expor dados pessoais. |

**Fora do MVP (já definido):** prontuário, pagamentos, estoque, integração com agendas externas, campanhas em massa, bot com envios ou reservas autónomas, painéis de profissionais e relatórios avançados. **Posterior:** autosserviço avançado de onboarding, configurações sofisticadas de pipeline e automações de IA, exceto se outra decisão formal substituir este recorte.

**Gate para aprovar a prioridade:** responsável pelo produto confirmar o recorte e aceitar que os itens administrativos internos podem avançar na F1 sem atrasar a demonstração Inbox → pipeline → agenda da clínica. Os detalhes ainda em aberto estão em [decisões](decisions.md) e [registro de validação](validation-register.md).

## Fora do MVP

**Fora do MVP:** prontuário/registro clínico, pagamentos, estoque, agendas externas, campanhas em massa, bot que responde ou agenda sozinho e relatórios avançados. Nenhum requisito acima deve ser interpretado como compromisso de implementar essas funções.

## Lacunas para revisão

Antes de converter este catálogo em issues de implementação, fechar ou manter com hipótese explícita: Q-ACT-04 a Q-ACT-06; duração e disponibilidade da agenda; onboarding do WhatsApp; identidade; provedor/contexto da IA; retenção de dados; D1 compartilhado ou separado por clínica. Ver [decisões](decisions.md).
