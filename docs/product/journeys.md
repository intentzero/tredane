# Jornadas do MVP

**Estado:** proposta para validação. **Fonte:** [MVP](../MVP.md), [atores](actors-permissions.md) e [épico #1](https://github.com/intentzero/tredane/issues/1). As jornadas descrevem comportamentos desejados, não telas finais nem integração já construída. Os critérios verificáveis estão em [requisitos](requirements.md).

## JRN-01 — Primeiro contato pelo WhatsApp

- **Ator e objetivo:** ACT-01 inicia uma conversa; ACT-02 precisa recebê-la com contexto suficiente para atender.
- **Gatilho e pré-condições:** o contato envia mensagem a um número conectado à clínica; a integração está ativa e a origem do webhook é validada.
- **Fluxo principal:** (1) o Tredane associa o número à clínica; (2) identifica ou cria o contato; (3) registra a mensagem na conversa; (4) cria ou associa a oportunidade; (5) coloca a conversa na caixa de entrada; (6) publica um evento apenas para sessões autorizadas daquela clínica.
- **Alternativas:** mensagem repetida não gera duplicata; mídia não suportada ou indisponível aparece com estado/erro observável; falha transitória no processamento não perde a mensagem sem sinalização e possibilidade de reprocessamento.
- **Resultado, superfícies e dados:** conversa e oportunidade visíveis no painel; contato, mensagem, estado de recebimento e identificador externo registrados. Nenhuma clínica diferente recebe o evento.
- **Requisitos:** REQ-010, REQ-011, REQ-012, REQ-040, REQ-050.

## JRN-02 — Atendimento humano com apoio de IA

- **Ator e objetivo:** ACT-02 assume a conversa, entende o pedido e responde; ACT-03 pode acompanhar conforme permissões finais.
- **Gatilho e pré-condições:** há conversa recebida e membro autorizado na clínica.
- **Fluxo principal:** (1) atendente abre e assume a conversa; (2) lê mensagens e histórico disponível; (3) pede sugestão ou resumo à IA; (4) revisa e, se quiser, edita o texto; (5) envia a resposta; (6) o painel mostra tentativa e estado de envio; (7) a outra sessão autorizada vê a mudança.
- **Alternativas:** atendente ignora a sugestão; provedor de IA falha e a resposta manual continua possível; envio falha ou fica com resultado desconhecido e o painel não apresenta sucesso falso; conversa é transferida para outro membro; duas pessoas tentam assumir ao mesmo tempo e o estado final fica claro.
- **Resultado, superfícies e dados:** caixa de entrada atualizada com responsável, histórico, origem da sugestão e estado da mensagem. Texto não revisado não é enviado automaticamente.
- **Requisitos:** REQ-020, REQ-021, REQ-022, REQ-041, REQ-060.

## JRN-03 — Oportunidade até horário confirmado

- **Ator e objetivo:** ACT-02 transforma uma conversa em agendamento; ACT-01 recebe confirmação pelo WhatsApp quando o envio estiver disponível.
- **Gatilho e pré-condições:** contato quer marcar horário; serviço, duração, disponibilidade, profissional e sala/equipamento necessários estão definidos para a clínica.
- **Fluxo principal:** (1) atendente atualiza a etapa da oportunidade; (2) consulta horários disponíveis; (3) seleciona serviço, recurso e horário; (4) confirma o agendamento; (5) conversa, pipeline e agenda exibem o mesmo compromisso; (6) sessões da clínica recebem evento de atualização.
- **Alternativas:** intervalo ficou ocupado antes da confirmação; recurso está indisponível; contato não aceita o horário proposto; envio da confirmação falha sem desfazer um agendamento já confirmado. A equipe vê o estado correto em cada caso.
- **Resultado, superfícies e dados:** agendamento confirmado com vínculo ao contato e à oportunidade, sem conflito de recursos; registro de quem confirmou e quando.
- **Requisitos:** REQ-030, REQ-031, REQ-032, REQ-033, REQ-040.

## JRN-04 — Acompanhamento pela clínica

- **Ator e objetivo:** ACT-03 acompanha volume de conversas, andamento das oportunidades e agenda da própria clínica; ações de gestão dependem da matriz final.
- **Gatilho e pré-condições:** responsável autenticado e associado à clínica.
- **Fluxo principal:** (1) abre a visão de atendimento/pipeline/agenda; (2) filtra ou localiza um contato; (3) consulta estado atual, responsável e próximo compromisso; (4) vê mudanças feitas em outra sessão sem recarregar a página.
- **Alternativas:** não há dados; membro foi removido; conexão em tempo real caiu e a interface precisa reconciliar com a API antes de mostrar estado atual.
- **Resultado, superfícies e dados:** visão consistente apenas da própria clínica. Relatórios avançados não são exigência deste MVP.
- **Requisitos:** REQ-001, REQ-023, REQ-034, REQ-040, REQ-042.

## JRN-05 — Cancelamento ou reagendamento

- **Ator e objetivo:** ACT-01 solicita mudança pelo WhatsApp; ACT-02 ou ACT-03 resolve o compromisso.
- **Gatilho e pré-condições:** existe agendamento; a clínica define quem pode alterá-lo e quais recursos ficam livres após cancelamento.
- **Fluxo principal:** (1) equipe encontra o compromisso na conversa ou agenda; (2) registra motivo, se necessário; (3) cancela ou procura novo horário; (4) confirma a mudança; (5) agenda, pipeline e conversa passam a refletir o novo estado; (6) sessões autorizadas recebem a atualização.
- **Alternativas:** novo horário entrou em conflito; compromisso já foi alterado por outra pessoa; comunicação da mudança ao contato falhou. O sistema preserva o estado confirmado e informa a falha de mensagem separadamente.
- **Resultado, superfícies e dados:** histórico do compromisso e disponibilidade coerentes. Política de prazo de cancelamento é **Em aberto** e não deve ser inventada.
- **Requisitos:** REQ-031, REQ-032, REQ-033, REQ-040.

## JRN-06 — Falhas de integração e processamento

- **Ator e objetivo:** ACT-02/ACT-03 entende o que falhou e consegue retomar o atendimento sem duplicar ações.
- **Gatilho e pré-condições:** webhook repetido, falha no provedor, fila reprocessada ou resposta de envio pendente.
- **Fluxo principal:** (1) o evento entra com identificador e tenant verificados; (2) o processamento tenta persistir ou enviar; (3) estado e falha ficam observáveis; (4) reprocessamento de entrada mantém uma única mensagem lógica; (5) uma tentativa de envio com resultado desconhecido aguarda reconciliação antes de nova tentativa; (6) a equipe vê o estado conhecido na conversa.
- **Alternativas:** origem não verificada é rejeitada; associação do número à clínica não existe; falha permanente exige intervenção; estado de entrega chega depois da tentativa de envio.
- **Resultado, superfícies e dados:** histórico sem duplicatas e sem sucesso falso. Alertas operacionais e política de retentativa ainda precisam de detalhe técnico.
- **Requisitos:** REQ-011, REQ-012, REQ-013, REQ-050, REQ-070.

## JRN-07 — Tempo real, reconexão e revogação

- **Ator e objetivo:** ACT-02/ACT-03 vê alterações recentes sem atualizar a página e perde acesso ao sair da clínica.
- **Gatilho e pré-condições:** duas sessões autorizadas da mesma clínica e uma sessão de outra clínica estão abertas.
- **Fluxo principal:** (1) uma sessão altera conversa, oportunidade ou agenda; (2) o servidor persiste a mudança; (3) apenas sessões da clínica autorizada recebem o evento; (4) as interfaces atualizam a visão; (5) após reconexão, consultam o estado canônico e corrigem lacunas.
- **Alternativas:** Durable Object hiberna e retoma; evento é perdido ou chega duplicado; sessão é revogada ou membro sai da clínica; conexão antiga deixa de receber dados e novas ações são negadas.
- **Resultado, superfícies e dados:** as sessões da mesma clínica convergem para o estado persistido, sem vazamento para outra clínica. O mecanismo exato de invalidação de conexão ainda é decisão técnica.
- **Requisitos:** REQ-001, REQ-002, REQ-003, REQ-040, REQ-041, REQ-042.

## JRN-08 — Ativação de uma clínica (pendente)

- **Estado:** Em aberto. O produto precisará criar a clínica, associar o responsável, configurar serviços, profissionais e salas/equipamentos e conectar o número oficial de WhatsApp. Ainda não há decisão sobre autosserviço, operação assistida ou responsabilidade pela conta Meta. Não desenhar um fluxo definitivo de ativação antes dessa escolha.
- **Requisitos relacionados:** REQ-004, REQ-051, REQ-052.

## Validação necessária

Revisar as jornadas com o responsável pelo produto e uma clínica piloto, em especial: escopo de acesso do atendente, quem opera a agenda, durações e regras de disponibilidade dos recursos, cancelamento, confirmação ao contato e ativação do WhatsApp. Registrar as respostas em [decisões](decisions.md) e ajustar os requisitos ligados às jornadas afetadas.
