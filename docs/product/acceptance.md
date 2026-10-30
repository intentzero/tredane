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

### AC-09 — Conflito de sala, profissional ou equipamento

**Revisto em 30/10/2026 (DEC-082).** A marcação nova cai numa sala livre da lista do serviço, com uma profissional que faz o serviço e está livre. Se várias salas estão livres, entra a primeira por ordem de nome. A sala da profissional deixa de escolher.

**Dado** «Depilação» nas salas «Sala depilação» e «Espaço Bronzeamento», feitas pela Gi e pela Ana; **quando** a equipa confirma às 10:00 com a Gi e as duas salas livres; **então** a marcação fica com a Gi na primeira sala por ordem de nome. Com a Sala depilação ocupada e o Espaço Bronzeamento livre, a Gi fica no Espaço Bronzeamento. A marcação só é recusada se nenhuma sala da lista tiver vaga, a profissional já estiver ocupada nesse bloco (mesmo noutra sala), o modo «Cada profissional com a sua cliente» já tiver essa profissional com outra cliente, o modo grupo a puser noutra sala, ou o sexo do bloco não coincidir sem «Permitir os dois». Dois serviços da mesma pessoa no mesmo bloco contam como uma pessoa. Equipamento continua uma vaga. **Requisitos:** REQ-030, REQ-031, REQ-096, DEC-075, DEC-082. **Pendente:** durações e buffers da clínica piloto.

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

**Dado** usuário owner em A e attendant em B com sessão Clerk válida, mas sem MFA; **quando** seleciona A e troca explicitamente para B no painel, **então** o seletor mostra apenas clínicas associadas, a interface deixa de exibir dados de A, revalida a role attendant em B e não reutiliza cache ou WebSocket de A. A API não exige MFA nem transfere permissões entre tenants. Remover o membership em A corta apenas A e preserva B. **Requisitos:** REQ-001/002/005, DEC-017/028.

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

### AC-41 — Preço só do cadastro

**Dado** o serviço “Limpeza de pele” com preço cadastrado e “Harmonização” sem preço; **quando** a atendente pede sugestão para “Quanto custa a limpeza?” e depois para “Quanto custa a harmonização?”; **então** a primeira sugestão traz exatamente o preço cadastrado e a segunda não contém nenhum valor, propõe confirmar com a equipe e mostra “Serviço sem preço cadastrado”. **Requisito:** REQ-073.

### AC-42 — Mensagem ofensiva

**Dado** uma conversa fictícia cuja última mensagem é ofensiva; **quando** a atendente pede sugestão; **então** o bloco mostra o aviso de mensagem ofensiva, a sugestão é cordial, não repete o insulto e nada é enviado sem a atendente tocar em **Enviar**. **Requisito:** REQ-074.

### AC-43 — Explicação e assunto clínico

**Dado** “Limpeza de pele” com explicação cadastrada e “Peeling” sem explicação; **quando** a cliente pergunta como é cada um e se pode fazer grávida; **então** a sugestão sobre a limpeza usa só o texto cadastrado e mostra a fonte, a sobre o peeling não descreve o procedimento, e a pergunta sobre gravidez recebe o aviso de assunto clínico sem resposta de mérito. **Requisito:** REQ-075.
### AC-44 — Sinal no cadastro do serviço

**Dado** a responsável editando “Limpeza de pele” com preço cadastrado; **quando** liga “Exige sinal” com 30%; **então** o resumo mostra o valor calculado e salva; com “Peeling” sem preço, a opção percentual fica indisponível e só valor fixo é aceito; uma atendente não vê a opção. **Requisito:** REQ-076.

### AC-45 — Sem conta de recebimento

**Dado** uma clínica sem conta conectada e um serviço que exige sinal; **quando** a atendente tenta agendar; **então** o envio de cobrança fica indisponível com o aviso de conta não conectada e nenhuma cobrança é criada. **Requisito:** REQ-077.

### AC-46 — Cobrança enviada não reserva horário

**Dado** quinta 14:00 livre e serviço com sinal; **quando** a atendente envia o sinal para a cliente A; **então** a conversa mostra a mensagem com valor, prazo e política e o estado Aguardando sinal, e o mesmo horário continua disponível para outra pessoa. **Requisito:** REQ-078.

### AC-47 — Pagamento processado uma vez

**Dado** uma cobrança Aguardando sinal da clínica A; **quando** o provedor envia o aviso de pago duas vezes e um aviso com assinatura inválida; **então** a cobrança fica Paga uma única vez, o aviso inválido é recusado e registrado, e um aviso com identificador da clínica B não altera nada em A. **Requisito:** REQ-079.

### AC-48 — Pago sem horário

**Dado** uma cobrança paga cujo horário foi confirmado para outra pessoa antes do pagamento; **quando** o aviso chega; **então** a equipe de A vê o alerta Pago sem horário com Escolher outro horário e Devolver sinal, e nenhum compromisso duplicado é criado. **Requisito:** REQ-080.

### AC-49 — Expiração

**Dado** uma cobrança não paga; **quando** o prazo vence; **então** ela passa a Expirada, deixa de aceitar pagamento e um aviso de pago posterior é tratado como Pago sem horário. **Requisito:** REQ-081. Com a configuração padrão, o prazo é de 2 horas; a responsável altera o prazo e o novo valor vale só para novas cobranças.

### AC-50 — Cancelamento com sinal pago

**Dado** um compromisso confirmado com sinal pago; **quando** a atendente cancela; **então** o motivo é obrigatório, a política da clínica aparece, a escolha Devolver gera Estorno solicitado e a escolha Reter fica registrada com quem decidiu. **Requisito:** REQ-082.

### AC-51 — Confirmar sem sinal

**Dado** um serviço que exige sinal e a atendente na tela Agendar; **quando** escolhe **Confirmar sem sinal**; **então** o motivo é obrigatório, o compromisso é confirmado sem cobrança e o histórico registra quem confirmou e o motivo. **Requisito:** REQ-078.

### AC-52 — Exclusão de contacto e expurgo de clínica

**Dado** um contacto com mensagens, anexos e compromisso na clínica A; **quando** a responsável exclui o contacto; **então** mensagens e anexos deixam de existir em busca/API/R2, o compromisso permanece com rótulo anónimo (sem dados pessoais), a auditoria não contém o conteúdo apagado, e um replay de webhook com o mesmo `wa_id` não recria o contacto. Clínica B permanece intacta. **Dado** a clínica A em `pending_deletion`; **quando** o processo durável de expurgo corre até ao deadline de 30 dias; **então** SQLite do DO, prefixo R2 e assinaturas push de A são limpos, o tenant fica `purged`, e jobs/webhooks atrasados não reintroduzem dados. **Requisito:** REQ-071; implementação [f6-retention-purge.md](../implementation/f6-retention-purge.md). **Em aberto:** revisão jurídica antes de dados reais (VAL-09).

### AC-53 — Observabilidade, staging e recuperação do piloto

**Dado** falha injectada (DLQ, outbox, status incerto, Meta/Pix/IA, revogação ou expurgo); **quando** a equipa técnica investiga pelos logs estruturados; **então** localiza `tenantId`, `correlationId`, tipo de evento, etapa e resultado **sem** token nem conteúdo pessoal. **Dado** ensaio de recuperação na clínica A; **quando** corre o harness de recovery; **então** a clínica B não muda, membership/suporte expirado não revive, e o relatório marca PITR/reconciliação live como Em aberto até staging real. **Dado** deploy para staging/prod; **quando** ainda há D1 placeholder; **então** `check:env` recusa o deploy. **Requisitos:** REQ-013, REQ-070; DEC-038; implementação [f6-ops.md](../implementation/f6-ops.md). **Em aberto:** budgets medidos em conta live; retenção/ACL de logs; destino de alerta externo.

### AC-54 — Validação E2E sintética e go/no-go do piloto (#45)

**Dado** duas clínicas sintéticas A e B, duas sessões autorizadas de A, e o harness MVP-31; **quando** se executa a matriz requisito/critério→issue→teste→evidência ([evidence-matrix.md](evidence-matrix.md)); **então** cada AC aplicável tem teste, evidência documental ou gate humano explícito (Confirmado / Proposto / Em aberto / Fora do MVP), cobrindo WhatsApp→atendimento→Acompanhamento→agenda com e sem sinal, IA assistiva, suporte (já coberto em AC-19–35), exclusão e falhas (concorrência, pagamento tardio/duplicado, estorno falhado, envio incerto, reconexão/hibernação). **Dado** checklist go/no-go; **então** o veredicto permanece **NO-GO** até autorização explícita de produto e gates em [pilot-gates.md](pilot-gates.md) — **sem** reivindicar piloto activado. **Requisitos:** aceite do épico #14; implementação [f6-e2e-validation.md](../implementation/f6-e2e-validation.md). **Em aberto:** aparelhos reais 360 px+ (UX-08 / Q-UX-01); Clerk/Meta/LGPD/catálogo/jurídico.

### AC-55 — Proposta de agendamento por botão (Decidido, DEC-061)

**Dado** a capacidade de proposta ligada numa clínica sintética (pausa da owner desligada) e uma cliente fictícia que pede «limpeza de pele amanhã às 15h»; **quando** o backend prepara a proposta; **então** a mensagem enviada tem texto fixo, id e versão, os detalhes de REQ-083 e os botões **Confirmar** / **Alterar detalhes**; nenhum compromisso existe ainda. **Dado** mudança de serviço ou horário; **então** nasce nova versão e o clique na anterior não marca. **Dado** 30 min sem clique; **então** a proposta expira. **Requisitos:** REQ-083; JRN-17.

### AC-56 — Marcação só pelo clique (Decidido, DEC-061)

**Dado** proposta válida; **quando** a cliente responde «sim» ou 👍 em texto; **então** nada é marcado. **Quando** toca em **Confirmar**; **então** um único compromisso é criado com actor `system:ai-autobook`, auditoria `appointment.ai_booked` (proposta, versão, evento) e «Marcado pela IA»; clique repetido, de outro contato/conversa/tenant ou após expiração não cria compromisso. Horário ocupado → «Horário já não está livre…». Serviço com sinal → fluxo Pix, sem reserva antes do pagamento. **Alterar detalhes** → atendente, alerta após 5 min sem resposta. Com a pausa da owner ligada, nenhum envio novo nem marcação. **Requisitos:** REQ-084; JRN-17. **Limites de abuso (S7): Confirmado (Paulo, 29/10/2026)** — [abuse-limits.md](../security/abuse-limits.md); UI owner; enable por clínica (default off).

### AC-57 — Catálogo de zonas (Confirmado, DEC-078)

**Dado** o serviço fictício «Depilação» com 60 min e R$ 120,00 e catálogo de zonas vazio; **quando** a responsável grava a primeira zona «Axila» sem duração nem preço; **então** a zona fica com 60 min e R$ 120,00. Preço explícito vazio fica sem preço. A atendente não grava. Clínica B não lê as zonas de A. Com zonas gravadas, marcação nova não usa a linha. Zona já usada numa visita não se apaga; editar a zona não muda a cópia do compromisso. **Requisitos:** REQ-085.

### AC-58 — Várias zonas num horário (Confirmado, DEC-078)

**Dado** «Axila» 15 min e «Meia perna» 30 min, intervalo do serviço 15 min; **quando** a equipe marca as duas às 10:00; **então** existe um compromisso das 10:00 às 10:45, ocupando até 11:00, com o rótulo «Depilação · Axila, Meia perna». Zona repetida, de outro serviço ou de outra clínica é recusada e nenhum compromisso nasce. Reagendar sem trocar zonas mantém o conjunto e o bloco. Serviço sem zonas marca os 60 min do cadastro. **Requisitos:** REQ-086.

### AC-59 — Preço e um sinal (Confirmado, DEC-078)

**Dado** as duas zonas com preço; **então** o preço da visita é a soma. **Dado** uma zona sem preço; **então** a visita não tem preço citável e o sinal em porcentagem não é enviado, com o motivo visível; o sinal fixo cobra o valor do serviço uma vez. A cobrança guarda a cópia das zonas. «Pago sem horário» oferece outro horário do mesmo conjunto e da mesma duração. **Requisitos:** REQ-087.

### AC-60 — IA e proposta (Confirmado, DEC-078)

**Dado** a cliente pergunta o preço de «Depilação» sem nomear zona; **então** a sugestão pede as zonas e não cita valor nem «a partir de». **Dado** ela nomeia «Axila» e «Meia perna»; **então** só a soma do backend pode ser citada. A proposta lista as zonas, o início e o fim do bloco e a soma ou a ausência de preço. Trocar o conjunto gera nova versão. Serviço sem zonas continua a citar o preço da linha. **Requisitos:** REQ-088.

### AC-69 — Combos de variantes (Confirmado, DEC-080)

**Dado** o combo «Buço + axila» a R$ 70,00 com as variantes a R$ 35,00 e R$ 50,00; **quando** a visita escolhe as duas; **então** o total é R$ 70,00, a duração é a soma mais o intervalo uma vez e a cópia guarda o combo (R$ 70,00; soma R$ 85,00). **Dado** a visita escolhe também «Meia perna» (R$ 90,00); **então** o total é R$ 160,00. **Dado** uma só das duas; **então** não há combo. **Dado** dois combos que cabem; **então** vale o de maior desconto, só um. **Dado** o preço de uma variante cai e o combo deixa de ser mais barato; **então** ele deixa de se aplicar e o painel avisa. **Dado** uma proposta aberta cujo total mudou por causa do combo; **então** o clique é negado como mudança material. **Dado** um combo com variante masculina e feminina, de outro serviço, com menos de 2 variantes, sem preço ou com nome repetido; **então** nada é gravado. **Dado** um combo que já entrou numa visita; **então** não se apaga, só se desativa. **Requisitos:** REQ-095.

### AC-70 — Salas do serviço (Confirmado, DEC-082)

**Dado** a responsável a criar o serviço fictício «Depilação» sem sala e sem «Sem espaço definido»; **quando** grava; **então** a gravação é recusada e o serviço não existe. **Dado** ela marca «Espaço Bronzeamento» e «Sala depilação»; **então** as duas ficam no serviço. **Dado** ela escolhe «Sem espaço definido»; **então** o serviço grava sem sala e as salas anteriores saem. Marcar de novo uma sala tira «Sem espaço definido». Sala inativa, equipamento, sala de outra clínica, «Qualquer sala livre» ou categoria é recusado e nada muda. A atendente não grava. Clínica B não lê as salas de A. Um compromisso já marcado não muda de sala. **Dado** «Depilação» com «Espaço Bronzeamento» e «Sala depilação», e a Gi a fazer o serviço; **quando** as duas salas estão livres às 10:00; **então** a marcação fica com a Gi na primeira sala por ordem de nome. Com uma delas ocupada, fica na outra. Trocar a sala dessa marcação para uma sala fora da lista é recusado. **Dado** «Depilação» já gravada em «Sem sala», «Massagem» em «Qualquer sala livre» com as salas ativas «Sala depilação» e «Espaço Bronzeamento», e «Laser» na categoria «Laser» cuja única sala ativa é «Sala laser»; **quando** a migração corre; **então** «Depilação» fica «Sem espaço definido» e continua a marcar sem sala, «Massagem» fica com as duas salas e «Laser» fica com «Sala laser». Uma sala criada depois não entra em «Massagem». Compromissos já marcados não mudam de sala. **Dado** uma categoria sem sala ativa; **então** a marcação nova espera a responsável escolher. **Dado** «Depilação» na Sala depilação e no Espaço Bronzeamento, com as duas salas desativadas; **então** a marcação nova não aparece, as duas salas continuam na lista, e um compromisso já marcado fica. Reativar a Sala depilação volta a oferecê-la. **Requisitos:** REQ-096.

### AC-61 — Migração do bloco Tempo em Tanto faz (Confirmado, DEC-077)

**Dado** serviços já gravados «Bronzeamento» e «Depilação»; **quando** a migração do bloco Tempo corre; **então** céu e temperatura ficam em Tanto faz, sem graus, o local de previsão fica vazio e `clinic_address` não é copiado. A grade desses serviços é a mesma de antes. O contato não ganha coluna e a audiência (DEC-075) permanece. **Requisitos:** REQ-090.

### AC-62 — Local da clínica (Confirmado, DEC-077)

**Dado** a responsável no hub; **quando** grava a cidade «Campinas»; **então** o local fica cidade e as coordenadas vazias. Trocar para coordenadas válidas apaga a cidade. Latitude 91 é recusada e o valor anterior fica. A atendente não grava. Com as sugestões de IA desligadas, o cartão continua editável. **Requisitos:** REQ-089.

### AC-63 — Bloco Tempo no serviço (Confirmado, DEC-077)

**Dado** «Depilação» criada sem o bloco; **então** céu e temperatura ficam em Tanto faz e a ficha diz «Sem restrição de tempo». **Dado** «Bronzeamento» com Sol e Acima de 24; **então** os dois ficam gravados e a ficha não mostra percentagem. Acima de sem grau, grau não inteiro, ou Acima e Abaixo juntos, são recusados. Voltar a temperatura a Tanto faz apaga o 24. A atendente não grava. O catálogo da IA não traz céu nem graus. **Requisitos:** REQ-090.

### AC-64 — Símbolos, hora e falha fechada do avaliador (Confirmado, DEC-077)

**Dado** uma previsão fictícia, sem rede; **quando** a função avalia o início do compromisso; **então** céu limpo sem chuva e 25 °C servem a Sol e a Acima de 24; 24 °C não serve a Acima de 24; encoberto e nevoeiro não servem a Sol; garoa e trovoada servem a Chuva e não servem a Sol; muito nublado sem chuva não serve a Sol. Tanto faz nos dois não chama o adaptador. Sem local, erro, símbolo desconhecido ou percentagem não mapeada: indisponível, e a saída não contém o corpo do provedor. **Requisitos:** REQ-091.

### AC-65 — Filtro automático, proposta e clique (Confirmado, DEC-077)

**Dado** «Bronzeamento» com Sol e Acima de 24 e local gravado; **quando** a previsão fictícia às 15h é céu limpo e 25 °C; **então** o caminho automático inclui 15h. Com 22 °C ou céu encoberto, 15h sai da lista automática e não nasce proposta. No clique, se a função já não servir ou não confirmar, não há compromisso nem cobrança, e a frase é a de tempo que não serve ou a de não deu para confirmar — sem percentagem e sem número de vagas. Horário ocupado continua com a frase de ocupação. «Depilação» em Tanto faz oferece horários mesmo sem local. «Bronzeamento» com Sol e sem local não oferece horário automático. **Requisitos:** REQ-092; JRN-17.

### AC-66 — Aviso na marcação manual (Confirmado, DEC-077)

**Dado** a mesma hora de bronzeamento com sol que não serve; **quando** a equipe confirma no Agendar; **então** o aviso «Sol fraco neste horário» está visível e o compromisso é criado. Sem previsão, o aviso é «Não deu para confirmar o tempo» e o compromisso também é criado. Céu e temperatura a falhar mostram as duas frases e um compromisso. O clique da proposta, no mesmo resultado da função, não cria compromisso. Um compromisso já confirmado permanece se a previsão dessa hora passar a não servir. **Requisitos:** REQ-092; JRN-03.

### AC-67 — Contexto da IA sem payload (Confirmado, DEC-077)

**Dado** o pedido ao modelo num teste; **então** as horas de bronzeamento são só as que serviram, sem JSON do provedor, sem percentagem e sem o bloco Tempo. Hora pedida que não serviu traz a frase fixa e não entra nas vagas. Rascunho com «40%» ou com hora filtrada não chega à atendente como sugestão utilizável. Depilação em Tanto faz não acrescenta frase de tempo. Texto livre não marca. **Requisitos:** REQ-093, REQ-072; JRN-02, JRN-17.

### AC-68 — Tipo obrigatório e géneros da visita (Confirmado, DEC-079)

**Dado** o serviço fictício «Depilação» com variantes e sem tipo; **quando** a responsável grava «Axila»; **então** a gravação é recusada e nenhuma variante fica. Com o singular «Zona» e sem plural, a gravação também é recusada. Com «Zona» e «Zonas», omitir o género é recusado. **Dado** «Axila» feminina e «Barba» masculina; **quando** a equipe marca as duas; **então** a visita é recusada e nenhum compromisso nasce. **Dado** «Axila» feminina e «Braços» ambos; **então** o compromisso nasce com as duas. Uma variante já gravada, migrada como ambos, continua a marcar. **Requisitos:** REQ-094.
