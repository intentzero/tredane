# Cenários de aceite do MVP

**Estado:** rascunho para validação de produto. Execute com dados fictícios e duas clínicas de teste independentes, A e B. Os cenários concretizam os [requisitos](requirements.md) e as [jornadas](journeys.md); não afirmam que o software já existe.

## Isolamento e acesso

### AC-01 — Acesso cruzado negado

**Dado** um atendente associado apenas à clínica A e uma conversa, arquivo e agendamento da clínica B; **quando** ele tenta abrir cada item pela interface ou por ID direto; **então** o sistema nega acesso sem retornar conteúdo, não altera dados de B e não publica evento para A ou B. **Requisitos:** REQ-001, REQ-002.

### AC-02 — Membership A revogado, sem logout Clerk

**Dado** um attendant com memberships ativos em A e B, abas e WebSockets de ambas as clínicas abertos; **quando** o owner de A remove seu membership em A; **então** a alteração é auditada, o backend nega novos pedidos a A, a conexão A deixa de receber dados e é encerrada/invalida-se, e a aba A informa acesso revogado. A sessão Clerk e a aba/conexão B mantêm-se válidas. Reabrir A ou retomar WebSocket após hibernação não concede acesso. **Requisito:** REQ-003; **DEC-026**. **Pendente:** comprovar mecanismo de propagação sem vazamento no intervalo da revogação.

### AC-03 — Perfis e superfícies separadas

**Dado** que somente atendente e responsável entram na Clinic App por membership e role; **quando** um profissional sem login ou um superadmin sem membership nem sessão de suporte válida tenta acessar dados clínicos, **então** o acesso é negado. O profissional permanece um recurso da agenda; o superadmin usa a Platform Admin e só entra em contexto clínico via sessão própria de suporte limitada e auditada. **Requisitos:** REQ-002, REQ-004, REQ-006, REQ-007.

## Mensagens e atendimento

### AC-04 — Primeiro contato recebido

**Dado** um número oficial ligado à clínica A; **quando** um novo contato envia mensagem; **então** uma conversa e uma oportunidade de A são criadas, a mensagem aparece na caixa de entrada e apenas sessões autorizadas de A recebem a atualização. **Requisitos:** REQ-010, REQ-011, REQ-040, REQ-050.

### AC-05 — Webhook repetido ou inválido

**Dado** um evento de mensagem já processado; **quando** a mesma entrega chega novamente; **então** há uma única mensagem lógica. **Quando** a origem é inválida ou o número não está associado a uma clínica, nenhuma mensagem é criada em A ou B. **Requisitos:** REQ-011, REQ-050.

### AC-06 — IA revisada por pessoa

**Dado** uma conversa de A e um atendente autorizado; **quando** a IA retorna uma sugestão; **então** ela é identificada como sugestão e pode ser editada ou ignorada. Sem ação humana de envio, o contato não recebe mensagem. **Quando** a IA falha, o atendente ainda pode responder manualmente. **Requisitos:** REQ-022, REQ-072.

### AC-07 — Envio com resultado desconhecido

**Dado** uma resposta que foi submetida à integração; **quando** o provedor não confirma o resultado; **então** a conversa mostra estado indeterminado, não mostra sucesso falso e não inicia repetição automática até reconciliação. **Requisitos:** REQ-012, REQ-013.

## Pipeline e agenda

### AC-08 — Atendimento e pipeline em duas sessões

**Dado** dois membros autorizados da clínica A com o painel aberto; **quando** um assume a conversa e muda a etapa da oportunidade; **então** a outra sessão mostra responsável e etapa atualizados sem recarregar a página. Uma sessão da clínica B não recebe o evento. **Requisitos:** REQ-020, REQ-023, REQ-040.

### AC-09 — Conflito de profissional ou sala/equipamento

**Dado** um horário confirmado que ocupa profissional P e sala S na clínica A; **quando** outra pessoa tenta confirmar compromisso sobreposto que exige P ou S; **então** a segunda confirmação é recusada com conflito e não cria reserva duplicada. Se profissional e sala/equipamento exigidos forem distintos e estiverem disponíveis, a regra não bloqueia apenas por coincidência de horário. **Requisitos:** REQ-030, REQ-031. **Pendente:** durações e buffers da clínica piloto.

### AC-10 — Cancelamento e reagendamento

**Dado** um compromisso confirmado; **quando** a equipe o cancela, **então** ele deixa de ocupar recursos e mantém histórico. **Quando** tenta reagendar para horário conflituoso, o compromisso válido anterior não desaparece. A falha de mensagem ao contato aparece separada do estado da agenda. **Requisitos:** REQ-032, REQ-033.

## Tempo real e recuperação

### AC-11 — Reconexão após evento perdido

**Dado** duas sessões de A, sendo uma desconectada; **quando** uma mensagem ou agendamento muda e a sessão desconectada volta; **então** ela busca o estado canônico, mostra a mudança e não duplica itens caso o evento também chegue pelo WebSocket. **Requisitos:** REQ-040, REQ-041, REQ-042.

### AC-12 — Hibernação sem perda de acesso ou isolamento

**Dado** sessões WebSocket de A e B; **quando** o Durable Object de A hiberna e retoma ao receber evento; **então** as sessões de A continuam ou reconectam de forma controlada, reconstroem o estado necessário e não recebem dados de B. **Requisitos:** REQ-001, REQ-040, REQ-041.

### AC-13 — Histórico e agenda coerentes

**Dado** uma conversa com mensagens, mudança de responsável e compromisso confirmado; **quando** atendente ou responsável autorizado abre histórico e agenda; **então** vê a ordem e os estados persistidos, o vínculo entre conversa e compromisso e apenas dados da própria clínica. **Requisitos:** REQ-021, REQ-034.

## Ativação e operação (dependem de decisões abertas)

### AC-14 — Clínica pronta para atender

**Dado** o fluxo de ativação aprovado; **quando** uma clínica é criada com responsável, serviços, profissionais, salas/equipamentos e número oficial associado; **então** somente seus membros autorizados entram no tenant, os horários usam a configuração da clínica e o número não roteia mensagens para outro tenant. Sem configuração obrigatória, o sistema não apresenta a clínica como pronta para agendar. **Requisitos:** REQ-004, REQ-051, REQ-052. **Pendente:** definir operação assistida ou autosserviço e responsabilidade pela conta WhatsApp.

### AC-15 — Falha operacional localizável

**Dado** uma falha simulada em webhook, fila, envio ou sincronização; **quando** a equipe técnica a investiga; **então** identifica tenant, tipo de evento, etapa e resultado sem encontrar token ou conteúdo pessoal desnecessário nos logs. Se a falha exigir ação da clínica, o painel mostra um estado compreensível. **Requisitos:** REQ-013, REQ-070. **Pendente:** retenção e acesso aos registros técnicos.

### AC-16 — Conversas visíveis e ações dos dois perfis

**Dado** uma conversa da clínica A atribuída a outra pessoa da equipe; **quando** um atendente ou o responsável de A abre a caixa de entrada; **então** ambos conseguem ver essa conversa, responder, mover a oportunidade e operar o agendamento conforme o fluxo. **Quando** tentam acessar conversa da clínica B, o acesso é negado. **Requisitos:** REQ-001, REQ-002, REQ-020, REQ-023, REQ-031.

### AC-17 — Usuário com memberships em duas clínicas

**Dado** um usuário Clerk com role de responsável em A e de atendente em B; **quando** trabalha em abas separadas; **então** cada requisição e WebSocket usa tenant e role próprios. Revogar A nega apenas A, sem alterar o acesso legítimo em B. **Requisitos:** REQ-001/003/005.

### AC-18 — Só superadmin booleano administra tenants

**Dado** um usuário com `privateMetadata.superadmin === true` no Clerk; **quando** cria/edita/suspende um tenant; **então** a API valida a flag atual no backend e audita a operação. Usuário sem flag ou com string `"true"` recebe 403; falha de validação não permite ação. Exclusão começa como `pending_deletion`. **Requisitos:** REQ-006.

### AC-19 — Sessão interna de suporte e impersonação

**Dado** superadmin, clínica A e subject com membership em A; **quando** solicita suporte com motivo e owner ativo de A aprova expressamente aquele pedido; **então** o Tredane ativa a sua própria sessão temporária e a Clinic App mostra banner, role efetiva do subject e as restrições adicionais. Clerk continua a autenticar o actor. Auditoria guarda as duas identidades. **Requisitos:** REQ-007.

### AC-20 — Negação de escalada e revogação no suporte

**Dado** uma sessão de suporte em A; **quando** se altera ID do tenant/subject, tenta operação proibida, expira a sessão, retira membership do subject ou a flag do actor; **então** nenhuma operação ilegal é executada nem entregue por WebSocket. A sessão pode ser encerrada manualmente. **Requisitos:** REQ-003/007/040.

### AC-21 — Owner gere apenas attendants do próprio tenant

**Dado** superadmin cria tenant A e atribui owner; **quando** o owner convida e remove attendant de A, **então** os eventos são auditados, o acesso ao tenant A é criado/revogado após aceitação e memberships do usuário em B não se alteram. Tentar convidar para B sem ser owner, promover/criar outro owner ou executar ação como attendant sem permissão retorna negação sem efeitos. Somente superadmin gere owners. **Requisitos:** REQ-001/002/003/004/005. **Pendente:** mecanismo de convites e invalidação de WebSockets.

### AC-22 — Convite por e-mail com aceite verificável

**Dado** owner da clínica A convidando `attendant@example.test`; **quando** o destinatário segue um link único válido e entra/cria conta Clerk com e-mail verificado correspondente; **então** o convite é consumido uma vez, e apenas um membership attendant em A é criado no D1. Uma identidade também membro de B preserva B. E-mail diferente, convite revogado/expirado/usado, alteração de tenant ou escalada da role são negados. **Requisitos:** REQ-004/005/008. **Validade confirmada:** convite com menos de 168 horas pode ser aceite se válido; em `expires_at` ou depois é recusado. **Reenvio confirmado:** novo convite gera token e prazo de 7 dias; token anterior é invalidado na mesma operação transacional e não pode ser aceite, mesmo antes de expirar. Testar dois reenvios concorrentes e aceite simultâneo. **Limites confirmados (DEC-024):** reenvio dentro de 10 minutos do anterior ou sexto reenvio numa janela móvel de 24 horas é rejeitado sem invalidar o convite ativo. Testar limites temporais, normalização de e-mail e requisições simultâneas. **Pendente:** cancelamento manual e controles antiabuso adicionais.

### AC-23 — Cancelamento de convite pendente por outro owner

**Dado** owners O1 e O2 no tenant A e convite pendente emitido por O1; **quando** O2 cancela, **então** o Worker valida que O2 é owner ativo de A, altera pending→cancelled atomicamente no D1, invalida imediatamente o link e regista a identidade de O2. Nenhum membership existente muda. Uma tentativa de aceite posterior falha. Attendant ou owner apenas de B não podem cancelar, e convite aceite não é cancelável para remover membership. Aceite e cancelamento simultâneos produzem um único resultado válido. **Requisitos:** REQ-004/008.

### AC-24 — Revogação afeta suporte mas não outros tenants

**Dado** superadmin em sessão de suporte própria atuando no contexto do subject com membership em A, e o mesmo subject membro de B; **quando** o membership do subject em A é revogado; **então** novas chamadas e eventos de suporte em A são negados e a sessão de suporte em A perde autorização. O subject mantém acesso legítimo a B pela sessão Clerk e membership B. Uma mensagem de A que ficou em trânsito antes da confirmação da revogação não é tratada como operação posterior; novos dados de A não podem ser entregues após confirmação. **Requisitos:** REQ-003/005/007/040; **DEC-026**.

### AC-25 — Acesso multi-tenant sem MFA no MVP

**Dado** usuário owner em A e attendant em B com sessão Clerk válida, mas sem MFA; **quando** acessa A e B, **então** a API aplica as roles D1 correspondentes sem exigir MFA, sem transferir permissões entre tenants. A remoção de membership continua a cortar acesso em A. **Requisitos:** REQ-001/002/005, DEC-028.

### AC-26 — Platform Admin e suporte sem MFA, com autorização rigorosa

**Dado** usuário Clerk autenticado com `privateMetadata.superadmin === true` verificado no backend; **quando** administra tenants ou inicia sessão de suporte própria do Tredane, **então** o backend não exige MFA, mas exige os controles existentes: flag atual, sessão válida, motivo, TTL, auditoria dupla, autorização por subject/tenant, limitações de operações, handoff seguro e proteção CSRF. Sem flag ou sessão correta, bloquear. **Requisitos:** REQ-006/007; DEC-028.

### AC-27 — Cada sessão de suporte exige aprovação de owner

**Dado** pedido de suporte do superadmin para tenant A com actor, subject, motivo e escopo; **enquanto** estiver pendente, rejeitado, expirado ou revogado, **então** não há credencial de suporte nem acesso clínico HTTP/WebSocket. Owner ativo de A precisa aprovar explicitamente para ativar aquela sessão específica, com auditoria. Owner só de B, attendant ou superadmin apenas por privilégio global não aprova A. Troca de subject/tenant/escopo após decisão e reutilização da aprovação são negadas. **Requisito:** REQ-007; **DEC-029/030**. Canal aprovado (painel + e-mail, decisão apenas no painel); pedido expira após 24 horas (DEC-031).

### AC-28 — Pedido em tempo real e aviso por e-mail, aprovação só no painel

**Dado** pedido de suporte pendente em A; **quando** criado, **então** owners ativos de A veem o pedido no painel em tempo real e recebem e-mail com link para abrir a solicitação dentro do Tredane. **Quando** um owner A autentica-se no Clerk e aprova/rejeita no painel, **então** backend valida membership vigente e grava a primeira decisão válida atomicamente, auditando aprovador e atualizando outros owners. Owner exclusivo de B não vê/aprova pedido de A; clicar no e-mail sem login nunca concede acesso nem aprova; falha de entrega do e-mail não desbloqueia suporte. **Requisitos:** REQ-007/060; DEC-030. Prazo do pedido definido em 24 horas (DEC-031); TTL da sessão aprovada por decidir.

### AC-29 — Prazo de 24 horas para aprovação de suporte

**Dado** pedido `pending` criado em t0; **quando** owner válido decide antes de t0+24h, **então** o backend pode persistir aprovação atomically, vinculada a apenas uma sessão. **Em t0+24h e depois**, negar aprovação e ativação sem criar handoff, cookie ou WebSocket; pedido é expirado mesmo que o job de limpeza não execute. O link de e-mail atrasado abre solicitação expirada e um novo pedido é necessário. A sessão aprovada dentro do prazo terá TTL separado. Testar corrida de owners, hora do servidor e limite temporal. **DEC-031; REQ-007/060.**

### AC-30 — Suporte termina após 30 minutos ou encerramento antecipado

**Dado** pedido válido aprovado e sessão ativada em `t0`; **antes de t0 + 30 minutos** a sessão permite somente ações autorizadas. **No instante t0 + 30 minutos e depois**, o backend não permite novos dados, operações, eventos WebSocket ou reutilização de cookie/handoff mesmo após hibernação ou refresh; o painel informa a expiração. O superadmin pode terminar antes, auditando e cortando o acesso. A sessão Clerk continua válida fora do contexto de suporte. Testar corrida com fan-out e ausência de job de limpeza. **REQ-007/061, DEC-032.**

### AC-31 — Continuação exige nova aprovação do owner

**Dado** sessão já encerrada ou expirada, **quando** o superadmin tenta estender seu prazo, usar antigo handoff/cookie ou reaproveitar aprovação, **então** nenhum acesso é permitido. **Quando** faz nova solicitação e um owner ativo da mesma clínica a aprova expressamente no Tredane, **então** pode nascer outra sessão independente de 30 minutos com ID, credenciais e auditoria próprios. O novo pedido pendente tem prazo de 24 horas. Requisitos REQ-007/061/062, DEC-033.

### AC-32 — Revogação por outro owner da mesma clínica

**Dado** owners O1 e O2 de A e sessão de suporte ativa aprovada por O1; **quando** O2 escolhe Encerrar suporte, **então** o Worker confirma membership owner atual de O2 em A, marca sessão como encerrada/revogada atomicamente no D1, audita O2 e bloqueia imediatamente chamadas HTTP, cookie/handoff e novas entregas WebSocket daquele suporte. O superadmin actor pode igualmente encerrar sua própria sessão. **Quando** owner só de B, attendant de A ou superadmin não actor tenta encerrar, **então** recebe negação sem efeito. Subject mantém membership e actor mantém login Clerk. Testar DO hibernado, falha da sinalização, corrida com fan-out e pedidos repetidos. **REQ-007/061/063, DEC-034.**

### AC-33 — Owners recebem aviso de início; encerramento só no painel

**Dado** pedido aprovado para tenant A; **quando** uma sessão de suporte passa efetivamente a `active`, **então** owners vigentes de A veem o início no painel em tempo real e recebem **um e-mail de início por destinatário/sessão**, sem dados clínicos ou credenciais. Owners de B não recebem informação de A. **Quando** a sessão expira após 30 minutos, o superadmin termina ou um owner de A revoga, **então** painel e auditoria registam o término e **nenhum e-mail de encerramento é enviado**. E-mail atrasado/falhado/duplicado não altera estado, acesso nem prazo; aba offline reconcilia dados do D1 ao abrir. Abrir link do e-mail sem autorização owner não expõe sessão. **Requisitos:** REQ-007/063/064, DEC-035.

### AC-34 — Suporte ativo visível para todos os owners e subject

**Dado** tenant A com owners O1/O2, subject S e attendant T, e uma sessão de suporte aprovada que passa a `active`; **então** O1/O2 veem o estado completo no painel e S, autenticado na sua própria Clinic App, vê um **aviso específico de suporte no contexto da sua conta**, sem que o superadmin obtenha sessão Clerk de S. **T não vê** o aviso relativo a S. Se o mesmo Clerk user pertence a B, o aviso de A não aparece em B. Quando a sessão termina por expiração/encerramento, o aviso ativo de S é removido/atualizado inclusive após WebSocket desconectado/hibernado. O subject não ganha poderes de aprovação ou revogação (DEC-034), e não recebe novo e-mail de início apenas por ser subject (DEC-035). **Requisitos:** REQ-007/064/065; DEC-036.

### AC-35 — Subject solicita encerramento e owner decide

**Dado** suporte ativo na clínica A representando S, com owners O1/O2 e attendant T; **quando** S usa **Solicitar encerramento** na sua Clinic App, **então** apenas uma solicitação pendente por sessão/subject é criada de forma idempotente e auditada, visível a O1/O2 em tempo real; T não pode gerar nem ver pedido de S, e owner exclusivo de B não o recebe. **Enquanto** owners não decidem, a sessão de suporte mantém o TTL original e autorizações vigentes, até 30 minutos no máximo. **Quando** owner de A escolhe Encerrar, aplica-se revogação imediata DEC-034; quando escolhe Manter, a decisão é registrada e S recebe estado atualizado. Cliques após expiração/revogação e IDs alterados são negados. Sem e-mail adicional nem permissão de revogar diretamente para S. **Requisitos:** REQ-063/065/066, DEC-037.

### AC-36 — Cancelamento exige motivo

**Dado** um compromisso confirmado; **quando** alguém tenta cancelar ou reagendar sem escolher motivo; **então** a ação é recusada e o compromisso continua confirmado. Com motivo, cancela a qualquer momento, sem prazo mínimo. **Requisito:** REQ-032.

### AC-37 — Contexto mínimo da IA

**Dado** duas clínicas com conversas fictícias; **quando** a IA é chamada numa conversa de A; **então** a solicitação ao AI Gateway contém apenas mensagens recentes dessa conversa, primeiro nome, catálogo de A e etapa, sem telefone, anexos ou dados de B. **Requisito:** REQ-072.

### AC-38 — Cadastro de recursos da agenda

**Dado** o responsável da clínica A; **quando** cadastra uma profissional, uma sala com a categoria exigida por um serviço e o expediente de ambas; **então** a agenda passa a oferecer horários desse serviço com os dois recursos livres. **Quando** desativa a única sala dessa categoria, o serviço deixa de oferecer novos horários e os compromissos futuros permanecem marcados. Um atendente não consegue cadastrar, editar ou desativar recursos. **Requisitos:** REQ-002, REQ-030, REQ-052.

### AC-39 — Conexão do WhatsApp interrompida

**Dado** uma clínica A com WhatsApp conectado; **quando** a Meta deixa de aceitar o acesso; **então** o painel de A mostra o aviso de conexão interrompida a todos os membros, as respostas enviadas no período aparecem como “Não enviada”, o histórico é preservado e só o responsável vê o botão de reconectar. Ao reconectar, nada é reenviado automaticamente e a clínica B não é afetada. **Requisitos:** REQ-012, REQ-013, REQ-051.

### AC-40 — Troca de número

**Dado** o responsável de A com o número X conectado; **quando** troca para o número Y; **então** conversas, contatos e agenda de A permanecem, mensagens passam a ser recebidas e enviadas por Y e X deixa de rotear para A. Tentar usar um número já associado à clínica B é recusado, sem alterar A nem B. **Requisitos:** REQ-050, REQ-051.

## Condições para usar estes cenários como aprovação

- Revisar com o responsável pelo produto e uma clínica piloto os casos marcados como pendentes.
- Fixar as permissões de atendente e responsável, a duração e os recursos de cada serviço, a política de cancelamento e o fluxo de WhatsApp real.
- Converter cada cenário em teste executável quando o módulo correspondente existir, preservando seus IDs e anotando qualquer mudança de comportamento aprovada.


## Aplicação da topologia DEC-038 aos cenários

Executar AC-01 (isolamento), AC-09/10 (agenda) e AC-11/12 (reconexão/hibernação) com DOs e bancos SQLite distintos por clínica, mantendo memberships e suporte no D1 central. As garantias existentes não mudam. Acrescentar ensaios de migração por instância, restauração sem efeitos duplicados/permissões ressuscitadas e revogação D1/DO durante corrida/hibernação, conforme [ADR-0012](../adr/0012-clinic-durable-object-sqlite.md). Cenários documentados não equivalem a testes executados.
