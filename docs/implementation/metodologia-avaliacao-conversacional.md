# Metodologia de teste e avaliação da interface conversacional

**Estado:** **Confirmado** como referência do projeto pela **DEC-139** (Paulo, 05/11/2026). Os limiares numéricos continuam **Em aberto** até haver duas linhas de base. Pedido do Paulo em 05/11/2026: metodologia eficiente e eficaz, com KPIs que acompanhem e assinalem progressões e regressões, mantida durante todo o ciclo de vida do projeto. Este documento é o **guarda-chuva** e não substitui os que já existem. Ele diz *como* medir, *quando*, *o que conta como regressão* e *como a própria metodologia evolui*. O detalhe continua nos documentos de origem:

| Documento | Papel | Estado |
| --- | --- | --- |
| [Plano de testes](plano-testes-conversacional.md) | Invariantes INV-01..11, métricas EF/EE/ES/Q, níveis L0–L5, achados CF/CA e registo de iterações | Proposto; gate de INV **Confirmado** (DEC-108) |
| [Matriz de diálogos](matriz-dialogos-conversacional.md) | Casos com ID estável, resultado esperado, turnos ideais | Viva |
| [Avaliação contínua](../architecture/avaliacao-continua-conversacional.md) | KPIs de produção (L5), episódio, eventos e ciclo autónomo | Direção **Confirmada** (DEC-084); KPIs Propostos |
| [README L2/L3](../../src/clinic/ai/evals/l2/README.md) | Harness com LLM, juiz, tetos de custo | Tetos **Confirmados** (DEC-117, DEC-126) |

As decisões **Confirmadas** citadas valem como estão. O catálogo de KPIs em camadas, as regras de comparação, a cadência, a análise de erros e os gatilhos de revisão estão **Confirmados** (DEC-139). Os valores numéricos de tolerância e os limiares de latência e custo continuam **Em aberto**.

## 1. Diagnóstico em 05/11/2026

O projeto já tem uma base acima da média: invariantes binárias que bloqueiam o merge (DEC-108), uma matriz com IDs estáveis, harness L1 determinístico (`npm run test:dialogs`: **100 testes verdes** em 05/11/2026, `main` `b92b134`), harness L2/L3 em dry-run (15 testes verdes) com tetos de custo, juiz Q1–Q6 com abstenção, conjunto reservado de cerca de 20 %, métricas de estrago (ES-01..04) e o evento `ai.turn_decided` sem texto da conversa.

O que falta é sobretudo **medir ao longo do tempo** e **cobrir o caminho que mudou**. As lacunas, com a evidência:

| ID | Lacuna | Evidência | Efeito |
| --- | --- | --- | --- |
| G-01 | **Nenhum registo de KPIs por corrida, nem comparação automática com uma linha de base.** O §7 do plano é escrito à mão. | O último registo do §7 é a It. 4.5c, de 03/11. Desde então entraram **82 commits na `main`, 34 com «fix» no título**, sem iteração registada. | Uma regressão de eficiência (mais turnos, mais perguntas por mensagem, proposta diferente do pedido) passa despercebida enquanto as invariantes continuarem verdes. |
| G-02 | **O caminho principal atual não tinha diálogo L1.** **Coberto a 05/11/2026** pela família FL- (15 casos; ver a [matriz](matriz-dialogos-conversacional.md)). A DEC-138 tornou o WhatsApp Flow e o hub o caminho principal. | `p0-cases.ts` não tem nenhum caso Flow/hub/nfm. **43 dos 82 commits** desde 03/11 mexem em Flow, hub ou C16. O Flow tem 8 ficheiros de teste unitário, mas nenhum diálogo ponta a ponta. | Os defeitos do caminho principal são encontrados por sonda manual (L4) em vez do CI. |
| G-03 | **O L2/L3 com o modelo real nunca correu.** | Live bloqueado sem `AI_GATEWAY_*` desde 02/11 (It. 4.4). O dry-run usa o `SimulatedAiAdapter`. | Não há medida da variância do LLM, de latência ou de custo reais. O juiz continua sem calibração (κ **Em aberto**, #402). |
| G-04 | **Nenhuma medida de consistência.** O L2 reporta `passRate` por repetição, mas não se *todas* as repetições passam. | `runner.ts` antes desta proposta. | Um caso que passa 2 em 3 vezes parece «67 % bom», quando para a cliente é imprevisível. |
| G-05 | **Fugas não contadas.** Não há registo de qual defeito foi apanhado em L4/L5 sem ter sido apanhado em L0–L3. | As sondas de 30/10, 31/10 e 03/11 originaram CF-23..34, mas a origem de cada correção desde 03/11 não está registada. | Não se sabe se a metodologia está a ficar mais eficaz. |
| G-06 | **Sem amostras de conversa real em revisão.** | GATE-04/06 (dados reais) ainda abertos; correto que assim seja. | O corpus reflete o que a equipa imagina, não o que as clientes escrevem. Depende de decisão jurídica, não de engenharia. |
| G-07 | **Métrica de estrago com leituras enganadoras.** | Na primeira corrida do scorecard, A-15/A-16 apareciam com «zonas 0/2» quando o diálogo termina no eco, antes de haver proposta (corrigido: sem proposta, a razão é nula). A-18 declara o pedido 15:00 e a última proposta **não** bate, mas o caso passa. | Por triar: ou a declaração `damage` do A-18 está desatualizada, ou é estrago real que as expectativas não apanham. |
| G-08 | **As invariantes nunca tinham visto um Confirmar válido.** | A INV-01 era «zero compromissos». Nenhum caso L1 fazia uma marcação completa, por isso uma marcação dupla não seria apanhada. A INV-03 e a INV-08 davam falso positivo no hub. | **Corrigido** com a família FL- (plano de testes §5). Lição: um caminho novo exige rever as invariantes, não só acrescentar casos. |

## 2. Base no estado da arte

Práticas consolidadas em 2025–2026 para agentes conversacionais orientados a tarefa, e como se aplicam aqui:

| Prática | Fonte | Aplicação no Tredane |
| --- | --- | --- |
| Avaliar pelo **estado final** (BD), não pelo texto | τ-bench ([Yao et al., ICLR 2025](https://arxiv.org/abs/2406.12045)) | Já feito: INV-01 e ES-01 leem compromissos e propostas na BD. |
| **pass^k**: o caso só conta se passar nas *k* repetições | τ-bench; agentes de topo caem para pass^8 < 25 % no retalho | **Novo:** `passHatN` no relatório L2 (`scorecard/stats.ts`). Com N = 3, pass^3 passa a KPI de consistência. |
| Separar suíte de **regressão** (deve estar ~100 %) de suíte de **capacidade** (mede o que ainda falha) | [Anthropic, «Demystifying evals for AI agents»](https://anthropic.com/engineering/demystifying-evals-for-ai-agents) | L1 P0 = regressão (gate). `knownFailure`, `pendingHarness` e L3 = capacidade. Um caso de capacidade estável «gradua» para regressão. |
| Três tipos de avaliador: **código**, **modelo**, **humano**, e o juiz calibrado contra pessoas | Anthropic (idem); [Husain, error analysis](https://hamel.dev/blog/posts/evals-faq/why-is-error-analysis-so-important-in-llm-evals-and-how-is-it-performed.html) | INV = código. Q1–Q6 = juiz. Calibração humana = #402. O juiz nunca decide preço, agenda nem autorização. |
| **Análise de erros primeiro**: ler traços, *open coding* → *axial coding* → taxonomia, até saturação | Husain & Shankar | Classes de causa do plano §6 (`catalogo`, `interpretacao`, `estado`, …) são a taxonomia axial. Falta o ritual regular de leitura (§7 abaixo). |
| **Barras de erro** e comparação **emparelhada** por caso; com poucas centenas de casos o CLT subestima a incerteza | [Miller 2024](https://arxiv.org/abs/2411.00640); [Bowyer et al. 2025](https://arxiv.org/abs/2503.01747) | **Novo:** IC de Wilson no L2. A comparação com a linha de base é feita caso a caso (emparelhada), não só por média. |
| Corrigir a taxa do juiz pela sensibilidade e especificidade medidas (Rogan-Gladen); juízes tendem a TPR alto e TNR baixo | [«How to Correctly Report LLM-as-a-Judge Evaluations», 2025](https://arxiv.org/abs/2510.11822) | **Novo:** `correctJudgeRate` disponível para quando a #402 medir TPR/TNR. |
| Cliente simulada como *proxy*, validada contra pessoas; tem viés conhecido | [SimulatorArena, EMNLP 2025](https://arxiv.org/abs/2510.05444); [τ²-bench](https://arxiv.org/abs/2506.07982) | L3 (personas P-01..10) serve para **descobrir** falhas que viram casos L1, não como métrica de sucesso absoluta. |
| Monitorização contínua pós-implantação | [NIST AI RMF MEASURE 2.4](https://airc.nist.gov/airmf-resources/playbook/measure/) (já citado na avaliação contínua) | L5 sobre `ai.turn_decided` e eventos de episódio. |

## 3. Princípios (Proposto)

1. **Sem score único.** Uma invariante falhada nunca é compensada por outra métrica (plano §1; DEC-108).
2. **Toda corrida produz um artefacto comparável.** Um número que não fica gravado com versão não existe para a tendência.
3. **Comparar sempre com a linha de base, caso a caso.** A média esconde trocas (um caso melhora, outro piora).
4. **O caminho que a cliente mais usa tem de ter mais cobertura.** A cobertura acompanha a DEC vigente, não o histórico.
5. **Cada fuga vira um caso antes da correção** (teste primeiro, plano §6.5). Os casos nunca se apagam.
6. **O barato corre sempre, o caro corre por amostragem.** L0/L1 em cada PR; L2/L3 por iteração e com teto; L4 por liberação.
7. **A metodologia também é medida** (§5.4) e revista quando os seus KPIs pioram.

## 4. Arquitetura de medição

| Nível | Suíte | Avaliador | Artefacto gravado | Quando |
| --- | --- | --- | --- | --- |
| L0 Unitário | Regressão | Código | Resultado vitest | Cada PR (`npm test`) |
| L1 Diálogo determinístico | **Regressão** (P0) + capacidade (`knownFailure`, `pending`) | Código (INV + expect + estrago) | **`.eval/l1-latest.json`**; linha de base em [`avaliacao/l1-baseline.json`](avaliacao/l1-baseline.json); histórico em [`avaliacao/l1-history.jsonl`](avaliacao/l1-history.jsonl) | Cada PR (gate INV); scorecard em cada PR conversacional |
| L2 LLM no circuito | Regressão + consistência | Código + juiz (Q) | Relatório L2 com pass^N, IC95, custo, hashes | Cada iteração; após mudar modelo, prompt ou extrator |
| L3 Cliente simulada | **Capacidade / descoberta** | Código + juiz + triagem humana | Lista de falhas classificadas → casos novos | Cada iteração (amostra) |
| L4 Sonda real (staging) | Aceitação | Humano, roteiro com IDs da matriz | Registo `docs/security/staging-conversational-probe-*.md` | Antes de cada liberação ao piloto |
| L5 Produção | Monitorização | Código + amostra humana | KPIs da avaliação contínua | Contínuo, depois de GATE-04/06 |

### 4.1 Scorecard L1 (implementado nesta proposta)

`src/clinic/ai/evals/scorecard/` transforma cada corrida L1 num JSON estável: versão (commit e hash do catálogo de referência, dos casos, dos prompts e dos atos de diálogo), KPIs agregados e uma linha por caso (estado, INV falhadas, turnos excedentes, mensagens com mais de uma pergunta, concisão, estrago).

```bash
npm run eval:scorecard   # corre o L1, grava .eval/l1-latest.json e compara com a linha de base
```

```bash
npm run eval:baseline    # idem, e substitui a linha de base + acrescenta uma linha ao histórico
```

```bash
EVAL_STRICT=1 npm run eval:scorecard   # falha também em regressão informativa
```

Sem estas variáveis, `npm run test:dialogs` e o CI comportam-se como antes.

## 5. KPIs

Os KPIs organizam-se em quatro camadas. Só a camada **Gate** bloqueia (DEC-108). As outras **assinalam**. Os alvos numéricos ficam **Em aberto** até haver linha de base, como já previa o plano §4.4.

### 5.1 Gate (bloqueiam o merge) — **Confirmado** (DEC-108)

| KPI | Definição | Fonte | Limite |
| --- | --- | --- | --- |
| K-INV | Violações de INV-01..11 em todos os casos P0 | L1 scorecard | 0 |
| K-FAIL | Casos P0 em estado `fail` | L1 scorecard | 0 |

### 5.2 Saúde offline (assinalam regressão) — **Proposto**

| KPI | Definição | Origem | Regra de regressão vs linha de base |
| --- | --- | --- | --- |
| K-SUC | Casos que passam ÷ casos executados (EF-01) | L1 | Qualquer descida |
| K-COV | Casos executados ÷ registados; cobertura por família | L1 | Descida no total ou caso removido |
| K-TURN | Turnos excedentes p50/p90 (EE-01) | L1 | Qualquer subida; por caso, +1 turno |
| K-1Q | % de mensagens com mais de uma pergunta (EE-03) | L1 | Subida > 2 pp; por caso, +1 mensagem |
| K-LEN | % de mensagens com ≤ 300 caracteres e ≤ 3 parágrafos (EE-05) | L1 | Descida > 2 pp |
| K-DMG | Proposta = pedido (ES-01), zonas mantidas (ES-02), voltas até ao Confirmar (ES-04), só nos casos com `damage` e proposta | L1 | Por caso: proposta deixa de bater com o pedido. O agregado depende de quais casos declaram `damage`; ler a mudança, não o valor absoluto |
| K-CONS | pass^3: casos em que as 3 repetições passam | L2 | Descida fora do IC95 |
| K-Q | Média por eixo Q1–Q6, com abstenções contadas | L2 juiz | Descida > 0,2 num eixo (plano §4.4.4); **informativo até κ ≥ 0,6** (#402) |
| K-LAT | Latência p50/p95 da última mensagem à primeira saída (EE-04) | L2 live, L5 | **Em aberto**: sem linha de base real |
| K-COST | US$ por corrida e tokens por diálogo (EE-06) | L2/L3 ledger | Subida > 20 % sem mudança de corpus (**Proposto**) |
| K-SIM | Diálogos L3 sem falha ÷ diálogos L3; falhas novas por corrida | L3 | Indicador de descoberta, não de qualidade absoluta |

### 5.3 Produção (L5) — remete para a [avaliação contínua](../architecture/avaliacao-continua-conversacional.md)

Métrica orientadora: conversão confirmada sem erro, com acesso humano preservado. Guardrails: segurança da marcação, qualidade factual, acesso humano, confiabilidade do canal e eficiência de IA e WhatsApp. Os sinais operacionais já disponíveis no `ai.turn_decided` (rota, chamadas ao modelo, texto descartado, latências, tokens) permitem, **antes** dos dados reais, um painel de distribuição de rotas, de taxa de `fallback` e de `handoff:*` por versão. Ativação real depende de GATE-04/06.

### 5.4 KPIs do próprio processo — **Proposto**

Medem se a metodologia está a funcionar e disparam a sua revisão (§8).

| KPI | Definição | Como medir | Sinal de alarme |
| --- | --- | --- | --- |
| P-ESC Taxa de fuga | Defeitos conversacionais encontrados em L4/L5 ÷ todos os defeitos conversacionais corrigidos na iteração | Cada correção conversacional declara no PR «Apanhado em: L0/L1/L2/L3/L4/L5» | Subida em 2 iterações seguidas |
| P-PATH Cobertura do caminho vigente | Casos L1 executados no caminho principal da DEC vigente (hoje Flow + hub, DEC-138) ÷ passos do roteiro L4 desse caminho | Família de casos dedicada (ex. `FL-`) | < 1 caso por passo do roteiro |
| P-FRESH Frescura da linha de base | Dias e commits conversacionais desde a última `eval:baseline` | `l1-history.jsonl` vs `git log` | > 7 dias ou > 20 commits conversacionais |
| P-LIVE Idade do L2 live | Dias desde a última corrida L2 completa com modelo real | Relatório L2 | > 1 iteração ou mudança de modelo/prompt sem corrida |
| P-CAL Calibração do juiz | κ juiz↔humano; TPR/TNR por eixo | Amostra #402 | κ < 0,6 → o juiz não serve de gate |

## 6. Como se assinala progressão e regressão

1. **Linha de base.** `l1-baseline.json` é a última versão aceite. Só muda com `npm run eval:baseline`, num commit próprio, com o motivo na mensagem.
2. **Comparação emparelhada.** Cada caso é comparado consigo próprio na linha de base: mudança de estado (`fail < known_failure < pending < covered < pass`), INV nova a falhar, turnos excedentes, mensagens com várias perguntas e estrago. Depois, os KPIs agregados, com a tolerância de `KPI_RULES` (`scorecard.ts`).
3. **Veredicto.**
   - **⛔ Bloqueia:** INV nova ou caso a falhar. É o mesmo gate da DEC-108.
   - **⚠ Regressão:** informativa. O PR tem de a **explicar** (decisão nova, troca consciente) ou corrigir.
   - **✅ Melhoria:** progressão sem regressão. Gravar a linha de base no merge da iteração.
   - **＝ Igual.**
4. **Casos novos e removidos.** Um caso novo é progressão de cobertura. Um ID que desaparece é regressão (os casos marcam-se **Retirado**, não se apagam; plano §6.6).
5. **Estocástico (L2/L3).** Reporta-se sempre a proporção **com IC de Wilson a 95 %** e o pass^N. Duas versões só se dizem diferentes quando a diferença emparelhada por caso é consistente nas N repetições ou os IC não se sobrepõem. Com poucos casos a decisão é qualitativa, nunca «ganho estatístico» (alinhado com a avaliação contínua, secção «Como demonstrar melhoria»).
6. **Juiz.** Até à calibração da #402, a nota Q é sinal. Depois, a taxa reporta-se também corrigida por Rogan-Gladen (`correctJudgeRate`) com o TPR/TNR medido.

## 7. Cadência e rituais (Proposto)

| Quando | O quê | Quem | Custo |
| --- | --- | --- | --- |
| Cada PR | `npm test` (L0 + L1 gate). Se o PR toca `src/clinic/ai/`, `src/ai/` ou `src/whatsapp/flow/`: `npm run eval:scorecard` e colar o veredicto no PR | Autor (pessoa ou agente) | ~2 min, US$ 0 |
| Cada PR que corrige defeito conversacional | Caso L1 novo que falha antes e passa depois; linha «Apanhado em: Lx» | Autor | — |
| Fecho de iteração (por liberação, ou semanal no piloto) | `npm run eval:baseline`; L2 live (≤ US$ 10, DEC-117); L3 amostra (≤ US$ 10, DEC-126); linha no §7 do plano com o resumo do scorecard | Responsável da iteração | ≤ US$ 20 |
| Fecho de iteração | **Análise de erros:** ler os traços que falharam no L2/L3 e as notas de L4; codificar (*open coding*) e agrupar nas classes de causa do plano §6; parar quando não surgir classe nova | Uma pessoa com conhecimento do domínio (Paulo ou delegado) | ~1 h |
| Antes de liberar ao piloto | L4 com roteiro pelos IDs da matriz, incluindo o caminho principal vigente | Paulo | Tempo humano |
| Mensal, ou quando um KPI de processo dispara | Revisão da metodologia (§8) | Paulo + engenharia | — |

## 8. Manutenção da metodologia ao longo do ciclo de vida

A metodologia é um artefacto versionado. A versão está no fim deste documento.

**Gatilhos de revisão (Proposto).** Qualquer um obriga a rever este documento e, se preciso, `KPI_RULES`:

1. Uma DEC muda o caminho principal, o âmbito da IA ou o canal (ex. DEC-138, Flow): criar a família de casos desse caminho **antes** do merge que o liga, e rever as invariantes para esse caminho (lição G-08).
2. Mudança de modelo, de fornecedor ou de prompt: L2 live obrigatório e nova linha de base L2.
3. Um KPI de processo (§5.4) em alarme.
4. Uma fuga S1 (plano §3): revisão da invariante ou do validador que devia ter apanhado.
5. Entrada de dados reais (GATE-04/06): ativar L5 e amostragem humana de conversas reais minimizadas.
6. Um caso de capacidade passa estável em 3 iterações: **graduar** para regressão P0.
7. Uma família de casos fica saturada (100 % durante muito tempo e sem fugas): manter, mas investir em L3 e L4 nessa área.

**Como mudar.** Mudar um limiar, uma tolerância ou a camada de um KPI exige: (a) editar a tabela deste documento e `KPI_RULES` no mesmo PR; (b) registar a mudança no histórico de versões abaixo; (c) promover um KPI de «assinala» para «bloqueia» só com DEC do Paulo (como a DEC-108 fez para as INV).

## 9. Plano de ação para fechar as lacunas (Proposto)

| Passo | Fecha | Entrega | Dependência |
| --- | --- | --- | --- |
| 1 | G-01, G-04 | Scorecard L1, linha de base, histórico, pass^N e IC95 no L2 | **Feito nesta proposta** |
| 2 | G-02, G-08 | Família `FL-` (15 casos), `flow-driver.ts` sobre o endpoint real, `flowDataExchangeLocal` partilhado com o Clinic DO, invariantes corrigidas. Cobre no L1 o CF-36 da sonda L4 (#565) e encontrou o CF-43. Falta: catálogo ou hora a mudar a meio do Flow, `fallback_reason`, token de outra clínica (precisam de um turno de mutação). | **Feito** (05/11/2026), salvo o que falta |
| 3 | G-05 | Linha «Apanhado em» no modelo de PR e contagem P-ESC por iteração | Aprovar a convenção |
| 4 | G-01 | `eval:scorecard` no CI para PRs conversacionais, com o veredicto como comentário | Aprovar o uso no CI |
| 5 | G-03 | Corrida L2/L3 live no staging (chaves `AI_GATEWAY_*`); primeira linha de base real de K-CONS, K-LAT, K-COST | Acesso ao gateway |
| 6 | G-03 | Calibração do juiz: amostra humana, κ, TPR/TNR por eixo (#402) | Tempo do Paulo para rotular |
| 7 | G-06 | L5: painel por versão sobre `ai.turn_decided`; amostra humana de conversas reais | GATE-04/06 |

## 10. Decisões

| Pergunta | Decisão | Estado |
| --- | --- | --- |
| Aprovar esta metodologia como referência? | Sim; limiares numéricos Em aberto até duas linhas de base. | **Confirmado** (DEC-139) |
| Regressão informativa do scorecard bloqueia? | Não bloqueia; o PR justifica ou corrige. Reavaliar após duas linhas de base estáveis. | **Confirmado** (DEC-139) |
| Cadência da iteração no piloto | Semanal **e** antes de cada liberação, o que vier primeiro. | **Confirmado** (DEC-139) |
| Quem faz a análise de erros | O agente prepara (traços, agrupamento, casos novos); o Paulo valida. | **Confirmado** (DEC-139) |
| Corpo da oferta do Flow a meio do funil | A pergunta do funil com o CTA do Flow; o C1h só como recurso. | **Confirmado** (DEC-140) |
| Reconhecer verbos sem sinónimo | Mantém-se a DEC-110; o painel sugere à owner gravar o sinónimo. | **Confirmado** (DEC-141); sugestão implementada (#569: cartão M-63, L1 A-21) |
| Tolerâncias de `KPI_RULES` | As atuais até haver duas linhas de base. | **Em aberto** |

## Histórico de versões da metodologia

| Versão | Data | Mudança |
| --- | --- | --- |
| 0.4 | 05/11/2026 | Decisões do §10 registadas: DEC-139 (metodologia, regressão justificada no PR, cadência semanal + liberação, análise de erros preparada pelo agente), DEC-140 (corpo do Flow a meio do funil) e DEC-141 (verbos: DEC-110 + sugestão à owner). |
| 0.3 | 05/11/2026 | CF-43 fechado e CF-36 da sonda L4 (#565) coberto no L1; A-14 deixa de ser falso verde (lição: expectativas por regex devem excluir o texto de falha, não só incluir uma palavra); duas decisões novas Em aberto. |
| 0.2 | 05/11/2026 | Família FL- (G-02) e correção das invariantes (G-08); gatilho 1 passa a exigir revisão das invariantes. |
| 0.1 | 05/11/2026 | Primeira versão: diagnóstico G-01..06, KPIs em quatro camadas, scorecard L1 com linha de base e histórico, pass^N e IC de Wilson no L2, correção de Rogan-Gladen disponível, cadência e gatilhos de revisão. |
