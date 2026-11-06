# DEC-143 — teste curto com 8 a 10 pessoas de fora da equipa

**Estado:** **Proposto** (agente, 06/11/2026; o Paulo escolheu fazer este teste na sessão de 06/11/2026). Não é decisão de produto: serve para alimentar a [DEC-143](../product/decisions.md), que continua **Em aberto**. Os limiares da secção 6 são **Propostos**.

## 1. Objetivo

O staging mede se a instrumentação funciona, não como as clientes se comportam. Este teste dá os primeiros números de comportamento, com pouca amostra, para responder a três perguntas da DEC-143:

- **(a)** Quando a pessoa quer marcar, escreve as zonas em texto ou carrega no Flow?
- **(b)** Quando o Flow é enviado, abre-o e chega ao fim?
- **(c)** Quantas vezes o Flow não sai e o chat volta às listas?

Oito a dez pessoas não dão significância estatística. Servem para ver se o padrão é óbvio e onde as pessoas desistem.

## 2. Pré-requisitos

- **Cumprido (06/11/2026):** no staging estão publicados o Flow depois do HUB (#587), as zonas escritas antes da linha (#589) e o campo `zonesAskedBefore` (#588), commit `9b456b8`. Antes de cada ronda, confirmar que o staging corre um commit que os contém.
- `wrangler tail` do staging a gravar para ficheiro durante todas as sessões; `node scripts/flow-funnel.mjs staging <tenantId> <data do teste>` antes e depois.
- Clínica de teste do staging, com Depilação (zonas por género) e **um serviço sem variantes**. A Massagem do staging tem 4 tipos (sonda de 05/11), por isso **não** serve para a tarefa C: criar ou confirmar no painel um serviço sem variantes antes do teste. Nenhum dado real de clínica.
- **A verificar (pode bloquear):** o Flow mostra «Gerenciada por Test Number», ou seja, o staging usa um número de teste da Meta. Esses números podem limitar quantos telefones conseguem conversar com ele. Confirmar na documentação da Meta e com um segundo telefone antes de convidar 8 a 10 pessoas; se o limite for menor, fazer rondas pequenas ou usar um número com a clínica de teste ligada de forma normal.

## 3. Quem e como

- 8 a 10 pessoas que **não** conheçam o desenho do Flow nem o Tredane (fora da equipa), pelo telemóvel delas, no WhatsApp.
- Cada pessoa faz **duas tarefas** numa sessão de cerca de 10 minutos, com um observador (pessoa ou o Paulo) que não ajuda e só anota.
- A instrução é a mesma para todas e não menciona «Flow», «opções» nem botões: «Escreve para este número como se quisesses marcar [tarefa]. Faz como faria no dia a dia.»
- Duas tarefas por pessoa, com a ordem alternada para não enviesar:

| Tarefa (cenário fictício) | O que mostra |
| --- | --- |
| A. «Marcar uma depilação para sexta à tarde, nas zonas que quiseres» | Se a pessoa nomeia as zonas na primeira mensagem. Não ditar as zonas: o texto da tarefa não pode pôr as palavras na boca da pessoa. |
| B. «Marcar um serviço sem variantes para amanhã» (o serviço sem variantes da secção 2) | O Flow ainda pesa quando não há zonas? |

- Metade das pessoas faz A e depois B, a outra metade B e depois A.
- A correção a meio («mudar de axila para pernas») fica fora desta ronda: não alimenta nenhuma das três medidas.
- Se a pessoa escolher zonas à mão e o observador as ditasse, a medida (a) deixava de valer. O observador lê a tarefa como está escrita e não explica mais.

## 4. O que registar

Por pessoa, numa folha simples (sem nome, só P1 a P10):

- Primeira mensagem: escreveu a zona ou só o serviço?
- Quando o bot enviou o Flow: abriu? concluiu? voltou ao texto? Quanto tempo demorou?
- Pontos em que parou, hesitou ou perguntou ao observador.
- Chegou a uma proposta? Carregou em Confirmar? **Em aberto (Paulo):** deixar confirmar (mede o fim do funil; cancelar a marcação de teste no painel no fim de cada sessão) ou pedir para parar na proposta (menos ruído na agenda, mas corta a medida de conclusão).
- Frase livre no fim: «O que achou mais fácil?» e «O que atrapalhou?».

## 5. Como se leem os números

| Medida | Fonte | Leitura |
| --- | --- | --- |
| (a) | Workers Logs / tail: `ai.turn_decided` | `variantsChanged = true` e `zonesAskedBefore = false` = zonas escritas sem lhas pedirem. `zonesAskedBefore = true` = resposta à pergunta das zonas. |
| (b) | `scripts/flow-funnel.mjs` | enviados, abertos (`opened_at`), concluídos, substituídos, expirados, só dos tokens criados na janela do teste |
| (c) | Workers Logs: `whatsapp_flow.offer_skipped` (`reason`) e `whatsapp_flow.offer_failed` | quantas vezes o Flow não saiu e porquê |

Complementar sempre com as notas do observador (secção 4): os números dizem quanto, as notas dizem porquê.

**Atribuir a cada pessoa:** o script do funil conta todos os tokens da janela, não por pessoa. Anotar a hora de início e de fim de cada sessão e ler os logs e os tokens dentro dessa janela (cada pessoa conversa de um número diferente, logo de uma conversa diferente). Se isto for penoso com 8 a 10 pessoas, acrescentar ao script um filtro por conversa.

## 6. Como decidir (Proposto)

Limiares numéricos **Propostos** (n = 8 a 10 pessoas, tarefa A), só para discutir; com esta amostra um ponto percentual não quer dizer nada:

| Resultado | Leitura |
| --- | --- |
| Pelo menos 7 em 10 que receberam o Flow abriram-no **e** o concluíram; no máximo 3 em 10 nomearam as zonas na primeira mensagem | Apoia a DEC-143: o Flow é o caminho natural e o texto livre pouco escolhe |
| 5 ou mais em 10 nomearam as zonas na primeira mensagem **e** abandonaram o Flow quando o receberam | Contra a DEC-143: perder o texto livre como escolha perde quem já disse o que queria |
| O Flow não saiu ou não abriu para 3 ou mais pessoas (secção 5, medida c) | A proposta fica sem base: depende de o Flow ser fiável. Resolver isso primeiro |
| Qualquer outra combinação | Sem decisão; repetir com mais gente ou outra fonte |

Isto não promove a DEC-143 sozinho: precisa também da contagem da clínica piloto quando houver política de dados. A decisão é do Paulo. Até lá, a DEC-137 e a DEC-138 continuam a valer.

## 7. Dados pessoais (Em aberto)

As pessoas escrevem do próprio número de WhatsApp, que fica guardado no staging como contacto. Antes de convidar alguém é preciso decidir (Paulo):

- **Consentimento:** aviso curto de que é um teste, que a conversa fica registada e para que serve.
- **Alternativa:** pedir a cada participante que use um número de teste fornecido pela equipa, em vez do pessoal.
- **Retenção e exclusão:** apagar contactos e conversas do teste do staging no fim (prazo a definir) e não guardar prints com números.
- **Conteúdo:** as tarefas são fictícias; pedir que não escrevam dados reais (nome completo, doenças, fotografias).

Sem estas respostas, não convidar ninguém. Nenhum dado real de clínica nem de clientes de clínica entra neste teste.

## 8. Limites

- Amostra pequena e de conhecidos: pode enviesar para quem já usa WhatsApp Flows e para quem quer agradar.
- O staging usa o WABA de teste: a latência e o comportamento do Flow podem diferir da clínica piloto.
- Não substitui a contagem de pedidos reais da clínica piloto, que fica como segunda fonte quando houver política de dados.
