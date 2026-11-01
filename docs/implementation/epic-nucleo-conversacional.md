# Épico: qualidade e núcleo determinístico do atendimento conversacional

**Estado:** **Proposto**. É um plano de engenharia pedido pelo Paulo em 01/11/2026 e não cria decisões de produto. Este documento é o épico; o acompanhamento faz-se na issue [#401](https://github.com/intentzero/tredane/issues/401). As decisões em aberto estão na [#402](https://github.com/intentzero/tredane/issues/402) e são registadas em [decisions.md](../product/decisions.md) antes de a issue que bloqueiam ser implementada.

**Mantém:**

- DEC-011: contexto e retenção da IA;
- DEC-042: só a owner configura;
- DEC-046: saúde e explicação cadastrada;
- DEC-061: só o botão da proposta versionada marca;
- DEC-079/090: linha, variantes e copy;
- DEC-083: pausa humana;
- DEC-084: avaliação contínua;
- DEC-086 a DEC-091: follow-up e remarcação.

**Fontes:** [plano de testes](plano-testes-conversacional.md) (achados CF/CA, critérios INV/EF/EE/Q, ciclo), [matriz de diálogos](matriz-dialogos-conversacional.md) (105 casos) e [núcleo determinístico](../architecture/nucleo-deterministico-conversacional.md) (passos M1–M7). Trabalho relacionado: [#397](https://github.com/intentzero/tredane/issues/397) (identificação do objeto de marcação, `booking-object.ts`).

## Objetivo

A conversa deve terminar num agendamento confirmado pela própria cliente, respeitando:

- a intenção da cliente;
- o tempo dela;
- a vontade dela;
- os limites da clínica.

O caminho normal passa a ser determinístico e guiado pelo grafo de dados da clínica. O LLM fica como extrator restrito e redator de exceção.

## Issues e ordem

| Ordem | Issue | Fatia | Fecha (matriz / achados) | Depende |
| --- | --- | --- | --- | --- |
| 0 | [#402](https://github.com/intentzero/tredane/issues/402) | D0: decisões (DEC-104, DEC-107–115 confirmadas; em aberto: listas, orçamento; NC-02 em parte) — antes: listas, sinónimos, lint, debounce, NC-02, alvos, orçamento, copy) | n/a | Paulo |
| 1 | [#403](https://github.com/intentzero/tredane/issues/403) | R1: validador factual da saída do LLM | I-07, I-08, J-08 · CF-01 | |
| 1 | [#404](https://github.com/intentzero/tredane/issues/404) | R2: nenhum silêncio, frase de fallback | K-01 · CF-14 | copy na #402 |
| 1 | [#405](https://github.com/intentzero/tredane/issues/405) | R3: copy sem jargão; corte de cumprimento | J-04, J-09, D-04 · CF-12, CF-16 | |
| 2 | [#406](https://github.com/intentzero/tredane/issues/406) | T1: harness L1 com os casos P0 no CI | todos os P0 | |
| 2 | [#407](https://github.com/intentzero/tredane/issues/407) | T2: evento `ai.turn_decided`; linha de base de latência e custo | CA-09 | |
| 3 | [#408](https://github.com/intentzero/tredane/issues/408) | M1a: leitor único de datas e horas | A-10, B-01–B-04, B-06–B-08, C-03, C-12 · CF-06–11 | |
| 3 | [#409](https://github.com/intentzero/tredane/issues/409) | M1b: classificador único de handoff e temas sensíveis, sobre o turno inteiro | G-02, G-03, G-05, G-11, E-06, H-02, H-03 · CF-02–04, 13, 18 | |
| 3 | [#410](https://github.com/intentzero/tredane/issues/410) | M1c: hesitação lexical e preferência de profissional | C-01, C-02, C-08, C-11, D-06 · CF-05, CF-20 | |
| 3 | [#411](https://github.com/intentzero/tredane/issues/411) | M1d: `TurnContext` e catálogo compilado por versão | eficiência | |
| 4 | [#412](https://github.com/intentzero/tredane/issues/412) | M2: ADR-0015 + estado persistente (datas absolutas, pergunta pendente, última oferta) | B-13, A-07, A-08, C-05–C-07, J-06 · CF-21, CF-22 | #406, #408, #409, #411 |
| 5 | [#413](https://github.com/intentzero/tredane/issues/413) | M3: decidir antes de gerar; oferta proativa; alternativas próximas | A-02, A-06, A-12, B-09–B-11, D-01, D-02, E-01, F-08 · CA-03, CF-15, CF-19 | #412 (item 1 decidido: DEC-104) |
| 5 | [#414](https://github.com/intentzero/tredane/issues/414) | M4: frases naturais (eco, variação) e validador único | J-07, J-09 · rubrica Q | #403, #405 (item 1 decidido: DEC-104) |
| 6 | [#415](https://github.com/intentzero/tredane/issues/415) | M5: listas e botões de escolha no WhatsApp | A-03 em ≤ 4 turnos | #402 (2), #412 |
| 6 | [#416](https://github.com/intentzero/tredane/issues/416) | M6: LLM extrator restrito e redator de exceção; fim do prompt monolítico | L3 coloquial · CA-04, CA-05, CA-07 | #412, #413 (DEC-104, DEC-109) |
| 6 | [#418](https://github.com/intentzero/tredane/issues/418) | M7: diálogos gerados pelo grafo; lint de configuração | cobertura de catálogo | DEC-112 (informativo) |
| 4 | [#420](https://github.com/intentzero/tredane/issues/420) | P1: handoff fora do expediente, pedido para parar, transparência sobre IA (DEC-113–115) | G-10, F-07, G-03 | #409 |
| 4 | [#421](https://github.com/intentzero/tredane/issues/421) | P2: sinónimos na ficha, só pela owner (DEC-110) | léxico | #411 |
| 4 | [#435](https://github.com/intentzero/tredane/issues/435) | B1: zona dita na mesma mensagem é ignorada (CF-24) — **corrigida** | A-04 | |
| 4 | [#436](https://github.com/intentzero/tredane/issues/436) | B2: mudança de serviço depois da proposta (CF-23) — **corrigida** | C-07 | |
| 4 | [#437](https://github.com/intentzero/tredane/issues/437) | B3: recusa da mistura de linhas explicada (CF-25) — **corrigida** | D-04 | |
| contínuo | [#417](https://github.com/intentzero/tredane/issues/417) | L2/L3: LLM no circuito, juiz calibrado, cliente simulada | rubrica Q, EE-04/06 | #402 (8: valor do orçamento) |
| contínuo | [#419](https://github.com/intentzero/tredane/issues/419) | Iteração 1 da matriz (modelo das iterações seguintes) | §7 do plano | |

As issues da mesma ordem podem avançar em paralelo. M2 em diante corre primeiro em **sombra** (calcula sem enviar) e só troca o caminho quando os casos da matriz que lhe correspondem passam ([avaliação contínua §5](../architecture/avaliacao-continua-conversacional.md)).

## Regras de controlo e continuidade

1. **Matriz como fonte:**
   - cada PR cita os IDs da matriz que passam a verde e atualiza a coluna de estado;
   - um caso nunca é apagado; um caso obsoleto passa a «Retirado (motivo, DEC)»;
   - os casos que ainda falham ficam no harness como `it.fails` com o ID do achado.
2. **Iterações:**
   - cada iteração tem uma issue «Iteração N» com a checklist da #419 e uma linha no [§7 do plano](plano-testes-conversacional.md#7-registo-de-iterações);
   - ao fechar uma iteração, abre-se a seguinte.
3. **Gate:** a regra de aprovação do plano §4.4 aplica-se a cada PR conversacional:
   - invariantes P0 a verde;
   - zero regressões;
   - métricas dentro da tolerância.

   Enquanto a #402 (item 7) não fixar os alvos, as métricas são informativas e as invariantes são gate.
4. **Decisões primeiro:** uma mudança de copy fixa, de política de handoff, de âmbito da IA ou de contexto enviado ao modelo exige DEC antes do merge. A DEC é registada em `decisions.md` e, a seguir, nos casos afetados da matriz.
5. **Achados novos:**
   - um achado novo (L3, L4/staging, produção) recebe o próximo ID CF/CA no plano e um caso na matriz;
   - é ligado a uma issue existente deste épico ou abre uma nova sub-issue da #401.
6. **Dados:** só casos fictícios. Uma conversa real exige GATE-04/06 e a política da avaliação contínua.

## Fora

- Marcação por texto livre (DEC-061 inalterado).
- Treino ou afinação de modelos.
- Promoção autónoma de candidatos (DEC-084 segue a sua própria política).
- Deploy.
- Dados reais de clientes.
