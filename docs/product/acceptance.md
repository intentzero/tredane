# Cenários de aceite do MVP

**Estado:** rascunho para validação de produto. Execute com dados fictícios e duas clínicas de teste independentes, A e B. Os cenários concretizam os [requisitos](requirements.md) e as [jornadas](journeys.md); não afirmam que o software já existe.

## Isolamento e acesso

### AC-01 — Acesso cruzado negado

**Dado** um atendente associado apenas à clínica A e uma conversa, arquivo e agendamento da clínica B; **quando** ele tenta abrir cada item pela interface ou por ID direto; **então** o sistema nega acesso sem retornar conteúdo, não altera dados de B e não publica evento para A ou B. **Requisitos:** REQ-001, REQ-002.

### AC-02 — Sessão revogada

**Dado** um atendente da clínica A com painel e WebSocket abertos; **quando** seu acesso é revogado; **então** novas requisições são negadas, a conexão antiga não recebe novos eventos da clínica e o painel informa a perda de acesso. **Requisito:** REQ-003. **Pendente:** mecanismo de invalidação e matriz final de quem pode revogar.

### AC-03 — Profissional e operador fora do painel

**Dado** o primeiro MVP com somente os perfis atendente e responsável no painel da clínica; **quando** um profissional ou um superadmin tenta abrir o painel ou os dados de uma clínica como se tivesse um desses papéis; **então** não recebe acesso implícito. O profissional pode constar como recurso da agenda sem login; o superadmin usa apenas o app de superadmin. **Requisitos:** REQ-002, REQ-004, REQ-080.

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

**Dado** o fluxo de ativação aprovado; **quando** uma clínica é criada com responsável, serviços, profissionais, salas/equipamentos e número oficial associado; **então** somente seus membros autorizados entram no tenant, os horários usam a configuração da clínica e o número não roteia mensagens para outro tenant. Sem configuração obrigatória, o sistema não apresenta a clínica como pronta para agendar. **Requisitos:** REQ-004, REQ-051, REQ-052, REQ-080. **Fluxo confirmado:** superadmin cria a clínica e convida o responsável; o responsável configura a agenda e conecta o número pelo Embedded Signup (DEC-009, DEC-012). **Pendente:** verificação do Tredane como Tech Provider.

### AC-15 — Falha operacional localizável

**Dado** uma falha simulada em webhook, fila, envio ou sincronização; **quando** a equipe técnica a investiga; **então** identifica tenant, tipo de evento, etapa e resultado sem encontrar token ou conteúdo pessoal desnecessário nos logs. Se a falha exigir ação da clínica, o painel mostra um estado compreensível. **Requisitos:** REQ-013, REQ-070. **Pendente:** retenção e acesso aos registros técnicos.

### AC-16 — Conversas visíveis e ações dos dois perfis

**Dado** uma conversa da clínica A atribuída a outra pessoa da equipe; **quando** um atendente ou o responsável de A abre a caixa de entrada; **então** ambos conseguem ver essa conversa, responder, mover a oportunidade e operar o agendamento conforme o fluxo. **Quando** tentam acessar conversa da clínica B, o acesso é negado. **Requisitos:** REQ-001, REQ-002, REQ-020, REQ-023, REQ-031.

### AC-17 — Troca de clínica

**Dado** uma conta associada às clínicas A e B, com o painel aberto em A; **quando** escolhe B no seletor; **então** os dados de A somem da tela, a conexão em tempo real passa a receber só eventos de B e uma requisição com ID de A é negada até nova seleção de A. **Quando** a associação a B é revogada, B some do seletor e a sessão em B perde acesso. **Requisitos:** REQ-005, REQ-003.

### AC-18 — Cancelamento exige motivo

**Dado** um compromisso confirmado; **quando** alguém tenta cancelar ou reagendar sem escolher motivo; **então** a ação é recusada e o compromisso continua confirmado. Com motivo, cancela a qualquer momento, sem prazo mínimo. **Requisito:** REQ-032.

### AC-19 — Contexto mínimo da IA

**Dado** duas clínicas com conversas fictícias; **quando** a IA é chamada numa conversa de A; **então** a solicitação ao AI Gateway contém apenas mensagens recentes dessa conversa, primeiro nome, catálogo de A e etapa, sem telefone, anexos ou dados de B. **Requisito:** REQ-060.

### AC-20 — Cadastro de recursos da agenda

**Dado** o responsável da clínica A; **quando** cadastra uma profissional, uma sala com a categoria exigida por um serviço e o expediente de ambas; **então** a agenda passa a oferecer horários desse serviço com os dois recursos livres. **Quando** desativa a única sala dessa categoria, o serviço deixa de oferecer novos horários e os compromissos futuros permanecem marcados. Um atendente não consegue cadastrar, editar ou desativar recursos. **Requisitos:** REQ-002, REQ-030, REQ-052.

## Condições para usar estes cenários como aprovação

- Revisar com o responsável pelo produto e uma clínica piloto os casos marcados como pendentes.
- Fixar as permissões de atendente e responsável, a duração e os recursos de cada serviço, a política de cancelamento e o fluxo de WhatsApp real.
- Converter cada cenário em teste executável quando o módulo correspondente existir, preservando seus IDs e anotando qualquer mudança de comportamento aprovada.
