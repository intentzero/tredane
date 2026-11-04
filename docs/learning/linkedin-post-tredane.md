# LinkedIn — Construir um chatbot: o trabalho que começa depois da integração

Construir chatbots não é tarefa fácil. Não basta ligar um LLM à API do WhatsApp e a uma agenda.

Estamos a desenvolver a [Tredane](https://tredane.com), uma plataforma que reúne atendimento pelo WhatsApp, gestão de agendamentos e apoio de IA para clínicas de estética.

Num dos testes, uma pessoa fez um pedido com várias opções. O sistema avançou para horários considerando apenas parte da escolha.

A conversa continuava. Parte do pedido tinha desaparecido.

Para quem está do outro lado, receber horários sugere que o pedido foi considerado na íntegra. Essa diferença entre a intenção da pessoa e o estado do sistema pode transformar-se numa marcação errada.

A experiência tem reforçado algumas práticas:

- **Arquitetura híbrida:** interpretação da linguagem com apoio de LLM, estado estruturado para preservar o pedido e regras de negócio para validar as ações.
- **Modelação do domínio:** representar as relações entre serviços, opções, recursos e horários para apresentar escolhas válidas.
- **Confirmação explícita:** compreender uma mensagem e autorizar uma marcação são passos distintos.
- **Segurança:** proteger os dados e respeitar as permissões em todas as partes do sistema.
- **Testes automatizados:** transformar falhas observadas em cenários de regressão que verifiquem o pedido, o estado e o resultado.

Grafos de domínio são uma forma possível de representar essas relações. O princípio é dar ao sistema uma estrutura verificável sobre o que pode acontecer.

Também precisamos de evitar **labirintos de IA**: perguntas repetidas, ciclos sem saída e conversas em que o utilizador tem de descobrir como fazer o sistema compreendê-lo.

A pessoa precisa de conseguir corrigir uma escolha, recomeçar e chegar a alguém com o contexto já recolhido.

Nos testes, interessa verificar se todas as escolhas foram preservadas, se uma correção funciona e se uma confirmação expirada é recusada. A linguagem pode variar; as regras que protegem o utilizador precisam de se manter.

Construir um chatbot envolve decidir como interpretar, quando perguntar e em que condições agir. A experiência precisa de dar à pessoa clareza e controlo durante todo esse percurso.

Que situações vos fizeram repensar a experiência de um chatbot?

---

## Notas editoriais — não incluir na publicação

- **Confirmado (editorial):** texto aprovado pelo Paulo nesta conversa em 03/11/2026 para atualização do PR #525. Esta atualização não constitui publicação.
- **Confirmado (fontes de produto):** apresentação conforme [MVP](../MVP.md); confirmação conforme DEC-061; núcleo determinístico e LLM assistivo conforme DEC-104; estado partilhado conforme [ADR-0015](../adr/0015-estado-persistente-da-conversa.md); segurança em camadas conforme [ADR-0012](../adr/0012-clinic-durable-object-sqlite.md).
- **Confirmado (material-fonte):** exemplos generalizados da sonda em ambiente de teste e práticas de regressão descritos em [lições de arquitetura](licoes-arquitectura-tredane.md), incluindo #506–#512. Sem detalhes de procedimentos, dados pessoais ou métricas comerciais.
- **Proposto / Em aberto:** Flow é caminho previsto; o desenho detalhado e a implementação seguem [ADR-0016](../adr/0016-whatsapp-flow-agendamento.md) e #514. Grafos de domínio são apresentados como abordagem possível, sem afirmar implementação explícita na Tredane.
- **Proposto (prática geral):** extensão das verificações a ciclos de conversa e handoff; o artigo não declara cobertura completa nem certificação de segurança. Decisões e propostas continuam subordinadas ao MVP, às DECs e aos ADRs.
