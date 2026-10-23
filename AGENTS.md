# Instruções para agentes — documentação de produto do Tredane

Estas instruções se aplicam a qualquer agente que crie ou altere documentação de produto neste repositório. Escreva em português claro e mantenha cada afirmação ligada a uma decisão, evidência ou hipótese identificável.

## Onde está a informação

- `README.md`: apresentação curta e navegação do projeto.
- `docs/MVP.md`: fonte concisa de verdade para objetivo, recorte, decisões e limites do MVP. Mantenha este documento curto e aponte para especificações detalhadas quando elas existirem.
- [Épico de definição do MVP, issue #1](https://github.com/intentzero/tredane/issues/1): trabalho pendente e critérios para encerrar a definição. Checkboxes de uma issue não substituem especificação aprovada.
- `docs/product/`: local para novos documentos de atores, jornadas, requisitos e decisões, quando o detalhe exceder o que cabe em `docs/MVP.md`. Crie apenas documentos necessários para o trabalho em andamento; não crie páginas vazias.

Antes de editar, leia a versão atual dos documentos relacionados e da issue #1. Se houver divergência, registre-a e corrija a fonte apropriada; não deixe duas versões concorrentes da mesma decisão.

## Estado das afirmações

Identifique explicitamente cada item relevante como **Confirmado**, **Proposto**, **Em aberto** ou **Fora do MVP**:

- **Confirmado:** decisão expressa pelo responsável pelo produto ou registrada em documento revisado por ele. Aponte a origem ou a issue correspondente.
- **Proposto:** hipótese ou recomendação ainda sujeita a validação. Explique o motivo e o que falta decidir.
- **Em aberto:** pergunta com impacto no escopo, na experiência ou nos dados. Registre opções, responsável pela decisão e momento em que ela bloqueia a implementação.
- **Fora do MVP:** item excluído do primeiro recorte; não o transforme em requisito de implementação por inferência.

Não promova uma proposta a decisão confirmada porque ela parece tecnicamente conveniente. Preserve decisões anteriores até que uma mudança explícita as substitua; ao mudar uma decisão, registre o que mudou e atualize os links afetados.

## Contexto que deve permanecer consistente

- Tredane é um SaaS multi-tenant de atendimento para clínicas de estética, com WhatsApp, pipeline comercial, agenda própria e assistência por IA.
- O WhatsApp previsto é a API oficial do WhatsApp Business. A forma de conectar e administrar a conta de cada clínica continua em aberto.
- O painel deve receber atualizações em tempo real por WebSockets com hibernação em Durable Objects. Um Durable Object por clínica é uma proposta de coordenação e isolamento do estado em tempo real; a escolha final e o isolamento dos dados em D1/R2 ainda precisam ser especificados.
- O primeiro recorte de IA é assistivo, com sugestão e revisão humana, conforme `docs/MVP.md`. Respostas ou agendamentos autônomos ficam fora desse recorte.
- Identidade pelo Clerk sem Organizations; `privateMetadata.superadmin` (booleano) só é autoritativo no backend; memberships N:N e roles por tenant vivem no D1.
- A Platform Admin App é separada do painel operacional das clínicas e gere tenants. Superadmin poderá impersonar usuário de um tenant para suporte, mediante sessão temporária, escopo, auditoria de ator e alvo, e políticas de segurança; o mecanismo escolhido é sessão própria do Tredane; detalhes de segurança, revogação e política de dados devem ser especificados antes de uso real. Ver ADR-0006/0007.
- O fluxo piloto começa na mensagem recebida e termina no agendamento confirmado, incluindo visão da conversa e do pipeline. Detalhes de regras da agenda, permissões específicas, política de suporte/impersonação, retenção e provedor de IA permanecem pendentes.

Ao atualizar esse contexto, altere primeiro o documento que contém a decisão e depois as referências resumidas. Não use estas instruções como substituto para a especificação de produto.

## Como documentar

### Atores e permissões

Para cada ator, registre objetivo, responsabilidades, dados que pode ver, ações permitidas e limites. Separe atores confirmados dos que precisam de validação. Documente permissões por clínica e o efeito de entrada, saída ou revogação de membros, inclusive sobre conexões em tempo real.

### Jornadas

Para cada jornada, registre: identificador estável, ator, objetivo, gatilho, pré-condições, fluxo principal, alternativas/erros, resultado, telas ou pontos de contato, dados afetados e requisitos relacionados. Inclua estados de espera, falha e reconexão quando forem visíveis ao usuário. Use exemplos fictícios; não inclua dados reais de pacientes ou clínicas.

### Requisitos

Escreva requisitos observáveis e testáveis. Para cada um, registre identificador estável, prioridade (**MVP**, **posterior** ou **fora**), ator/jornada de origem, comportamento esperado, regras e exceções, dados/limite de tenant, eventos em tempo real quando aplicável e critérios de aceite. Evite requisitos como “rápido” ou “intuitivo” sem um critério verificável. Não renumere identificadores já referenciados.

### Decisões

Registre problema, opções consideradas, decisão e motivo, impacto no produto e itens a revisar. Marque data e origem da decisão. Se ainda não houver escolha, mantenha o registro como **Em aberto** e não escreva a opção preferida como comportamento obrigatório.

## Pontos que exigem cuidado especial

- **Isolamento entre clínicas:** documente separadamente autorização na API, consultas e gravações em D1, roteamento para Durable Objects, eventos WebSocket, mensagens em Queues, arquivos em R2 e processos em Workflows. Um objeto por clínica não isola automaticamente os demais serviços.
- **Tempo real:** especifique quais eventos atualizam cada tela, quem pode recebê-los, como a interface reconcilia dados após perda de conexão e o que acontece quando uma permissão é revogada.
- **WhatsApp:** diferencie mensagem recebida, tentativa de envio, confirmação de entrega e falha. Inclua reentrega de webhook e idempotência nas jornadas de exceção.
- **Agenda:** não assuma que apenas o profissional ocupa um horário. Valide duração, sala/equipamento, bloqueios, cancelamento e reagendamento com a clínica piloto.
- **IA:** indique quais dados entram no contexto, quem revisa a saída, o que é registrado e quando há transferência para uma pessoa. Não atribua à IA ações autônomas que não foram aprovadas.
- **Dados pessoais:** use apenas exemplos fictícios e documente coleta mínima, acesso, retenção e exclusão antes de propor uso de dados reais.

## Ao concluir uma alteração de documentação

1. Verifique que os termos e o estado das decisões estão consistentes com `docs/MVP.md` e a issue #1.
2. Ligue jornadas a requisitos e requisitos a critérios de aceite; registre lacunas como **Em aberto**.
3. Atualize o resumo em `docs/MVP.md` se objetivo, recorte, decisão ou limite do MVP mudou. Mantenha detalhes em documentos específicos e adicione links, sem duplicar textos longos.
4. Leia os links e revise se uma proposta foi apresentada como fato, se há dados reais em exemplos ou se um requisito não pode ser verificado.
5. Informe em sua entrega o que ficou confirmado, o que continua pendente e quais documentos foram alterados.
