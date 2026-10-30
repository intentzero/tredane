# Instruções para agentes — documentação de produto do Tredane

Estas instruções se aplicam a qualquer agente que crie ou altere documentação de produto neste repositório. Escreva em português claro e mantenha cada afirmação ligada a uma decisão, evidência ou hipótese identificável.

## Onde está a informação

- `README.md`: apresentação curta e navegação do projeto.
- `docs/MVP.md`: fonte concisa de verdade para objetivo, recorte, decisões e limites do MVP. Mantenha este documento curto e aponte para especificações detalhadas quando elas existirem.
- [Épico de definição do MVP, issue #1](https://github.com/intentzero/tredane/issues/1): trabalho pendente e critérios para encerrar a definição. Checkboxes de uma issue não substituem especificação aprovada.
- [Épico de implementação do MVP, issue #14](https://github.com/intentzero/tredane/issues/14): execução do sistema (F0–F6, issues #15–#45). O [plano](docs/implementation/plan.md) liga-se a este épico sem renumerar DEC/REQ; hipóteses antigas em plan/states/validation-register cedem às decisões confirmadas.
- `docs/design/`: mocks de UI/UX do painel (fontes `.dc.html`, previews PNG), índice de telas, componentes, tokens e catálogo. Quem implementa ou altera interface deve começar por `docs/design/README.md`; a especificação em `docs/product/ux-ui.md` prevalece sobre os mocks. Biblioteca-base do painel: **React Aria Components** (DEC-048 / [ADR-0013](docs/adr/0013-design-system-components.md)); tokens e Lucide conforme DEC-041, fonte Roboto conforme DEC-073.
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
- O WhatsApp previsto é a API oficial do WhatsApp Business. DEC-009 confirmou Embedded Signup oficial pela owner, com assistência do Tredane no piloto. Cadastro Tech Provider, modelos reais e autorização Meta continuam como gates externos.
- O painel deve receber atualizações em tempo real por WebSockets com hibernação em Durable Objects. DEC-038 confirma um Durable Object por clínica, com SQLite nativo como fonte de verdade operacional (contatos, conversas, pipeline e agenda). D1 central mantém tenants, memberships N:N, convites e suporte; R2 privado mantém anexos. Ver ADR-0012; não voltar a tratar topologia como decisão aberta ou SQLite do DO como D1. Revogação D1/DO, migrações por instância e recuperação continuam pendentes de implementação/testes.
- O primeiro recorte de IA é assistivo, com sugestão e revisão humana, conforme `docs/MVP.md`. Respostas ou agendamentos autônomos ficam fora desse recorte, exceto o agendamento confirmado pela própria cliente (DEC-060; revisão DEC-061, Decidido 28/10/2026: só por botão do WhatsApp em proposta versionada pelo backend).
- Identidade pelo Clerk sem Organizations; `privateMetadata.superadmin` (booleano) só é autoritativo no backend; memberships N:N e roles por tenant vivem no D1. A pessoa seleciona e troca explicitamente a clínica ativa; cada contexto revalida o membership e não reaproveita cache ou WebSocket de outro tenant (DEC-017).
- A Platform Admin App é separada do painel operacional das clínicas e gere tenants. Superadmin poderá impersonar usuário de um tenant para suporte, mediante sessão temporária, escopo, auditoria de ator e alvo, e políticas de segurança; o mecanismo escolhido é sessão própria do Tredane; detalhes de segurança, revogação e política de dados devem ser especificados antes de uso real. Ver ADR-0006/0007.
- O fluxo piloto começa na mensagem recebida e termina no agendamento confirmado, incluindo visão da conversa e do pipeline. DEC-008 fixou regras da agenda e DEC-076 retirou a duração ajustável: a duração do procedimento é a do cadastro. DEC-078 (Paulo, 29/10/2026, «implementa o epico») confirma zonas no serviço: várias zonas, cada uma com duração e preço, num único horário; sem zonas, vale a linha. DEC-075 não é a decisão das zonas. DEC-042 fixou configuração apenas pela owner. DEC-075 (Paulo, 29/10/2026) confirma a sala partilhada, não exclusiva: cada profissional tem uma sala, a capacidade já prevista, dois modos de atendimento, «Mesmo sexo neste horário» opcional e a exceção «Permitir os dois» só pela responsável; o serviço tem audiência (feminino, masculino ou qualquer) e o contato não ganha sexo. A frase «profissional atende 1 de cada vez» da DEC-059 fica revista por essa decisão. DEC-077 (Paulo, 29/10/2026) confirma o bloco Tempo no serviço, desligado por defeito: o horário automático e a proposta dependem da previsão na hora de início; a marcação manual avisa e confirma; a IA não recebe o payload do provedor. DEC-011 fixou Claude via AI Gateway e retenção de produto (REQ-072 = contexto IA); DEC-029–037 fixaram o ciclo de aprovação e duração de suporte. DEC-040 permite etapa «Agendado» sem compromisso vinculado; DEC-047 confirma sinal Pix na conta da clínica e confirmação automática do horário se livre após pagamento (sem reserva antes do Pix); DEC-049 confirma Woovi (OpenPix) como provedor (Mercado Pago permanece alternativa documentada; adaptador real e DPA ainda pendentes). DEC-048 confirma React Aria Components como biblioteca-base do painel (Radix descartado após prova #16); Q-UX-01 (PWA/aparelho e VoiceOver) não bloqueia telas produtivas. Valores reais da clínica, protocolo técnico de revogação/handoff, política de capacidades, anexos, revisão jurídica e testes ainda são pendentes.

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

- **Isolamento entre clínicas:** documente separadamente autorização na API, consultas e gravações no D1 central e SQLite por clínica, roteamento para Durable Objects, eventos WebSocket, mensagens em Queues, arquivos em R2 e processos em Workflows. Um objeto por clínica não isola automaticamente os demais serviços.
- **Tempo real:** especifique quais eventos atualizam cada tela, quem pode recebê-los, como a interface reconcilia dados após perda de conexão e o que acontece quando uma permissão é revogada.
- **WhatsApp:** diferencie mensagem recebida, tentativa de envio, confirmação de entrega e falha. Inclua reentrega de webhook e idempotência nas jornadas de exceção.
- **Agenda:** não assuma que apenas o profissional ocupa um horário. Valide duração, sala/equipamento, bloqueios, cancelamento e reagendamento com a clínica piloto.
- **IA:** indique quais dados entram no contexto, quem revisa a saída, o que é registrado e quando há transferência para uma pessoa. Não atribua à IA ações autônomas que não foram aprovadas.
- **Dados pessoais:** use apenas exemplos fictícios e documente coleta mínima, acesso, retenção e exclusão antes de propor uso de dados reais.

## Ao concluir uma alteração de documentação

1. Se alterou um mock ou uma tela, atualize junto o `.dc.html`, o preview, `docs/design/screens.md` e `docs/product/ux-ui.md`; se alterou um token, rode `docs/design/tools/check_contrast.py` e `check_mocks.py`.
2. Verifique que os termos e o estado das decisões estão consistentes com `docs/MVP.md` e a issue #1.
3. Ligue jornadas a requisitos e requisitos a critérios de aceite; registre lacunas como **Em aberto**.
4. Atualize o resumo em `docs/MVP.md` se objetivo, recorte, decisão ou limite do MVP mudou. Mantenha detalhes em documentos específicos e adicione links, sem duplicar textos longos.
5. Leia os links e revise se uma proposta foi apresentada como fato, se há dados reais em exemplos ou se um requisito não pode ser verificado.
6. Informe em sua entrega o que ficou confirmado, o que continua pendente e quais documentos foram alterados.
