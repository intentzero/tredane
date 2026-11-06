# DEC-143 — teste curto com 8 a 10 pessoas de fora da equipa

**Estado:** **Proposto** (agente, 06/11/2026; o Paulo escolheu fazer este teste na sessão de 06/11/2026). Não é decisão de produto: serve para alimentar a [DEC-143](../product/decisions.md), que continua **Em aberto**. Os limiares da secção 6 são **Propostos**.

## 1. Objetivo

O staging mede se a instrumentação funciona, não como as clientes se comportam. Este teste dá os primeiros números de comportamento, com pouca amostra, para responder a três perguntas da DEC-143:

- **(a)** Quando a pessoa quer marcar, escreve as zonas em texto ou carrega no Flow?
- **(b)** Quando o Flow é enviado, abre-o e chega ao fim?
- **(c)** Quantas vezes o Flow não sai e o chat volta às listas?

Oito a dez pessoas não dão significância estatística. Servem para ver se o padrão é óbvio e onde as pessoas desistem.

## 2. Pré-requisitos

- No staging: PR do Flow depois do HUB (#587, publicado), PR das zonas antes da linha (#589) e PR do campo `zonesAskedBefore` (#588), todos integrados e publicados. Sem eles os números (a) não se leem bem.
- `wrangler tail` do staging a gravar para ficheiro durante todas as sessões; `node scripts/flow-funnel.mjs staging <tenantId> <data do teste>` antes e depois.
- Clínica de teste do staging, com Depilação (zonas por género) e um serviço sem zonas. Nenhum dado real de clínica.

## 3. Quem e como

- 8 a 10 pessoas que **não** conheçam o desenho do Flow nem o Tredane (fora da equipa), pelo telemóvel delas, no WhatsApp.
- Cada pessoa faz uma sessão de cerca de 10 minutos, com um observador (pessoa ou o Paulo) que não ajuda e só anota.
- A instrução é a mesma para todas e não menciona «Flow», «opções» nem botões: «Escreve para este número como se quisesses marcar [tarefa]. Faz como faria no dia a dia.»
- Alternar a tarefa entre as pessoas, para a ordem não enviesar:

| Tarefa (cenário fictício) | O que mostra |
| --- | --- |
| A. «Marcar depilação de axila e pernas para sexta à tarde» | Zonas no texto logo na primeira mensagem |
| B. «Marcar uma depilação» (sem dizer o que, nem zonas) | Se a pessoa usa o Flow ou o texto quando o bot pergunta |
| C. «Marcar uma massagem para amanhã» | Serviço sem zonas: o Flow ainda pesa? |
| D. «Marcar depilação de axila, depois mudar para pernas» | Correção a meio |

- Metade das pessoas começa pela tarefa A, a outra metade pela B.

## 4. O que registar

Por pessoa, numa folha simples (sem nome, só P1 a P10):

- Primeira mensagem: escreveu a zona ou só o serviço?
- Quando o bot enviou o Flow: abriu? concluiu? voltou ao texto? Quanto tempo demorou?
- Pontos em que parou, hesitou ou perguntou ao observador.
- Chegou a uma proposta? Carregou em Confirmar? **Não** confirmar de propósito: cancelar a marcação de teste no painel no fim de cada sessão.
- Frase livre no fim: «O que achou mais fácil?» e «O que atrapalhou?».

## 5. Como se leem os números

| Medida | Fonte | Leitura |
| --- | --- | --- |
| (a) | Workers Logs / tail: `ai.turn_decided` | `variantsChanged = true` e `zonesAskedBefore = false` = zonas escritas sem lhas pedirem. `zonesAskedBefore = true` = resposta à pergunta das zonas. |
| (b) | `scripts/flow-funnel.mjs` | enviados, abertos (`opened_at`), concluídos, substituídos, expirados, só dos tokens criados na janela do teste |
| (c) | Workers Logs: `whatsapp_flow.offer_skipped` (`reason`) e `whatsapp_flow.offer_failed` | quantas vezes o Flow não saiu e porquê |

Complementar sempre com as notas do observador (secção 4): os números dizem quanto, as notas dizem porquê.

## 6. Como decidir (Proposto)

Limiares sugeridos para discutir, não para aplicar sozinhos:

- Se a maioria das pessoas que receberam o Flow o abriu e concluiu, e poucas escreveram zonas sem lhas pedirem, a proposta da DEC-143 (texto livre só pré-preenche) ganha apoio.
- Se muitas escreveram as zonas na primeira mensagem e abandonaram o Flow quando já tinham dito o que queriam, manter o texto livre como caminho de escolha custa menos do que perdê-las.
- Se o Flow falha ou não abre com frequência, a proposta perde força, porque depende de o Flow ser o caminho fiável.

A decisão é do Paulo. Até lá, a DEC-137 e a DEC-138 continuam a valer.

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
