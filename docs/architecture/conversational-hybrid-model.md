# Modelo conversacional híbrido — interpretação pela IA, validação pelo backend

**Estado:** arquitetura de referência, 28/10/2026. Documenta o modelo combinado com o Paulo após a contra-análise revista. **Não comprova que o software exista.** Itens marcados **Decidido** vêm de decisão registada; itens **Proposto** são recomendação de engenharia ainda sem decisão; **Em aberto** são valores ou critérios por fixar.

Fontes:

- [DEC-060 — Agendamento pela IA](../product/decisions.md) (Decidido, Paulo, 28/10/2026), registada no [PR #155](https://github.com/intentzero/tredane/pull/155) (`feat/ia-agenda-apos-confirmacao`, ainda não na main), com o texto correspondente em [ux-ui.md §6](../product/ux-ui.md).
- [Contra-análise da arquitetura conversacional e dos modelos](https://tredane-contra-analise-da-arquitetura-xu22.pages.grok.bot/) (revista em 28/10/2026, base main `40af67e` e head do #155 `1a7711a`).
- DEC-006 (IA revista por pessoa; alterada por DEC-060), DEC-011 (dados e IA), [ADR-0004](../adr/0004-ai-human-in-loop.md), [sinal Pix](../product/sinal.md).

## 0. Reconciliação SEG-IA (28/10/2026)

**Direção:** [épico #171](https://github.com/intentzero/tredane/issues/171) (SEG-IA), formalizada em [DEC-061](../product/decisions.md) — **Decidido em 28/10/2026 (Paulo, registo D-20261028-200500-CUR)**. A DEC-060 fica revista: o software não deve marcar por texto livre (S2, #173, com `AI_AUTOBOOK` desligado por padrão).

- **Confirmação por botão:** a marcação automática só acontece com o toque da cliente no botão do WhatsApp de uma proposta montada e versionada pelo backend. Texto livre («sim» ou pedido completo) só interpreta e prepara a proposta.
- **Valores Decididos (Paulo, 28/10/2026):** proposta válida por **30 min**; alerta de comunicação pendente após **5 min**; contenção retirada no piloto após **20 marcações revistas** sem nenhuma indevida.
- **Em aberto (Paulo, S7 #178):** limites de abuso por contato/clínica e janela de quotas.
- **Ordem:** S1 (#172) → S2 (#173) / S3 (#174) / S6 (#177) / S8 (#179) → S4 (#175) → S5 (#176) → S7 (#178) → S9 (#180).
- **Onde entra o trabalho H:** H2 (contexto factual) → S8; H3 (intenções) e H5 (interpretação estruturada) → S6, para decidir *se* e *que* proposta montar, nunca para autorizar; H8 (validação de preços/horários) → S6 e S4 (texto da proposta); H1 → S2/S7; H4 → S3; H6 → S5; H7 → S4; H9/H10 → S9.

As secções abaixo mantêm o modelo de interpretação; onde diferem do botão, vale esta secção.

## 1. Princípio

A IA **interpreta**; o backend **decide**. O modelo devolve uma leitura estruturada da conversa e o código determinístico confere cada campo antes de qualquer efeito. Nenhuma marcação acontece só porque o modelo «acha» que a cliente confirmou; com a DEC-061 (Decidido), nem a interpretação validada marca: só o clique no botão de uma proposta válida.

| Regra | Estado |
| --- | --- |
| A IA cria o compromisso só depois de a própria cliente confirmar dia, horário e procedimento; ambiguidade → pergunta, não marca | **Decidido** (DEC-060) |
| Revalidação na transação pelo mesmo caminho das marcações manuais; actor `system:ai-autobook`; indicador «Marcado pela IA» | **Decidido** (DEC-060) |
| A IA não envia mensagens, não cancela nem remarca | **Decidido** (DEC-060) |
| Interpretação estruturada com origem por campo, validada no backend | **Proposto** (contra-análise) |
| Confiança declarada pelo LLM nunca autoriza ação; serve só para triagem | **Proposto** (contra-análise) |

## 2. Interpretação estruturada (Proposto)

Para cada mensagem nova da cliente, o modelo (ou regras) devolve:

- **intenção**: nova marcação, confirmar presença, agradecimento, remarcar, pergunta (lista fechada; outras → humano);
- **serviço**, **data**, **horário**, **beneficiária** (a própria titular do contacto ou terceiro);
- **proposta ligada** (`proposal_id`), quando a resposta se refere a uma mensagem da clínica;
- **origem** de cada campo: id da mensagem e trecho literal de onde o valor veio;
- **confiança** (opcional), usada apenas para triagem.

### Validação determinística no backend

O backend confere, campo a campo:

1. o trecho citado existe na mensagem indicada e pertence à conversa;
2. o valor normalizado corresponde ao trecho (ex.: «às 3 da tarde» → 15:00, nunca 03:00; «meio-dia» → 12:00);
3. o serviço existe no catálogo da clínica;
4. a proposta ligada pertence à conversa, está vigente e foi efetivamente enviada;
5. não há compromisso do contacto que mude o sentido da mensagem (ver §4);
6. a vaga existe — e é revalidada outra vez dentro da transação (DEC-060).

Falha em qualquer passo → não marca; a sugestão pergunta ou passa a humano.

### Confiança

A confiança declarada pelo modelo **nunca** autoriza ação. Só escolhe entre: perguntar à cliente, passar a humano, ou tentar validar. Um JSON bem formado com confiança alta e trechos que não batem é rejeitado.

## 3. Dois caminhos de confirmação (substituídos pela confirmação por botão — DEC-061, Decidido)

> Com a DEC-061, os caminhos A e B **deixam de autorizar marcação**: ambos só levam o backend a montar uma proposta com botão. A tabela abaixo fica como histórico e como critério para *preparar* a proposta.

| Caminho | Exemplo | Condição para seguir | Estado |
| --- | --- | --- | --- |
| **A. Resposta curta** | «sim», «pode ser», «esse», 👍 | Só vale ligada a uma **proposta identificada, vigente e realmente enviada** (estado de entrega), que é a última pergunta feita e cita um único serviço, dia e horário. Sem isso, não marca. | DEC-060 decide o «sim» a mensagem com um único valor de cada; exigência de proposta identificada/enviada é **Proposto** |
| **B. Pedido completo** | «Quero limpeza de pele amanhã às 15h» | Não precisa de proposta anterior. Exige serviço, data e hora inequívocos no texto da cliente, beneficiária = titular do contacto, nenhum compromisso existente que mude o sentido e serviço sem sinal. | DEC-060 (confirmação no texto dela) + regras de beneficiária **Proposto** |

Vigência da proposta — **Decidido (Paulo, 28/10/2026): 30 minutos** a partir do envio; depois, o botão é recusado e é preciso nova proposta.

## 4. Contexto factual antes de interpretar (Proposto)

Antes de chamar o modelo, montar: compromissos futuros do contacto, propostas vigentes enviadas, data e hora de cada mensagem, catálogo e vagas do período pedido.

Não são marcações novas:

- **lembrete** de compromisso existente respondido com «sim» → confirmar presença;
- **agradecimento** depois de uma confirmação («ok 👍», «obrigada»);
- **pergunta lateral** respondida com «sim» («você já fez o procedimento antes?»);
- **mudança de intenção** («sim, mas na verdade prefiro massagem») → pergunta, não marca;
- **pedido para terceiro** («é pra minha mãe») → não marca no contacto da cliente; passa a humano.

Todos estes casos foram reproduzidos como falhas no fluxo integrado do head do #155 (contra-análise, teste ad hoc com banco de teste e adaptador simulado: 4 de 7 conversas criaram compromissos indevidos).

## 5. Execução e Pix

- Com a DEC-061 (Decidido), a execução parte do **clique autenticado** na proposta válida (S5, #176): mesma operação de confirmação, revalidação na transação, idempotência por proposta/versão.

- Só uma **nova marcação validada** segue para a operação de confirmação existente, com revalidação e idempotência (DEC-060).
- **Serviço com sinal: sem reserva antes do pagamento.** A IA não marca; segue o fluxo Pix atual, e a confirmação depende da disponibilidade no momento do pagamento (DEC-060, sinal Pix já decidido).

## 6. Comunicação pendente (Proposto)

Na DEC-060 a IA marca mas não envia. Com a DEC-061 (Decidido), proposta e resultado saem como mensagens determinísticas do sistema (S4, #175); a comunicação pendente passa a cobrir falha ou atraso desse envio: o compromisso passa a existir enquanto a mensagem «Prontinho… agendei» ainda é rascunho. É preciso acompanhar esse intervalo:

| Situação | Comportamento proposto |
| --- | --- |
| Marcado pela IA, aviso não enviado | Estado «comunicação pendente», visível na agenda e na conversa |
| Aviso não enviado após N minutos | Alerta na fila da equipe após **5 minutos** — **Decidido (Paulo, 28/10/2026)** |
| Sugestão descartada ou editada sem a marcação | Perguntar à atendente se mantém ou cancela o compromisso |
| Falha de envio pelo WhatsApp ou janela de 24 h fechada | Alerta e decisão humana; nada automático |
| Lembretes | Só depois de o aviso de marcação ser enviado |

## 7. Contenção temporária

**DEC-060 é o objetivo.** `AI_AUTOBOOK=off` ou um toque da atendente antes de marcar são **apenas contenção temporária** enquanto os testes obrigatórios (§9) não passam; não substituem a decisão. A saída da contenção segue os critérios de piloto (§9). Número mínimo de marcações revistas no piloto — **Decidido (Paulo, 28/10/2026): 20**, com zero indevidas.

## 8. Modelos (provisório)

- **Claude Haiku** no primeiro rascunho; **Claude Sonnet** na regeneração. **Provisório**, até haver avaliação comparativa (matriz de configurações de thinking/effort e latência, ver épico).
- Erro factual (preço, horário) que passa a validação é defeito do validador, não motivo para trocar de modelo; a troca de modelo só se justifica por qualidade de linguagem.
- Orçamento de latência por etapa e redução do timeout atual de 25 s — **Proposto** na contra-análise, a medir.

## 9. Avaliação e critérios de liberação

| Nível | Critério | Estado |
| --- | --- | --- |
| Regressão (cada PR) | Zero marcações indevidas e zero preços/horários fora do catálogo e das vagas no conjunto fictício | Proposto |
| Validação | Erro factual que passou a validação → corrigir o validador | Proposto |
| Piloto com `AI_AUTOBOOK` ligado | Cada marcação da IA revista pela equipe; zero indevidas em 20 marcações revistas (Decidido, Paulo, 28/10/2026) | Proposto |
| Qualidade do rascunho | Por categoria: correção factual, erros críticos, adequação; taxa sem edição é só sinal | Proposto |
| **Envio automático** | **Não aprovado.** Se um dia for considerado: só por categoria de baixo risco, com correção factual, zero erros críticos, exceções por categoria listadas e decisão explícita do Paulo — **não** apenas «95% sem edição» | Fora do MVP |

Testes obrigatórios antes de religar (conjunto fictício; com a DEC-061 acrescem prompt injection, replay do clique, proposta alterada/expirada e abuso — S6/S5/S7/S9): lembrete de compromisso existente, agradecimento após confirmação, pergunta lateral, mudança de intenção, pedido para terceiro, «às 3 da tarde» e «meio-dia», proposta não entregue ou expirada, pedido completo correto.

**Dados:** as avaliações começam com **conversas fictícias** (cerca de 150, Proposto). Conversas reais só quando o tratamento de dados o permitir (DEC-006, DEC-011).

## 10. Fora do MVP

- Prontuário, anamnese e registo clínico.
- Envio autónomo de mensagens pela IA; cancelamento e remarcação pela IA (DEC-060).

## 11. Plano de implementação

Ver [épico do modelo conversacional híbrido](../implementation/epic-conversational-hybrid-model.md), na ordem de 10 passos da contra-análise.
