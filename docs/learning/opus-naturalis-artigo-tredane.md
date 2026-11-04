# O chatbot avançou. O pedido ficou para trás.

*O que os testes da Tredane nos ensinaram sobre arquitetura conversacional, decisões de produto e os limites da IA.*

Num teste pelo WhatsApp, uma pessoa pediu duas opções para o mesmo agendamento. O chatbot apresentou horários, como seria de esperar.

Havia um problema: os horários correspondiam apenas a uma das opções.

A conversa não tinha parado. Não apareceu uma mensagem de erro. O sistema continuou a responder normalmente, mas parte do pedido tinha desaparecido.

Este é um dos erros mais difíceis de detetar numa interface conversacional: **o sistema parece estar a funcionar precisamente quando deixa de representar o que a pessoa pediu.**

Para quem está do outro lado, receber uma lista de horários significa, implicitamente, que o pedido foi compreendido. Se essa premissa estiver errada, a pessoa pode avançar sem perceber que está a confirmar algo diferente da sua intenção.

Foi uma das situações que encontrámos durante o desenvolvimento da [Tredane](https://tredane.com), uma plataforma de atendimento para clínicas de estética que reúne conversas pelo WhatsApp, organização do atendimento, agenda própria e apoio de inteligência artificial.

O projeto fez-nos olhar para uma questão que vai muito além da integração de um modelo de linguagem: como garantir que uma conversa mantém a intenção da pessoa, respeita as regras do negócio e só executa uma ação quando existem condições para isso?

## O problema não estava apenas na interpretação

À primeira vista, perder parte de um pedido pode parecer uma limitação do modelo de linguagem. Talvez seja necessário melhorar o prompt, acrescentar exemplos ou dar mais contexto à IA.

Mas os testes mostraram problemas de outra natureza.

Numa situação, uma conversa nova recuperava escolhas de uma sessão anterior e saltava diretamente para horários. Noutra, tocar num horário da lista não preservava corretamente o dia escolhido. O sistema voltava a perguntar por uma informação que a pessoa já tinha fornecido.

E havia o caso do pedido combinado: duas escolhas expressas na mesma mensagem, mas apenas uma considerada no passo seguinte.

Estávamos perante problemas diferentes, com uma consequência comum: **o estado interno da conversa nem sempre correspondia ao pedido que o utilizador acreditava estar a construir.**

Isso mudou a forma de abordar o problema.

Uma conversa pode receber informação por texto livre, botões ou listas. A pessoa pode corrigir uma escolha, mudar de assunto, interromper o atendimento ou regressar mais tarde.

Se cada caminho interpreta e guarda o pedido à sua maneira, a experiência torna-se frágil. Uma opção pode desaparecer entre duas mensagens. Uma correção pode alterar o campo errado. Uma resposta pode desencadear um passo que já não faz sentido.

Não era suficiente melhorar a redação das respostas. Era necessário tornar o pedido verificável.

## Dar memória à conversa não é guardar mais mensagens

Uma das decisões de arquitetura da Tredane foi consolidar o estado do agendamento numa estrutura persistente, a que chamamos `BookingFrame`.

Na prática, é um registo do que o sistema sabe sobre aquele pedido: serviço, opções escolhidas, data, horário, etapa da conversa, proposta pendente e origem das informações.

Parece uma diferença pequena, mas muda a responsabilidade de cada componente.

Em vez de tentar reconstruir a intenção da pessoa relendo o histórico das mensagens a cada interação, o sistema passa a consultar um estado explícito. O histórico continua a existir, mas deixa de ser a fonte de verdade das decisões de agendamento.

Considerámos diferentes caminhos para chegar lá: continuar a reconstruir o estado pelas mensagens, criar uma nova estrutura de armazenamento ou evoluir o registo persistente que já existia.

Escolhemos a última opção.

Permitia aproveitar a estrutura de sessões existente, evitar duas fontes de verdade durante a transição e concentrar a mudança no contrato de dados e na lógica da conversa.

A implementação também procura manter consistentes a mensagem enviada e a atualização do estado, gravando-as na mesma transação do armazenamento operacional da clínica.

O efeito esperado para quem utiliza o sistema é simples: uma informação já recolhida não deve desaparecer só porque a conversa mudou de formato.

Da mesma forma, recomeçar precisa de significar recomeçar. Não basta o chatbot dizer que vai começar de novo se continuar a guardar escolhas antigas.

Os testes levaram-nos a corrigir esse comportamento, incluindo a limpeza do estado e a retirada de propostas pendentes quando a pessoa reinicia o pedido.

Esta é uma aprendizagem que considero importante: **a memória útil de um assistente não é a quantidade de texto que consegue recordar. É a capacidade de conservar, atualizar e invalidar a informação certa.**

## Onde termina a interpretação e começa a decisão

A arquitetura conversacional que estamos a desenvolver é híbrida, mas não no sentido de acrescentar um modelo de linguagem a todos os passos da aplicação.

O modelo tem valor quando a pessoa escreve de formas inesperadas, faz uma pergunta aberta ou expressa uma intenção que não cabe numa escolha estruturada.

Mas não queremos que uma interpretação probabilística seja, por si só, autorização para alterar a agenda.

Por isso, no percurso normal, o núcleo conversacional trabalha com respostas e regras determinísticas. O modelo é utilizado para interpretar situações não cobertas e responder a perguntas abertas, dentro de limites e com validação.

É uma separação deliberada.

Se o sistema reconhecer apenas uma parte de um pedido combinado, não deve avançar silenciosamente com essa parte. Deve conservar o que compreendeu e pedir esclarecimento sobre o restante.

Se uma escolha não existir no catálogo, não deve inventar uma alternativa plausível. Deve apresentar as opções disponíveis ou permitir que alguém da equipa continue o atendimento.

E, quando chega o momento de agendar, a disponibilidade não é uma opinião do modelo. Depende dos dados e das restrições da agenda.

Serviços, opções, profissionais, recursos e horários estão relacionados. Uma escolha pode alterar a duração do atendimento e, consequentemente, os horários disponíveis. Uma combinação pode ser válida numa situação e inválida noutra.

É aqui que a modelação do domínio se torna tão importante como a interpretação da linguagem.

Uma abordagem possível é representar essas relações através de **grafos de domínio**, tornando explícitas as entidades, as suas ligações e as restrições aplicáveis.

Não é obrigatório implementar um grafo para beneficiar desse raciocínio. Na Tredane, a abordagem documentada utiliza estruturas de dados e regras de domínio para validar as escolhas. Um grafo explícito de domínio não faz parte das implementações que podemos afirmar neste momento.

O princípio é o mesmo: a IA ajuda a compreender a intenção, mas o sistema precisa de saber, de forma verificável, o que essa intenção permite fazer.

## Evitar que a conversa se transforme num labirinto

Uma interface conversacional pode ser muito educada e, ainda assim, profundamente frustrante.

Pergunta novamente o que já foi respondido. Obriga a repetir um pedido inteiro para corrigir um detalhe. Oferece opções que não correspondem à escolha anterior. Ou continua a fazer perguntas quando a pessoa já só quer falar com alguém.

São os **labirintos de IA**: conversas que parecem avançar, mas transferem para o utilizador o esforço de manter o sistema orientado.

Parte do nosso trabalho tem sido transformar estas situações em comportamentos explícitos.

Se a informação já existe e continua válida, não deve ser pedida novamente. Se a pessoa quer corrigir uma escolha, a conversa deve regressar ao ponto correspondente, sem perder o restante pedido. Se quer começar de novo, o estado anterior deve ser limpo.

E, quando o atendimento passa para uma pessoa, a equipa deve receber o contexto estruturado que já foi recolhido. Não faz sentido tratar a transferência como uma conversa inteiramente nova.

Também percebemos que nem tudo precisa de ser resolvido por mensagens sucessivas.

O WhatsApp permite listas e botões, mas determinados pedidos são mais fáceis de construir através de uma seleção múltipla num formulário.

Por isso, decidimos avançar com um WhatsApp Flow como caminho estruturado principal para o agendamento.

A alternativa de colocar um catálogo estático dentro do formulário foi considerada e descartada: os horários dependem das escolhas feitas e da disponibilidade atual da clínica. O desenho escolhido prevê consultar o backend à medida que o pedido é preenchido, mantendo o mesmo estado e as mesmas regras de domínio.

Esta é uma direção de produto já decidida, não uma funcionalidade que estejamos a apresentar como disponível. O desenho detalhado, a implementação e os testes do Flow no ambiente da Meta ainda fazem parte do trabalho em curso.

A experiência em texto livre continuará a ser importante, nomeadamente quando o formulário não estiver disponível ou a pessoa preferir escrever.

O objetivo não é substituir a conversa por um formulário. É utilizar cada forma de interação onde ela ajuda mais, sem criar versões contraditórias do mesmo pedido.

## A confirmação é uma fronteira de segurança

Há uma distinção especialmente importante numa aplicação que pode executar ações reais: compreender uma mensagem não significa estar autorizado a agir.

Um «sim» pode significar muitas coisas. Pode confirmar uma escolha, aceitar uma explicação ou indicar preferência por determinado horário.

Não deve bastar para criar uma marcação.

Na Tredane, a decisão é separar a construção do pedido da confirmação final. O backend prepara uma proposta identificada e versionada. Só a ação explícita no botão de confirmação dessa proposta pode criar o compromisso.

E essa autorização não é permanente.

Se a proposta expirou ou o horário deixou de estar disponível, o sistema não deve concluir a marcação. Precisa de explicar a situação e permitir uma nova escolha.

Os testes de desenvolvimento levaram-nos a reforçar precisamente este comportamento: apresentar a validade, recusar confirmações expiradas e procurar alternativas compatíveis com o pedido original.

A mesma preocupação aparece noutra dimensão da arquitetura: o isolamento entre clínicas.

Num SaaS multi-tenant, separar os dados no armazenamento não resolve, por si só, a segurança. É necessário controlar a autorização nas APIs e nas restantes superfícies por onde circulam dados, incluindo mensagens, ficheiros, operações assíncronas e atualizações em tempo real.

São problemas diferentes, mas partilham uma regra: **uma ação não se torna válida apenas porque o sistema tem capacidade técnica para a executar.**

É preciso verificar quem a pode fazer, com que dados e em que condições.

## Testar o que aconteceu, não apenas o que foi dito

Uma das consequências mais úteis dos problemas encontrados foi a evolução dos testes automatizados do núcleo conversacional.

Quando um chatbot responde de forma diferente da esperada, é tentador avaliar apenas a qualidade da frase.

Mas uma resposta bem escrita pode esconder uma decisão errada.

Por isso, os nossos cenários de regressão verificam o comportamento ao longo da conversa e o estado que dela resulta.

Quando a pessoa pede duas opções, ambas são preservadas ou existe uma pergunta de esclarecimento? Quando reinicia o pedido, o estado anterior desaparece? Quando seleciona um horário, o dia mantém-se? Quando uma proposta expira, continua impossível criar a marcação?

Estas perguntas são mais importantes do que exigir que o chatbot utilize sempre as mesmas palavras.

Na Tredane, registámos cenários automatizados para os problemas identificados na sessão de testes de novembro. As correções correspondentes foram incorporadas no código, e os relatórios do conjunto de testes determinísticos documentam os cenários de regressão resolvidos.

Também começámos a instrumentar a avaliação daquilo que realmente pode prejudicar a experiência: divergência entre pedido e resultado, escolhas perdidas, correções necessárias e passos até à confirmação.

O objetivo é descobrir onde a conversa falha, em vez de produzir apenas uma classificação subjetiva da simpatia da resposta.

Estes testes têm limites conhecidos. Uma execução com dados fictícios, relógio controlado e respostas simuladas não demonstra, por si só, como o sistema se comportará com toda a diversidade de linguagem, interrupções e condições de uma operação real.

A avaliação com o modelo efetivamente no circuito, a simulação de conversas completas e a validação operacional são etapas complementares, com trabalho ainda por concluir.

Mas há uma mudança significativa na forma de desenvolver: uma falha observada deixa de ser apenas uma impressão de que a IA se confundiu. Passa a ser um comportamento que podemos descrever, reproduzir e verificar depois de cada alteração.

## O que fica desta experiência

A Tredane continua em desenvolvimento. Ainda temos decisões de experiência para concretizar, integrações para validar e condições operacionais para testar antes de falar em fiabilidade em produção.

Mesmo assim, o trabalho já trouxe uma aprendizagem importante.

O desafio de construir um chatbot útil não está apenas em fazê-lo compreender linguagem natural. Está em fazer com que essa compreensão sobreviva aos diferentes passos da conversa, às mudanças de contexto, às correções e aos limites do negócio.

Isso exige saber quando interpretar, quando perguntar, quando validar e quando não agir.

Exige também aceitar que, em determinados momentos, um botão, uma regra de domínio ou uma passagem para atendimento humano podem ser escolhas melhores do que mais uma resposta gerada por IA.

**Integrar um LLM, o WhatsApp e uma agenda faz o sistema conversar. Construir o produto começa quando precisamos de garantir que ele não perde o pedido pelo caminho.**

---

## Notas editoriais — não incluir na publicação

- **Confirmado (editorial):** texto aprovado pelo Paulo nesta conversa em 03/11/2026 para atualização do PR #525. Esta atualização não constitui publicação.
- **Confirmado (fontes de produto):** apresentação conforme [MVP](../MVP.md); confirmação conforme DEC-061; núcleo determinístico e LLM assistivo conforme DEC-104; estado partilhado conforme [ADR-0015](../adr/0015-estado-persistente-da-conversa.md); segurança em camadas conforme [ADR-0012](../adr/0012-clinic-durable-object-sqlite.md).
- **Confirmado (material-fonte):** exemplos generalizados da sonda em ambiente de teste e práticas de regressão descritos em [lições de arquitetura](licoes-arquitectura-tredane.md), incluindo #506–#512. Sem detalhes de procedimentos, dados pessoais ou métricas comerciais.
- **Proposto / Em aberto:** Flow é caminho previsto; o desenho detalhado e a implementação seguem [ADR-0016](../adr/0016-whatsapp-flow-agendamento.md) e #514. Grafos de domínio são apresentados como abordagem possível, sem afirmar implementação explícita na Tredane.
- **Proposto (prática geral):** extensão das verificações a ciclos de conversa e handoff; o artigo não declara cobertura completa nem certificação de segurança. Decisões e propostas continuam subordinadas ao MVP, às DECs e aos ADRs.
