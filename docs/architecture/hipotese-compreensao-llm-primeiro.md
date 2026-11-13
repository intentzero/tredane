# Hipótese: compreensão por LLM primeiro, política explícita — e o experimento que a testa

**Estado:** **Proposto** (análise de engenharia, 13/11/2026, pedida pelo Paulo: menos carga cognitiva, conversa mais natural, maior taxa de agendamentos concluídos). **Não é decisão de produto** e não altera nenhuma DEC. O que existe de código é só a medição (secção 5). Complementa o [núcleo determinístico](nucleo-deterministico-conversacional.md) e o [modelo híbrido](conversational-hybrid-model.md); não os substitui. Todos os exemplos são fictícios.

**Para quem lê isto:** um agente ou pessoa que vai mexer em `src/clinic/ai/` e precisa de saber o que se está a testar, o que **não** se pode assumir já decidido e como o experimento funciona.

## 1. Resumo

O princípio da arquitetura (a IA interpreta, o backend decide, só o botão marca) está certo e fica. A hipótese é sobre **como o texto livre da cliente é compreendido**:

- Hoje a compreensão é regex e léxico compilado do catálogo. O LLM extrator existe, mas quase não tem efeito.
- Cada formulação nova de uma cliente vira uma correção (ver secção 3).
- A hipótese: inverter a ordem para **LLM primeiro** em todo texto livre, mantendo a validação por ids do catálogo e o eco visível antes de qualquer efeito, deixando o regex como atalho para toques e respostas fechadas.

**Ainda não sabemos se é verdade.** O experimento da secção 5 existe para o medir antes de qualquer decisão.

## 2. Como funciona hoje (verificado no código, 13/11/2026)

1. `interpretTurn` ([`nlu/interpret.ts`](../../src/clinic/ai/nlu/interpret.ts)) lê o turno com regex e léxico e devolve atos, campos e uma `coverage`.
2. `runRestrictedExtractor` ([`llm-extractor.ts`](../../src/clinic/ai/llm-extractor.ts)) só chama o modelo se `needsExtractor` for verdadeiro, e isso exige `!hasSlots`: **se o léxico leu qualquer campo, o modelo não corre**.
3. Quando corre, `validateExtractorOutput` só aceita um campo se estiver **citado literalmente** na frase: nome ou sinónimo do serviço ou da variante, a palavra «manhã/tarde/noite», uma data que o parser determinístico já resolvia, uma hora que o parser já lia.
4. O orquestrador ([`autodraft.ts`](../../src/clinic/ai/autodraft.ts)) só usa `modelCalled` e `applied` do resultado. Os atos devolvidos pelo modelo são descartados.
5. A política do turno vive em `tryAiAutoBook` ([`autobook.ts`](../../src/clinic/ai/autobook.ts), cerca de 3.000 linhas); `runBookingTurn` só delega.

Consequência: «relaxar as costas amanhã» não vira Massagem sem um sinónimo cadastrado; «depois do almoço» não vira tarde. O modelo teria lido ambos, mas o desenho atual não o deixa.

## 3. Evidência do problema

Medida em 13/11/2026 sobre `src/clinic/ai`, `src/whatsapp/flow`, `src/clinic/proposals` e `src/ai`, desde 24/10/2026:

| Medida | Valor |
| --- | --- |
| Commits que tocam estas pastas | 271 |
| Dos quais correções (`fix…`) | 124 |
| Últimos 7 dias: commits / correções | 97 / 59 |

Os títulos das correções são frases individuais («feira typos», «verbos saber/faz», «próxima segunda», «parte da manhã»). O L1 está verde (113/113 na linha de base de 07/11) porque mede o léxico contra frases que a equipe imaginou; as falhas encontradas em amostras reais não aparecem aí. O L2/L3 com modelo real nunca correu (G-03 na [metodologia](../implementation/metodologia-avaliacao-conversacional.md)).

**Limite desta evidência:** contar commits mostra esforço, não prova a causa. A hipótese é plausível, não demonstrada.

## 4. A hipótese em quatro partes

Cada parte é independente e só avança com decisão própria.

| # | Mudança proposta | Decisões que toca | Risco |
| --- | --- | --- | --- |
| H1 | LLM primeiro em todo texto livre; regex só para toques e respostas à pergunta pendente. Validação passa de «citado literalmente» para «o id existe no catálogo e a cliente vê o que foi entendido antes de qualquer efeito». | Revê a leitura de 06/11 da DEC-137 («o extrator só preenche campo vazio com evidência na frase»); toca DEC-104 e DEC-109. | Leitura errada custa um turno de correção, nunca uma marcação: a rede de segurança (DEC-061, validador de saída) não muda. |
| H2 | Política do turno como redutor explícito: comandos → `applyBookingUpdate` → próxima obrigação calculada do quadro, do grafo e da agenda → realização. É terminar a DEC-C4. | DEC-C1, C3, C4 (Propostas em progresso). | Refactor grande de `tryAiAutoBook`; exige testes por propriedade. |
| H3 | Eco só quando há dúvida (leitura não literal). Com hora conhecida, a proposta já mostra tudo e tem «Alterar detalhes». | Revê a DEC-137. | Menos fricção, mas menos correção precoce. |
| H4 | Sinónimos deixam de ser pré-requisito e passam a dicas opcionais; a owner sai da manutenção do léxico. | Toca DEC-110, 141 e 176. | O léxico continua útil como primeira passagem barata. |

O que **não** muda em nenhuma das partes: só o botão Confirmar marca (DEC-061); o LLM não escolhe zona, hora nem marcação (DEC-104, DEC-138); preço e horário vêm do backend e passam pelo validador; o handoff humano (DEC-083, 113, 155).

**Não implementes H1 a H4 como se estivessem decididas.** Mudanças que afetem o que a cliente recebe precisam de DEC do Paulo e, no mesmo PR, de casos L1 (gatilho 8 da metodologia).

## 5. O experimento: sombra do interpretador LLM

**Estado:** código no [PR #733](https://github.com/intentzero/tredane/pull/733). **Desligado por omissão.** Ainda não correu em staging.

### 5.1 O que faz

Com `AI_INTERPRETER_SHADOW=on`, depois de as respostas de um alarme saírem, cada turno de texto livre dispara uma chamada ao extrator, cuja leitura é comparada com a do léxico. O resultado é o evento `ai.interpreter_shadow`. Implementação: [`interpreter-shadow.ts`](../../src/clinic/ai/interpreter-shadow.ts); ligação em `runDueAutoDrafts`.

Garantias, cobertas por teste ([`interpreter-shadow.test.ts`](../../src/clinic/ai/interpreter-shadow.test.ts)):

- não grava o quadro, não envia mensagem, não conta no teto diário da clínica;
- com a flag ligada, respostas, mensagens enviadas, quadro e uso diário são iguais aos da flag desligada;
- reutiliza a saída do extrator quando o caminho real já o chamou no turno, em vez de chamar outra vez;
- falha do provedor ou saída inválida nunca lança;
- o log não leva texto da conversa, nomes, ids de catálogo nem trechos literais.

A validação da leitura do modelo na sombra é **relaxada**: o id tem de existir e estar ativo no catálogo; data e hora têm de resolver no parser. Sem exigir citação literal. É esta a diferença que se quer medir.

### 5.2 O que o evento contém

| Campo | Significado |
| --- | --- |
| `fields` | Por campo (serviço, variantes, linha, profissional, data, período, hora, opção): `agree`, `differ`, `llm_only`, `rule_only` ou `none` |
| `llmOnly`, `differ` | Atalhos: campos só lidos pelo modelo; campos em que as duas leituras se contradizem |
| `strictDiscarded` | O que o validador de citação literal de hoje recusaria |
| `relaxedRejected` | O que nem a validação relaxada aceita (id fora do catálogo, data que não resolve) |
| `ruleCoverage`, `ruleActs`, `llmActs` | Cobertura do léxico e atos lidos por cada lado (só categorias) |
| `mainModelCalled`, `reusedMainCall` | Se o caminho real já tinha chamado o modelo |
| `status` | `ok`, `provider` ou `parse` (falha sem comparação) |
| `model`, `latencyMs`, `inputTokens`, `outputTokens` | Custo e latência da chamada |

### 5.3 Como se corre

1. Merge do PR #733.
2. Em staging: `AI_INTERPRETER_SHADOW=on` e `AI_MODE=gateway` com as chaves do AI Gateway. Sem gateway o adaptador é o simulado e os números não valem.
3. Gerar conversas (ver 5.4).
4. Ler os eventos nos Workers Logs (ainda não há script de agregação; o próximo passo é um, nos moldes de `scripts/flow-funnel.mjs`).
5. Rotular uma amostra à mão: abrir a conversa no painel a partir do `conversationId` e marcar cada divergência como «modelo certo», «léxico certo» ou «ambos errados». O evento diz onde divergem, não quem tem razão.

### 5.3b Reexecução sobre corpus fixo (sem tráfego)

Corpus de 59 frases fictícias com a leitura correta rotulada à mão ([`evals/shadow/corpus.ts`](../../src/clinic/ai/evals/shadow/corpus.ts)), sobre o catálogo de referência e «hoje» = qui 05/11/2026. Compara cinco sistemas contra o rótulo: `rule` (léxico), `today` (o que produção faz), `strict` (léxico + modelo com citação literal), `relaxed` (só modelo, validação por id: H1) e `hybrid` (léxico primeiro, modelo preenche o vazio). Mede frases perfeitas, campos certos, errados, em falta e **inventados**.

```bash
# Sem chaves: valida a tubagem; os números do modelo não valem
EVAL_SHADOW_REPLAY=dry npm run eval:shadow-replay

# Com o modelo real (teto US$ 2; exporta as chaves no terminal, não no chat)
EVAL_SHADOW_REPLAY=live CF_ACCOUNT_ID=… AI_GATEWAY_ID=… AI_GATEWAY_TOKEN=… npm run eval:shadow-replay
```

Escreve `.eval/shadow-replay.md` (relatório) e `.eval/shadow-replay-raw.json` (saída bruta do modelo, para reanalisar sem custo). A coluna `rule` é determinística e já vale sem chaves. Limite: as frases são escritas pela equipe e mais limpas do que as de clientes; os rótulos são meus e podem ter erros, por isso cada divergência deve ser revista antes de tirar conclusões.

#### Primeira leitura (13/11/2026, Haiku 5.5 via AI Gateway, run 43492494643)

**Indicativa, não conclusiva:** 59 frases fictícias escritas pela equipe, rótulos meus ainda não revistos por outra pessoa, um só modelo e uma só corrida.

| Sistema | Frases perfeitas | Campos certos | Errados | Em falta | Inventados |
| --- | --- | --- | --- | --- | --- |
| `rule` / `today` (**`interpretTurn`**, proxy do léxico; ver limite abaixo) | 38/59 (64 %) | 72/95 (76 %) | 3 | 20 | 1 |
| `strict` (léxico + modelo, citação literal) | 42/59 (71 %) | 77/95 (81 %) | 0 | 18 | 1 |
| `relaxed` (só modelo, validação por id: H1) | 54/59 (92 %) | 94/95 (99 %) | 0 | 1 | 4 |
| `hybrid` (léxico primeiro, modelo preenche) | 50/59 (85 %) | 91/95 (96 %) | 3 | 1 | 5 |

O que a medição mostra:

- **O ganho existe e é grande onde se esperava:** frases coloquiais (5 → 10 de 12), erros de escrita (2 → 5 de 5) e respostas à pergunta pendente (4 → 11 de 11). `today` e `rule` coincidem: com o portão atual (`needsExtractor`), o extrator quase nunca corre.
- **A citação literal explica quase tudo o que o modelo perde:** com ela (`strict`) o modelo só acrescenta 4 frases perfeitas; sem ela (`relaxed`), 16.
- **O risco concentra-se num campo:** dos 4 campos inventados pelo modelo, 3 são `line: feminino` sem nenhuma evidência na frase (L11, C05, C08). O validador de hoje apanha-os porque exige a palavra «feminina». O contacto não tem sexo (DEC-079): a linha tem de continuar a exigir evidência literal mesmo que o resto passe a ser validado só por id. O quarto é `period` deduzido de «14h» (H08), discutível como erro.
- **`hybrid` é pior do que `relaxed`:** quando o léxico lê e erra (por exemplo «axila e pernas» a incluir a axila masculina), o modelo não corrige porque só preenche campos vazios. Dar prioridade ao léxico traz de volta os seus erros.
- **O `interpretTurn` tem defeitos próprios** (não necessariamente o funil real; ver limite abaixo): «a segunda opção» lido também como segunda-feira (P07), «massagem relaxante» sem serviço (L02), «sobrancelha» sem «Design de sobrancelha» (C02, C10, T04).
- **Custo e latência baixos:** 59 chamadas, 38,5 mil tokens de entrada e 6,9 mil de saída, cerca de US$ 0,007 (≈ US$ 0,00012 por turno); latência p50 1,2 s e p95 1,8 s.

**Limite importante (correção de 13/11/2026):** a coluna `rule`/`today` mede o `interpretTurn`, que só é chamado pelo portão do extrator ([`llm-extractor.ts`](../../src/clinic/ai/llm-extractor.ts)) e pela sombra. O funil que decide a conversa em produção usa outras funções do [`autobook.ts`](../../src/clinic/ai/autobook.ts) (`extractServices`, `zonesNamedInText`, `extractDates`, `extractTimes`), com regras próprias. Por isso **«64 % hoje» não é a taxa do funil real**; é a de um léxico parecido. A comparação válida entre o modelo e o funil real ainda não foi feita (ver «Em aberto»). O que a medição sustenta sem esta ressalva é só: o modelo, validado por id, lê bem este corpus e o seu custo é baixo.

Leitura para decidir (Proposto): H1 ganha força, mas a forma que a medição sustenta é «modelo primeiro, com validação por id e **evidência literal obrigatória só para a linha**», não a validação relaxada sem exceções. Antes de decidir faltam: medir o funil real (frame depois de um turno no harness L1) contra o mesmo corpus; rever os rótulos com outra pessoa; repetir com frases de pessoas de fora (DEC-143) e com o modelo de produção; medir variância (a corrida foi única, sem `pass^k`); e testar o mesmo corpus depois de corrigir os defeitos do léxico, para separar o ganho do modelo do ganho de consertar o léxico.

**Configuração da chave:** o gateway só encontrou a chave guardada depois de o adaptador enviar `cf-aig-byok-alias` (variável opcional `AI_GATEWAY_BYOK_ALIAS`; sem ela nada muda). Sem esse cabeçalho o gateway procura o alias `default` e responde com o erro 2044.

### 5.4 De onde vêm as conversas

O tráfego do staging é da equipe e escreve como o léxico espera, por isso **subestima** o ganho. Por ordem de esforço:

- teste com 8 a 10 pessoas de fora, já planeado na [DEC-143](../implementation/dec143-teste-com-pessoas.md) (basta ter a sombra ligada);
- clientes simuladas do L3 (volume e variedade, mas proxy);
- clínica piloto (a fonte que conta, mas exige decisão do Paulo sobre enviar todos os turnos de texto ao modelo com dados reais; GATE-04/06);
- **Em aberto:** reexecutar a comparação sobre um corpus fixo, por exemplo as amostras da fila de revisão (DEC-159), sem esperar por tráfego. Exige um script que ainda não existe.

### 5.5 Critério de leitura (Proposto)

Com amostras pequenas a leitura é qualitativa. Ponto de partida para discutir, não limiar aprovado:

- a grande maioria dos `llm_only` está certa (9 em 10 como referência);
- nos `differ`, o modelo acerta pelo menos tantas vezes quanto o léxico;
- os `rule_only` são raros, ou o léxico fica como primeira passagem para os cobrir;
- a latência p95 cabe no debounce atual.

Se os `llm_only` forem poucos, a hipótese H1 cai e o problema está noutro sítio, provavelmente na política do turno (H2).

### 5.6 Custo e dados

- Uma chamada Haiku extra por turno de texto livre, com timeout de 8 s, fora do teto diário da clínica.
- O contexto enviado é o da DEC-109 (turno, pergunta pendente, nomes do catálogo), mas passa a ir em **todos** os turnos de texto. Em staging com dados de teste não levanta questão; com dados reais é decisão do Paulo.

## 6. Propostas funcionais associadas (fora do experimento)

Resultam da mesma análise. Nenhuma está decidida nem implementada.

| Proposta | Estado |
| --- | --- |
| Confirmar dentro do Flow (ecrã final de resumo com botão autenticado e versionado). Mede-se primeiro a queda entre Flow concluído e Confirmar. | Proposto; revê a letra da DEC-061 e da DEC-138 |
| Reserva curta da vaga durante a proposta, em serviços sem sinal | Proposto; decisão nova |
| Áudio transcrito com eco obrigatório | Proposto; revê DEC-067 e DEC-011 |
| Latência: debounce de texto aberto menor com reinterpretação; timeout do extrator menor | Proposto; revê DEC-111 |
| Cliente recorrente («o mesmo da última vez?») | Proposto; toca DEC-079 |
| Lembrete com Confirmar e Remarcar | Proposto; não encontrei lembretes no código |

## 7. Decisões e passos em aberto

| Pergunta | Responsável | Bloqueia |
| --- | --- | --- |
| Ligar a sombra em staging e com que modelo/chaves | Paulo + engenharia | Qualquer número |
| Enviar todos os turnos de texto ao modelo com dados reais | Paulo + jurídico (GATE-04/06) | Medição na clínica piloto |
| Script de agregação dos eventos | Engenharia | Leitura eficiente |
| Quem rotula a amostra | Paulo ou delegado | Critério da secção 5.5 |
| Aprovar H1 (e rever a DEC-137) depois de ver os números | Paulo | Qualquer mudança no que a cliente recebe |

Quando houver decisão, atualizar primeiro [`decisions.md`](../product/decisions.md), depois este documento e os documentos que o apontam; resumir em [`MVP.md`](../MVP.md) só se o recorte mudar.

## 8. Fontes

- Código: [`nlu/interpret.ts`](../../src/clinic/ai/nlu/interpret.ts), [`llm-extractor.ts`](../../src/clinic/ai/llm-extractor.ts), [`interpreter-shadow.ts`](../../src/clinic/ai/interpreter-shadow.ts), [`autodraft.ts`](../../src/clinic/ai/autodraft.ts), [`autobook.ts`](../../src/clinic/ai/autobook.ts).
- Documentos: [núcleo determinístico](nucleo-deterministico-conversacional.md), [modelo híbrido](conversational-hybrid-model.md), [avaliação contínua](avaliacao-continua-conversacional.md), [metodologia de avaliação](../implementation/metodologia-avaliacao-conversacional.md), [teste com pessoas (DEC-143)](../implementation/dec143-teste-com-pessoas.md), [ADR-0015](../adr/0015-estado-persistente-da-conversa.md), [ADR-0016](../adr/0016-whatsapp-flow-agendamento.md).
- Prática externa que motivou a hipótese: orquestração em que o LLM produz comandos e a lógica de negócio é determinística (por exemplo, o modelo de «comandos» do Rasa CALM); avaliação pelo estado final, não pelo texto (τ-bench), já citada na metodologia. Não fiz pesquisa nova para este documento.
