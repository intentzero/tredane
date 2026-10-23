# Requisitos do MVP

**Estado:** catálogo proposto para revisão, derivado de [jornadas](journeys.md), [atores](actors-permissions.md) e [estados](states.md), com [cenários de aceite](acceptance.md). **Prioridade:** “MVP” indica candidato à primeira entrega, não aprovação definitiva. Os IDs são estáveis. Cada requisito deve ser demonstrado com duas clínicas de teste quando envolver dados ou eventos de tenant.

## Identidade e isolamento

### REQ-001 — Acesso por clínica

**Prioridade/estado:** MVP / Proposto. **Origem:** ACT-02, ACT-03; JRN-04, JRN-07. **Comportamento:** toda leitura, mutação e subscrição em tempo real usa uma associação vigente entre usuário e clínica. IDs recebidos do navegador não concedem acesso. **Aceite:** usuário da clínica A não consegue obter nem alterar conversa, contato, oportunidade, agendamento ou arquivo da clínica B por interface, URL, ID direto ou evento WebSocket. **Dados/eventos:** D1, R2, Durable Objects, Queues e Workflows preservam o contexto de tenant.

### REQ-002 — Permissão por papel e ação

**Prioridade/estado:** MVP / Confirmado (DEC-007, DEC-015, DEC-016). **Origem:** ACT-02, ACT-03; JRN-02, JRN-07. **Comportamento:** atendente e responsável podem ver todas as conversas da própria clínica, responder, atribuir, mover oportunidades e operar agendamentos; o responsável pode fazer tudo que o atendente faz e é o único que administra membros, serviços, profissionais, salas/equipamentos e disponibilidade. **Aceite:** ambos executam as ações de atendimento na própria clínica, mas são negados para outra clínica; um atendente que tenta convidar membro ou alterar serviço, recurso ou disponibilidade é negado e nada é alterado. **Dados/eventos:** a resposta não revela conteúdo de outro tenant nem publica evento de ação negada.

### REQ-003 — Revogação de acesso

**Prioridade/estado:** MVP / Proposto. **Origem:** ACT-02, ACT-03; JRN-07. **Comportamento:** remover um membro ou revogar sua sessão impede novas ações e o recebimento de eventos da clínica. **Aceite:** após a revogação, requisições e conexões antigas não entregam novos dados; a interface solicita nova autenticação ou informa perda de acesso. **Dados/eventos:** registrar autor, membro afetado e horário; definir mecanismo técnico de invalidação antes da implementação.

### REQ-004 — Ativação e associação de membros

**Prioridade/estado:** MVP / Proposto (fluxo definido por DEC-012 e DEC-007). **Origem:** ACT-03, ACT-05; JRN-08. **Comportamento:** o superadmin cria a clínica, provisiona seu D1 e convida o responsável; o responsável convida os atendentes. Uma clínica só recebe dados depois de ativa, com responsável associado. **Aceite:** nenhum usuário sem associação vigente entra no tenant; convite expirado ou revogado não cria associação; criar clínica com D1 que falhou ao provisionar não a deixa ativa. **Dados/eventos:** tenant e identidade no D1 central; superadmin não ganha associação à clínica.

### REQ-005 — Várias clínicas por conta

**Prioridade/estado:** MVP / Confirmado (DEC-007). **Origem:** ACT-02, ACT-03; JRN-07. **Comportamento:** uma conta com associação a mais de uma clínica escolhe a clínica ativa num seletor; com uma só, entra direto nela. **Aceite:** ao trocar de A para B, a interface descarta os dados de A, a conexão WebSocket de A é fechada e outra é aberta no Durable Object de B; nenhuma requisição posterior com a sessão abre o D1 de A sem nova seleção; associação revogada em B remove B do seletor. **Dados/eventos:** sessão guarda a clínica ativa no D1 central.

### REQ-006 — Login pelo Clerk

**Prioridade/estado:** MVP / Confirmado (DEC-007, alterado em 23/10/2026). **Origem:** ACT-02, ACT-03, ACT-05. **Comportamento:** a autenticação é feita pelo Clerk, com código enviado por e-mail como método inicial; o Worker valida o token em toda requisição e na abertura do WebSocket. **Aceite:** token inválido ou expirado não acessa nada; usuário autenticado sem associação vigente não entra em clínica alguma; revogar a associação no D1 central nega a próxima requisição e fecha o WebSocket mesmo com o token do Clerk ainda válido; a resposta de login não revela se um e-mail tem conta. **Dados/eventos:** o D1 central guarda apenas o ID do Clerk e dados de exibição; credenciais e códigos ficam no Clerk.

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

**Prioridade/estado:** MVP / Proposto. **Origem:** ACT-02, ACT-03; JRN-02. **Comportamento:** IA (Claude via AI Gateway, DEC-011) pode sugerir resposta e resumo; pessoa autorizada revisa e aciona o envio. **Aceite:** a sugestão é identificada, editável e nunca vira mensagem enviada sem ação humana; falha da IA não bloqueia resposta manual. **Dados/eventos:** origem da sugestão, modelo e decisão de envio; contexto conforme REQ-060.

### REQ-023 — Oportunidade no pipeline

**Prioridade/estado:** MVP / Proposto. **Origem:** ACT-02, ACT-03; JRN-03, JRN-04. **Comportamento:** uma oportunidade vinculada ao contato/conversa mostra etapa, responsável, última interação e próximo compromisso; mudanças têm histórico. **Aceite:** mover etapa atualiza painel de duas sessões da clínica; clínica diferente não vê a oportunidade. **Dados/eventos:** etapas iniciais propostas em `docs/MVP.md`; transições e regra de reabertura ainda precisam de validação.

## Agenda própria

### REQ-030 — Disponibilidade

**Prioridade/estado:** MVP / Confirmado quanto a recursos, duração e intervalo (DEC-008, DEC-014); expediente semanal, bloqueios pontuais, fuso por clínica e grade de 15 min confirmados (DEC-008). **Origem:** ACT-02, ACT-03; JRN-03. **Comportamento:** equipe consulta horários disponíveis conforme serviço (duração fixa + intervalo após o atendimento), expediente semanal, bloqueios pontuais, profissional e sala/equipamento exigidos, em horários de 15 em 15 min no fuso da clínica. **Aceite:** um intervalo ocupado ou bloqueado não aparece como disponível quando qualquer recurso necessário conflita; o intervalo após o atendimento mantém ocupados a sala/equipamento **e o profissional**; horários fora do expediente semanal ou dentro de um bloqueio não aparecem; “Horário proposto” no pipeline não remove horário da lista. **Dados/eventos:** serviço, recurso e disponibilidade sempre por tenant.

### REQ-031 — Confirmação sem conflito

**Prioridade/estado:** MVP / Proposto. **Origem:** ACT-02, ACT-03; JRN-03, JRN-05. **Comportamento:** confirmar horário cria agendamento ligado ao contato e à oportunidade somente se os recursos ainda estiverem livres. **Aceite:** duas tentativas simultâneas para o mesmo recurso e intervalo produzem no máximo uma confirmação; a outra recebe conflito compreensível. **Dados/eventos:** agendamento persistido antes do evento em tempo real.

### REQ-032 — Cancelamento e reagendamento

**Prioridade/estado:** MVP / Proposto. **Origem:** ACT-01, ACT-02, ACT-03; JRN-05. **Comportamento:** equipe registra cancelamento ou confirma novo horário a qualquer momento (sem prazo mínimo, DEC-008), escolhendo um motivo obrigatório de uma lista, preservando histórico e liberando ou ocupando recursos de modo coerente. **Aceite:** cancelar ou reagendar sem motivo é recusado; agenda, conversa e oportunidade mostram o mesmo estado; conflito no novo horário não apaga o compromisso anterior. **Dados/eventos:** motivo e autor registrados. **Proposto:** lista inicial de motivos — contato desistiu, contato remarcou, clínica cancelou, não compareceu, outro.

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

**Prioridade/estado:** MVP / Confirmado quanto ao fluxo (DEC-009). **Origem:** ACT-03, ACT-05; JRN-08. **Comportamento:** o responsável conecta a conta e o número da clínica pelo Embedded Signup da Meta, com o Tredane como Tech Provider; o superadmin acompanha o estado da ativação. **Aceite:** ao concluir, o `phone_number_id` fica associado a exatamente uma clínica no D1 central; tentar associá-lo a uma segunda clínica é recusado; cancelar o fluxo no meio não deixa canal ativo. **Dados/eventos:** token da integração guardado como segredo, nunca no repositório ou em logs. **Pendente:** verificação do Tredane como Tech Provider.

### REQ-052 — Configuração mínima da clínica

**Prioridade/estado:** MVP / Confirmado quanto ao papel (só o responsável, DEC-007); telas propostas. **Origem:** ACT-03; JRN-08. **Comportamento:** antes de agendar, o responsável configura serviços (duração e intervalo), profissionais, salas/equipamentos e disponibilidade mínimos. **Aceite:** o fluxo de ativação não libera agendamentos sem essa configuração; atendente não altera nenhum desses itens. **Dados/eventos:** configuração no D1 da clínica.

### REQ-060 — Dados usados pela IA

**Prioridade/estado:** MVP / Confirmado (DEC-011); revisão jurídica pendente. **Origem:** ACT-02, ACT-03; JRN-02. **Comportamento:** o contexto enviado à IA contém só mensagens recentes da conversa (proposta: até 20), primeiro nome do contato, catálogo de serviços da clínica e etapa da oportunidade. **Aceite:** inspecionando a solicitação enviada ao AI Gateway em teste, não aparecem telefone, anexos, outras conversas nem dados de outra clínica; o AI Gateway não registra o conteúdo. **Dados/eventos:** não usar dados reais antes da revisão jurídica.

### REQ-061 — Retenção e exclusão

**Prioridade/estado:** MVP / Confirmado (DEC-011); revisão jurídica pendente. **Origem:** ACT-03, ACT-05. **Comportamento:** dados ficam enquanto a clínica for cliente; o responsável pode excluir um contato; ao encerrar a clínica, todos os dados dela são excluídos em até 30 dias. **Aceite:** após excluir um contato, suas mensagens e anexos não são mais encontrados por busca, API ou R2, e seus agendamentos permanecem sem dados pessoais; após o prazo de encerramento, o D1 da clínica e seu prefixo R2 não existem mais. **Dados/eventos:** exclusão registrada na auditoria sem o conteúdo excluído.

### REQ-070 — Observabilidade do fluxo

**Prioridade/estado:** MVP / Proposto. **Origem:** ACT-02, ACT-03; JRN-06. **Comportamento:** falhas de entrada, fila, envio e atualização em tempo real podem ser identificadas sem expor conteúdo sensível em logs. **Aceite:** para falhas simuladas, é possível localizar tenant, tipo de evento, etapa e resultado técnico; a equipe vê falhas que exigem ação no painel. **Dados/eventos:** retenção e acesso a logs ainda precisam de política.

## Plataforma

### REQ-080 — App de superadmin

**Prioridade/estado:** MVP / Confirmado quanto à existência (DEC-012); funções propostas em [ADR-0006](../adr/0006-superadmin-control-plane.md). **Origem:** ACT-05; JRN-08. **Comportamento:** app separado do painel da clínica permite criar clínica, provisionar e migrar seu D1, convidar o responsável, acompanhar a ativação do WhatsApp e ver saúde técnica por clínica. **Aceite:** um superadmin não aparece como membro de clínica nem abre contatos, conversas ou agenda; cada ação dele fica na auditoria de plataforma; um atendente ou responsável não acessa o app. **Dados/eventos:** D1 central e metadados técnicos. Superadmin é identificado pelo metadado privado `superadmin: true` do Clerk, verificado no servidor; não vê conteúdo de clínica, exceto por acesso temporário concedido pelo responsável (DEC-012). **Aceite adicional:** usuário sem o metadado é negado no app de superadmin mesmo se alterar dados no navegador; acesso temporário expira sozinho e aparece na auditoria da clínica.

## Fora do MVP

**Fora do MVP:** prontuário/registro clínico, pagamentos, estoque, agendas externas, campanhas em massa, bot que responde ou agenda sozinho e relatórios avançados. Nenhum requisito acima deve ser interpretado como compromisso de implementar essas funções.

## Lacunas para revisão

Antes de converter este catálogo em issues de implementação, fechar ou manter com hipótese explícita: mecanismo de abertura do D1 por clínica; custo e residência de dados do Clerk; segundo fator do superadmin; revisão jurídica da retenção. Ver [decisões](decisions.md).
