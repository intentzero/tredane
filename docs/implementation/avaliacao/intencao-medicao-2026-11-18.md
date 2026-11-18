# Medição da deteção de intenção (18/11/2026)

**Estado:** **Proposto** (plano de 18/11/2026; DEC-202). Mede se vale acrescentar um classificador LLM (ou busca semântica) ao léxico que encaminha o chat para a página. Não decide nada sozinho.

## Como se mede

- **Corpus:** `src/clinic/ai/evals/intent/corpus.ts`, 160 frases fictícias rotuladas (`agendar`, `remarcar`, `cancelar`, `misto`, `nenhum`). Inclui paráfrases, erros de escrita, gíria, pedidos indiretos, informação que **não** deve virar link e ruído. É um corpus de **casos difíceis**, escrito por engenharia: os números abaixo são um piso pessimista, não a taxa real.
- **Léxico:** `npx vitest run src/clinic/ai/evals/intent/intent.eval.test.ts` imprime precisão e recall por classe e a lista de falhas. Corre no CI sem custo; não é gate.
- **LLM:** `EVAL_INTENT_LLM=live npm run eval:intent` (precisa de `CF_ACCOUNT_ID`, `AI_GATEWAY_ID`, `AI_GATEWAY_TOKEN`), ou o workflow manual «Avaliação de intenção (LLM)» (`.github/workflows/eval-intent.yml`, environment `staging`, relatório no resumo do job). Corre o classificador (`llm-classifier.ts`, ferramenta de saída fechada, Haiku) **só** nas frases que o léxico não decide, com teto de US$ 2. Sem segredos não gasta nada.

## Resultado do léxico (corpus de 160 frases)

| Classe | Precisão | Recall |
| --- | --- | --- |
| agendar | 95 % | 74 % |
| remarcar | 100 % | 50 % |
| cancelar | 100 % | 69 % |
| misto | 100 % | 100 % |
| nenhum (informação e ruído) | 69 % | 100 % |

- «Há intenção de agenda» apanhada: **73 %** (74/101). Informação tratada como agenda: **0 %**. Serviço pré-escolhido certo: **100 %** (50/50).
- O léxico **não se engana** a mandar o link (precisão alta, zero falsos em informação) mas **perde** paráfrases: «tem horário?» sem verbo, «me encaixa na sexta», «preciso mudar meu dia», «não vou poder ir», «vou viajar e não vou conseguir ir», e erros de escrita fortes («tem vga amanha?»).
- Correções léxicas feitas com esta medição: o sinal de informação passou a ignorar acentos («Quanto é…» já conta) e perguntas de custo sobre remarcar/cancelar («se eu remarcar, cobram?») deixaram de ser pedidos.

## Leitura

- A assimetria favorece o LLM como **segunda tentativa**: o léxico quase não erra para o lado do falso link, e perde 27 % das paráfrases difíceis. Falta saber o que o LLM recupera e a que custo.
- **Não medido ainda:** o LLM (sem segredos nesta sessão) e a amostra real de staging (precisa do acesso do Paulo ao Review MCP ou ao laboratório). Critério **Proposto** para levar um candidato a produção: recall de «há intenção de agenda» abaixo de 90 % no léxico, recall combinado ≥ 95 %, informação classificada como agenda ≤ 5 %, e zero casos de segurança alterados.
- **Busca semântica:** não entra na deteção de intenção (recomendação, **Proposto**); o LLM já é chamado nesses turnos.
