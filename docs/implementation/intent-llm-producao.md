# INTENT_LLM — o que falta para produção

**Estado:** **Proposto** (DEC-221 / DEC-202; D5). Staging já corre com `INTENT_LLM_ENABLED=1` em `wrangler.jsonc` (`env.staging`). Produção **não** define a variável — o classificador fica desligado até esta lista fechar e o Paulo confirmar.

## Já em staging (Confirmado no código)

- Léxico primeiro; classificador só se o léxico não fechou.
- Etiquetas fechadas: `agendar` / `misto` / `remarcar` / `cancelar` / `price` / `team` / `faq_catalog` / `faq_clinic`.
- Gate do redator: `isClosedIntent` com limiar único **0,7** (`INTENT_MIN_CONFIDENCE`; hook `minConfidenceFor` para D2).
- Handlers determinísticos: link agenda, `catalogReply`, oferta de equipe, FAQ DEC-185 modo A (`faq_clinic` sem Abrir agenda por defeito).
- Telemetria `ai.intent_llm` (label, confidence, handler).
- Corpus + testes de apply; L1 léxico INT-10 / INT-13 / INT-14.

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

## Explicitamente diferido (não bloqueia staging)

- L1 dialog harness com classificador LLM live (hoje INT cobre léxico; apply cobre etiqueta→handler).
- Patches pontuais de léxico (passo 6 do plano) — só padrões de alto valor.
- Classe `misto` vs duas etiquetas + junção (D4).
- Busca semântica na deteção de intenção (D7: fora).

## Como ligar (quando D5 Confirmado)

1. Confirmar checklist acima.
2. Em `wrangler.jsonc` → `env.production.vars`: `"INTENT_LLM_ENABLED": "1"` (mesmo contrato que staging).
3. Deploy produção; validar `ai.intent_llm` e ausência de prosa inventada em intents fechados.
4. Plano de rollback: remover ou pôr `0` a variável — o chat volta ao léxico + redator sem redeploy de código.

## Referências

- DEC-221, DEC-202 — `docs/product/decisions.md`
- Medição — [intencao-medicao-2026-11-18.md](./avaliacao/intencao-medicao-2026-11-18.md)
- Plano Confirmado — Project `docs/plano-intents-fechados.md`
