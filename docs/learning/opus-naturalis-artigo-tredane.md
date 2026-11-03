# Construir um chatbot: o trabalho que começa depois da integração

*Aprendizagens da Tredane sobre arquitetura híbrida, segurança, testes e uma experiência que respeita o tempo e a intenção de quem conversa.*

Construir chatbots não é tarefa fácil. Ligar um modelo de linguagem à API do WhatsApp e a uma agenda permite começar. A partir daí, surgem as perguntas que determinam se o produto funciona: o sistema compreendeu o pedido completo? Está a usar o contexto certo? A pessoa sabe o que está a confirmar? Consegue corrigir um erro ou sair da conversa sem ficar presa?

É neste contexto que estamos a desenvolver a [Tredane](https://tredane.com), uma plataforma de atendimento e gestão de agendamentos para clínicas de estética. Reúne conversas pelo WhatsApp, organização do atendimento e agenda, com apoio de IA. O objetivo é ajudar as equipas a acompanhar cada pedido até à marcação, mantendo o contexto e o controlo sobre as ações do sistema.

O seu desenvolvimento tem-nos obrigado a trabalhar estas questões em detalhe.

Uma das situações mais reveladoras apareceu num teste pelo WhatsApp. O pedido incluía mais de uma opção, mas o sistema avançou para horários considerando apenas parte da escolha. A interação continuava, embora parte do pedido tivesse desaparecido.

Para quem conversa, receber horários sugere que o pedido foi considerado na íntegra. Essa diferença entre o que a pessoa acredita e o que o sistema registou pode passar despercebida até ao momento do atendimento.

Foi uma aprendizagem importante: precisamos de avaliar cada resposta pelo que preserva do pedido e pelo que permite fazer a seguir.

Uma marcação pode começar numa lista, continuar em texto livre e terminar num botão. Pelo meio, a pessoa pode mudar de ideia, corrigir uma escolha ou regressar mais tarde.

Todos esses caminhos precisam de trabalhar sobre o mesmo registo do pedido: escolhas, horário e informação ainda em falta. Se cada parte da interação mantiver uma interpretação diferente, as contradições acabam por chegar ao utilizador.

Os testes também revelaram problemas com sessões antigas. Uma conversa nova podia herdar escolhas anteriores e saltar diretamente para horários. “Recomeçar” precisava de ter um efeito concreto sobre o estado guardado.

São detalhes técnicos com consequências muito humanas. A pessoa acaba por repetir-se, corrigir o sistema ou tentar perceber por que razão lhe estão a apresentar opções que não pediu.

Um chatbot torna-se um **labirinto de IA** quando exige esforço sem mostrar um caminho claro para resolver o problema.

Isso acontece quando pergunta o que já foi respondido, ignora parte de uma frase, apresenta opções inadequadas ou obriga a começar tudo de novo para corrigir uma única escolha. Uma linguagem simpática pode tornar a interação mais agradável, mas a frustração permanece se a pessoa não consegue avançar.

Na Tredane, estas situações motivaram regras concretas: perguntar apenas pelo que falta, devolver à pessoa o que foi entendido e permitir corrigir a parte certa do pedido.

Também há momentos em que uma escolha estruturada ajuda. Selecionar várias opções num formulário pode ser mais simples do que explicar uma combinação por mensagens sucessivas. O caminho previsto com WhatsApp Flows procura facilitar essa recolha, mantendo as regras e o estado do pedido comuns aos diferentes percursos.

O critério deve ser o esforço necessário para concluir a tarefa. Texto livre, botões e formulários têm papéis diferentes. A interface deve ajudar a pessoa a escolher, compreender e avançar.

Quando é necessário passar o atendimento para uma pessoa, essa passagem deve levar o contexto já recolhido. Pedir ao utilizador que conte tudo outra vez acrescenta uma frustração evitável.

Esta experiência também reforça o valor de uma **arquitetura conversacional híbrida**.

Um modelo de linguagem ajuda a interpretar pedidos expressos de muitas formas. A sua natureza probabilística, porém, exige validação quando uma interpretação pode produzir uma ação concreta. Uma resposta plausível não garante que todas as escolhas foram compreendidas ou que a ação é permitida.

Na Tredane, a abordagem combina interpretação da linguagem, estado estruturado da conversa e regras de negócio. O pedido vai sendo construído e corrigido ao longo da interação. O catálogo, a disponibilidade e a confirmação obedecem a condições verificáveis.

Esta divisão exige decisões explícitas: o que pode o modelo interpretar? Que informação pode preencher? O que precisa de validação? Quando deve o sistema voltar a perguntar?

Perante um pedido parcialmente compreendido, avançar pode parecer eficiente. Mas, se o resultado omitir uma escolha, estamos apenas a adiar o problema. Uma pergunta de esclarecimento bem colocada pode poupar várias correções mais tarde.

A modelação do domínio tem aqui um papel importante. Serviços, opções, recursos e horários relacionam-se entre si e impõem restrições. Compreender essas relações permite determinar que combinações são válidas, que informação falta e quais os próximos passos possíveis.

**Grafos de domínio podem tornar essas relações explícitas**, representando entidades e as ligações entre elas. São uma abordagem útil para pensar este tipo de sistema, embora os mesmos princípios possam ser implementados através de estruturas de dados e regras. No caso da Tredane, a aprendizagem documentada assenta nesse estado estruturado e nessas regras; não pressupõe a existência de um grafo explícito.

Para o utilizador, o benefício esperado é concreto: opções coerentes com o pedido, menos perguntas desnecessárias e caminhos claros para corrigir ou confirmar.

A segurança atravessa toda esta arquitetura.

Começa na proteção dos dados e no controlo de acesso. Num produto utilizado por várias organizações, separar os dados no armazenamento é apenas uma parte do trabalho. As permissões precisam de ser respeitadas nas APIs, nos ficheiros, nas mensagens e nos processos em segundo plano.

Há também uma dimensão de segurança no próprio comportamento da conversa: o que autoriza o sistema a criar uma marcação?

Na Tredane, interpretar uma mensagem pode ajudar a preparar o pedido. A marcação depende de uma confirmação explícita sobre uma proposta cuja versão é controlada pelo sistema.

Essa distinção importa porque um “sim” pode ter vários significados. Pode confirmar uma escolha, responder a uma pergunta ou aceitar um horário. O contexto e o mecanismo de confirmação precisam de tornar esse significado inequívoco.

A validade da proposta também conta. Se a confirmação chega depois de expirar, o sistema deve explicar o que aconteceu e apresentar alternativas. A pessoa precisa de perceber se existe ou não uma marcação.

Estas regras precisam de ser verificadas continuamente. É aqui que os **testes automatizados** ganham importância.

Uma resposta pode parecer adequada isoladamente e, ainda assim, levar o sistema a perder uma escolha ou a reutilizar contexto antigo. Por isso, os testes precisam de acompanhar sequências de interação e verificar o estado e os efeitos produzidos.

Na Tredane, as falhas encontradas nos testes de conversa motivaram cenários de regressão e reforços no núcleo conversacional. Pedidos parcialmente compreendidos, reinício da conversa, identificação de horários e confirmações expiradas passaram a orientar as verificações. O objetivo é detetar se uma alteração volta a introduzir um problema conhecido.

Quando existe um LLM, pode haver várias respostas aceitáveis para a mesma situação. Comparar apenas a frase produzida com uma frase esperada é insuficiente. Precisamos de verificar propriedades do comportamento: todas as escolhas foram preservadas? A ambiguidade levou a um esclarecimento? A correção alterou o campo certo? A ação ficou bloqueada até existir uma confirmação válida?

A formulação pode variar. As condições para executar a ação precisam de continuar a ser respeitadas.

A mesma abordagem deve abranger segurança e experiência do utilizador: verificar limites de acesso aos dados, detetar ciclos de perguntas e avaliar se a passagem para atendimento humano preserva o contexto. Também interessa observar quantas vezes a pessoa teve de corrigir o sistema e quantas interações foram necessárias para concluir a tarefa.

Os testes automatizados complementam a avaliação manual no canal real. Usar o produto pelo WhatsApp permite descobrir dificuldades que os cenários previstos nem sempre captam. Essas descobertas podem, por sua vez, alimentar novos testes.

As situações descritas surgiram num ambiente de teste. São aprendizagens de desenvolvimento, sem pretensão de demonstrar resultados comerciais ou desempenho à escala.

A Tredane continua em construção. Esta experiência tem tornado mais claro o trabalho necessário para criar um chatbot em que as pessoas possam confiar: preservar a intenção, validar as ações, tornar as consequências compreensíveis e oferecer maneiras simples de corrigir, recomeçar ou pedir ajuda.

A integração abre a conversa. A qualidade do produto revela-se no que acontece depois.

---

## Notas editoriais — não incluir na publicação

- **Confirmado (editorial):** texto aprovado pelo Paulo nesta conversa em 03/11/2026 para atualização do PR #525. Esta atualização não constitui publicação.
- **Confirmado (fontes de produto):** apresentação conforme [MVP](../MVP.md); confirmação conforme DEC-061; núcleo determinístico e LLM assistivo conforme DEC-104; estado partilhado conforme [ADR-0015](../adr/0015-estado-persistente-da-conversa.md); segurança em camadas conforme [ADR-0012](../adr/0012-clinic-durable-object-sqlite.md).
- **Confirmado (material-fonte):** exemplos generalizados da sonda em ambiente de teste e práticas de regressão descritos em [lições de arquitetura](licoes-arquitectura-tredane.md), incluindo #506–#512. Sem detalhes de procedimentos, dados pessoais ou métricas comerciais.
- **Proposto / Em aberto:** Flow é caminho previsto; o desenho detalhado e a implementação seguem [ADR-0016](../adr/0016-whatsapp-flow-agendamento.md) e #514. Grafos de domínio são apresentados como abordagem possível, sem afirmar implementação explícita na Tredane.
- **Proposto (prática geral):** extensão das verificações a ciclos de conversa e handoff; o artigo não declara cobertura completa nem certificação de segurança. Decisões e propostas continuam subordinadas ao MVP, às DECs e aos ADRs.
