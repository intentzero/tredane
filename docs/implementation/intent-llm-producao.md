# INTENT_LLM — o que falta para produção

**Estado:** **Proposto** (DEC-221 / DEC-202; D5). Staging já corre com `INTENT_LLM_ENABLED=1` em `wrangler.jsonc` (`env.staging`). Produção **não** define a variável — o classificador fica desligado até esta lista fechar e o Paulo confirmar.

## Já em staging (Confirmado no código)

- Léxico primeiro; classificador só se o léxico não fechou.
- Etiquetas fechadas: `agendar` / `misto` / `remarcar` / `cancelar` / `price` / `team` / `faq_catalog` / `faq_clinic`.
- Gate do redator: `isClosedIntent` com limiar único **0,7** (`INTENT_MIN_CONFIDENCE`; hook `minConfidenceFor` para D2).
- Handlers determinísticos: link agenda, `catalogReply`, oferta de equipe, FAQ DEC-185 modo A (`faq_clinic` sem Abrir agenda por defeito).
- Telemetria `ai.intent_llm` com **label**, **confidence**, **origin**, **mode**, **handler** / **linkPurpose**, **outcome** (`cta` / `catalog` / `catalog_missing` / `team` / `redactor` / `fallback` / `handoff` / sombra). Persistência da etiqueta no resultado do job LLM (`intent` em `llm_jobs`).
- Corpus + testes de apply; L1 léxico INT-10 / INT-13 / INT-14 / INT-15 (#1020); INT-16 quando #1021.
- Agregação offline: `npm run report:intent-llm -- eventos.ndjson` (`scripts/intent-llm-report.mjs`).
- Medição léxico sem gastar: `npm run eval:intent:lexicon`. Live: `EVAL_INTENT_LLM=live npm run eval:intent`.

## Caminho de enablement (staging → sombra → produção)

| Passo | O quê | Onde | Estado |
| --- | --- | --- | --- |
| A | Live em staging | `wrangler.jsonc` → `env.staging.vars.INTENT_LLM_ENABLED=1` | **Confirmado** |
| B | Sombra em produção (opcional, pré-D5) | `env.production.vars.INTENT_LLM_SHADOW=1` (**sem** `INTENT_LLM_ENABLED`) | **Proposto** — mede `shadow_would_close` / `shadow_open` sem mudar UX |
| C | Amostra + eval live + checklist abaixo | Review MCP / lab / `eval:intent` | **Em aberto** |
| D | Live em produção (D5) | `INTENT_LLM_ENABLED=1` em `env.production`; remover sombra se ligada | **Fora** até Paulo confirmar |

Contrato das flags (`1` / `true` / `on`):

- `INTENT_LLM_ENABLED` — classifica **e** desvia fechados ≥ limiar para o handler.
- `INTENT_LLM_SHADOW` — classifica e loga; **não** desvia. Se ambas ligadas, o live prevalece (sombra só-só quando enabled está off).

Rollback: remover a variável ou pôr `0` — o chat volta a léxico + redator.

## Checklist antes de ligar em produção (**Proposto** — D5)

| # | Item | Estado | Quem |
| --- | --- | --- | --- |
| 1 | Amostra real rotulada (staging / Review MCP / lab) com recall combinado ≥ 95 %, informação→agenda ≤ 5 %, zero regressões de segurança | **Em aberto** | Paulo + engenharia |
| 2 | Corrida live do corpus: `EVAL_INTENT_LLM=live npm run eval:intent` (ou workflow `eval-intent.yml`) e relatório no PR / notas | **Em aberto** | Engenharia |
| 3 | D2 — limiar: manter 0,7 ou afinar por etiqueta em `minConfidenceFor` com evidência | **Proposto** (hoje 0,7 único) | Paulo após medição |
| 4 | D3 — confirmar formalmente `faq_clinic` irmã (opção B já no código) vs despacho só em `faq_catalog` | **Proposto** | Paulo |
| 5 | D1 — modelo (Haiku actual vs mais barato): custo por turno em staging | **Em aberto** | Paulo + engenharia |
| 6 | Confirmação explícita DEC (igual DEC-202 para o classificador de agenda) | **Em aberto** | Paulo |
| 7 | Definir `INTENT_LLM_ENABLED=1` **só** em `env.production` após 1–6; sem a variável o caminho fica só léxico + redator | **Fora** até D5 Confirmado | Engenharia no deploy |

## faq_catalog — fecho do caminho vivo

| Peça | PR | Papel |
| --- | --- | --- |
| Cue clarificação no léxico | #1016 | `answerFaqFromCatalog` no caminho A |
| Etiqueta + apply fechado | #1017 | classificador → `applyClosedHandlerOp` |
| Cue oferta «fazem X?» | #1020 (merged) | léxico antes de rememberZones / LLM |
| Handler sem cues (`forceFaqCatalog`) | #1021 (aberto) | paráfrases etiquetadas sem regex |

Este recorte (telemetria + sombra + corpus) **não** duplica #1021; com ele merged, `outcome=catalog|catalog_missing` cobre paráfrases sem cues. Prompt do classificador já alinha oferta e «mostra a agenda» à mesma etiqueta dos handlers.

## Explicitamente diferido (não bloqueia staging)

- Fine-tune online / treino contínuo em produção — **fora** (DEC-221 / análise §4.2).
- Contagem do teto diário para a *chamada extra* da sombra no consumer (o redator continua a contar no apply).
- L1 dialog harness com classificador LLM live (hoje INT cobre léxico; apply cobre etiqueta→handler).
- Patches pontuais de léxico (passo 6 do plano) — só padrões de alto valor.
- Classe `misto` vs duas etiquetas + junção (D4).
- Busca semântica na deteção de intenção (D7: fora).
- Overrides `minConfidenceFor` por etiqueta (D2) até amostra.

## Como ligar (quando D5 Confirmado)

1. Confirmar checklist acima.
2. Em `wrangler.jsonc` → `env.production.vars`: `"INTENT_LLM_ENABLED": "1"` (mesmo contrato que staging). Remover `INTENT_LLM_SHADOW` se existir.
3. Deploy produção; validar `ai.intent_llm` (`outcome` ≠ prosa inventada em fechados) e `npm run report:intent-llm` sobre export de logs.
4. Plano de rollback: remover ou pôr `0` a variável — o chat volta ao léxico + redator sem redeploy de código.

## Referências

- DEC-221, DEC-202 — `docs/product/decisions.md`
- Medição — [intencao-medicao-2026-11-18.md](./avaliacao/intencao-medicao-2026-11-18.md)
- Análise de etiquetagem — Project `docs/analise-etiquetagem-turno.md`
- Plano Confirmado — Project `docs/plano-intents-fechados.md`
