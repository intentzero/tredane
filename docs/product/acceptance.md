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

**Dado** uma conversa de A e um atendente autorizado; **quando** a IA retorna uma sugestão; **então** ela é identificada como sugestão e pode ser editada ou ignorada. Sem ação humana de envio, o contato não recebe mensagem. **Quando** a IA falha, o atendente ainda pode responder manualmente. **Requisitos:** REQ-022, REQ-060.

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

**Dado** pedido de suporte do superadmin para tenant A com actor, subject, motivo e escopo; **enquanto** estiver pendente, rejeitado, expirado ou revogado, **então** não há credencial de suporte nem acesso clínico HTTP/WebSocket. Owner ativo de A precisa aprovar explicitamente para ativar aquela sessão específica, com auditoria. Owner só de B, attendant ou superadmin apenas por privilégio global não aprova A. Troca de subject/tenant/escopo após decisão e reutilização da aprovação são negadas. **Requisito:** REQ-007; **DEC-029/030**. Canal aprovado (painel + e-mail, decisão apenas no painel); prazo pendente.

### AC-28 — Pedido em tempo real e aviso por e-mail, aprovação só no painel

**Dado** pedido de suporte pendente em A; **quando** criado, **então** owners ativos de A veem o pedido no painel em tempo real e recebem e-mail com link para abrir a solicitação dentro do Tredane. **Quando** um owner A autentica-se no Clerk e aprova/rejeita no painel, **então** backend valida membership vigente e grava a primeira decisão válida atomicamente, auditando aprovador e atualizando outros owners. Owner exclusivo de B não vê/aprova pedido de A; clicar no e-mail sem login nunca concede acesso nem aprova; falha de entrega do e-mail não desbloqueia suporte. **Requisitos:** REQ-007/060; DEC-030. Prazo do pedido por decidir.

## Condições para usar estes cenários como aprovação

- Revisar com o responsável pelo produto e uma clínica piloto os casos marcados como pendentes.
- Fixar as permissões de atendente e responsável, a duração e os recursos de cada serviço, a política de cancelamento e o fluxo de WhatsApp real.
- Converter cada cenário em teste executável quando o módulo correspondente existir, preservando seus IDs e anotando qualquer mudança de comportamento aprovada.
