# Identificação conversacional do objeto de marcação

**Estado:** plano de engenharia **Proposto** (1/11/2026), com diagnóstico **observado no código** e hipóteses ainda **Em aberto**. Não inventa decisão Confirmada. Não amplia autonomia da IA (DEC-061, DEC-060 revista). Sem RAG vetorial e sem troca de modelo neste trabalho.

**Issue:** [#397](https://github.com/intentzero/tredane/issues/397).  
**PR:** [#398](https://github.com/intentzero/tredane/pull/398).  
**Espelho curto (store do projeto):** `/cursor/stores/bc-01a16ae7-fbb2-7a30-9ba5-224a15570315/docs/booking-object-matching.md`

**Coordenação:** o [PR #394](https://github.com/intentzero/tredane/pull/394) trata zonas já escolhidas na proposta (DEC-090). Este trabalho foca a identificação do **serviço + variante** antes/durante a conversa; rebase em `main` se #394 aterrar.

---

## 1. Objetivo

Melhorar a capacidade do agente de conversar até identificar correctamente o objecto marcável (serviço e, quando aplicável, variante), fazendo só as perguntas necessárias e preservando o contexto entre turnos — sem marcar por texto livre e sem inventar funcionalidades comerciais.

Entrega esperada: código + testes/evals + PR, com documentação e issues a apoiar — não a substituir — a implementação.

---

## 2. Diagnóstico

### Observado no código (com referências)

| Achado | Onde | Efeito |
| --- | --- | --- |
| Matching de serviço exige todas as palavras significativas do nome no texto; fuzzy só para nomes de uma palavra ≥ 8 letras (distância 1) | `extractServices` / `citesServiceName` em `src/clinic/ai/autobook.ts`, `schedule-choice.ts` | Pedidos vagos («quero limpeza»), nomes populares ou parcial não resolvem; o fluxo cai no modelo |
| Duração como critério de variante só reconhece `\d+\s*min` | `durationHint` em `src/clinic/config/zones.ts` | «o de uma hora», «meia hora» não distinguem variantes |
| Sessão guarda serviço, linha, variantes, dia, período e hora; não guarda conjunto de candidatos nem pergunta pendente tipada | `schedule_sessions` / `schedule-session.ts` | Continuação depende de re-extrair texto; perguntas laterais (preço) podem devolver o turno ao modelo sem pergunta mínima |
| Quando o serviço não está resolvido, `tryAiAutoBook` devolve `needs_info` sem pergunta determinística de catálogo | `autobook.ts` ramo `else` (~L534) | Ambiguidade de serviço depende do rascunho do modelo |
| Uma única ocorrência lexical pode ser tratada como o serviço | `extractServices` / `namedServices` | Viola a regra de produto «um hit de busca não basta» quando o pedido ainda é parcial |
| Distinção sugestão vs mensagem enviada | `suggestions` / envio manual DEC-063; propostas DEC-061 | Preservar: matcher só prepara interpretação e texto determinístico; não envia nem marca |

### Hipótese (não comprovada como diagnóstico único)

A percepção de que «o agente não mapeia a linguagem da cliente ao catálogo» mistura (a) lacunas determinísticas acima com (b) falhas do modelo quando o atalho determinístico devolve `null`. A avaliação de ~30 conversas fictícias classifica cada falha: catálogo/contexto, interpretação, continuidade ou validação.

### Evidência de staging relacionada (outro agente)

Incidentes de 1/11 (proposta com catálogo inteiro / re-pergunta de zonas) estão em TR-114 / PR #394 — zonas e oferta da clínica, não o núcleo deste épico. Reusar regras DEC-090 já Confirmadas; não reabrir.

---

## 3. Escopo

**Dentro**

- Representação normalizada de opções marcáveis (IDs + atributos efectivos).
- Resolução do pedido em candidatos, informação em falta e ambiguidades.
- Estado conversacional mínimo reutilizado (`schedule_sessions`) + campos derivados no matcher (fonte da escolha, correcção, pergunta seguinte).
- Próxima pergunta a partir das diferenças relevantes entre candidatos.
- Evals sintéticos (~30) em `src/clinic/ai/evals/`.
- Integração em `catalog-reply`, `autobook` / `extractServices`, `schedule-choice` e, se preciso, dicas de duração em `zones.ts`.

**Fora**

- Marcação por texto livre; mais autonomia; envio autónomo.
- Booking composto de vários serviços; RAG/Vectorize; troca de modelo.
- Inferência de género/audiência por nome ou foto.
- Merge/deploy de produção; staging continua manual (403).

---

## 4. Sequência de implementação

1. Doc + issue + espelho no store (**esta fatia**).
2. Módulo `booking-object` + catálogo fictício de eval + fixtures.
3. Baseline das fixtures (classificar falhas).
4. Extensões mínimas: duração em linguagem natural; matching parcial único só com confiança alta; pergunta quando há N candidatos.
5. Ligar a `catalog-reply` / `autobook` para perguntas determinísticas de serviço/variante.
6. Revalidar evals (antes/depois) + testes de regressão existentes.
7. PR focado; CI verde; parar (sem merge).

---

## 5. Dependências

- DEC-061 / DEC-078 / DEC-079 / DEC-090 (**Confirmado**): botão versionado; variantes; linha; oferta da clínica não escolhe zona.
- DEC-011 / REQ-072: contexto mínimo.
- DEC-046: preços só do cadastro.
- DEC-083: pausa humana.
- PR #394 (aberto): rebase se necessário; não conflitar na lógica de zonas da oferta.

---

## 6. Critérios de aceite

1. Opções marcáveis normalizadas a partir do catálogo activo (serviço sem variantes = 1 opção; com variantes = 1 por variante activa, com duração/preço/audiência efectivos).
2. Pedido resolvido em: selecção inequívoca, esclarecimento (com pergunta mínima) ou handoff (terceiro, vários serviços, inexistente, histórico indisponível).
3. Não repetir informação já dada na sessão/funil; não inferir audiência por nome/foto.
4. Audiência só quando o catálogo exige linha (variantes F e M activas).
5. Duração pode distinguir variantes («uma hora», «60 min», «meia hora»).
6. Preços/durações citados vêm do backend/catálogo.
7. Um único hit lexical fraco não fecha selecção.
8. Após pergunta lateral (preço), a selecção retoma sem recomeçar o funil.
9. Mudança material de serviço/variante invalida avanço com proposta antiga (regras DEC-061 já existentes; cobrir no eval).
10. Eval sintético versionado; relatório antes/depois no PR; `vitest` dos módulos afectados verde.

---

## 7. Estratégia de validação

- **Unitário:** `booking-object.test.ts` (normalização, scores, perguntas, handoff).
- **Eval:** `src/clinic/ai/evals/booking-object*.ts` — ~30 diálogos multi-turno fictícios; resultado esperado por cenário (`selected` / `clarify` / `handoff`).
- **Integração leve:** `catalog-reply` / caminhos de `autobook` que consomem o matcher, sem rede.
- **Regressão:** suites AI existentes (`catalog-reply`, `autobook`, `variant-line`) no PR.
- **Não:** WhatsApp real, staging deploy, conversas com PII.

---

## 8. Observado vs hipótese (resumo)

| Afirmação | Estado |
| --- | --- |
| Matching lexical de serviço/variante tem lacunas mensuráveis no código | **Observado** |
| Sessão não tipa candidatos/pergunta pendente | **Observado** |
| Ambiguidade de serviço sem pergunta determinística | **Observado** |
| «O agente falha porque o LLM não mapeia bem o catálogo» como causa única | **Hipótese** — o eval aponta falhas sobretudo de interpretação/continuidade no caminho determinístico; não prova falha exclusiva do LLM |
| Precisamos de RAG ou modelo novo | **Fora** até evidência; este plano não autoriza |

## 10. Resultado do eval (após implementação)

Conjunto: `src/clinic/ai/evals/booking-object-fixtures.ts` (32 cenários fictícios).

| Métrica | Valor |
| --- | --- |
| Passes após `booking-object` | **32/32** |
| Classes cobertas nos fixtures | catalog, interpretation, continuity, validation |
| Comparação com o legado | O caminho antigo (`extractServices` exact-only + `durationHint` só `\d+ min`) falhava nos casos de hit parcial, «uma hora», deíctico com oferta, terceiro/inexistente/histórico e pergunta mínima de serviço — agora cobertos pelo resolver + handoffs em `catalog-reply` |

Regressão: `autobook.test.ts`, `catalog-reply.test.ts`, `booking-object.test.ts`, `zones` (duração) — verdes no PR.

---

## 9. Ligações

| Artefacto | Ligação |
| --- | --- |
| Arquitectura híbrida | [conversational-hybrid-model.md](../architecture/conversational-hybrid-model.md) |
| Conhecimento / RAG (proposta) | [clinic-knowledge-strategy.md](../product/clinic-knowledge-strategy.md) |
| Variantes | [variantes-de-servico.md](../product/variantes-de-servico.md) |
| Decisões | [decisions.md](../product/decisions.md) |
| Épico IA híbrida | [epic-conversational-hybrid-model.md](epic-conversational-hybrid-model.md) |
| Plano geral | [plan.md](plan.md) |
