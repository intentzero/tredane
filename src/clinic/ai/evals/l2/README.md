# Harness L2 / L3 — avaliação com LLM (#417)

**Confirmado:** tetos DEC-117 (L2 US$ 10/execução) e DEC-126 (L3 US$ 10/execução), com parada automática e relatório **truncado ≠ completo**.

## O que corre

| Nível | Entrada | Mede |
| --- | --- | --- |
| L2 | Diálogos da matriz (`p0-cases`) × N=3 + juiz Q1–Q6 | INV no texto gerado, EE-04/05/06, rubrica Q |
| L3 | Personas P-01–P-10 (cliente simulada) | INV duras, Q, triagem → casos novos |

Conjunto reservado ≈20 % (`held-out.ts`): mede, não afina prompt.

## Comandos

```bash
# CI / local sem chaves (dry-run, SimulatedAiAdapter)
npm run test:l2l3
npm run eval:l2
npm run eval:l3

# Matriz L2 completa em dry-run
EVAL_L2_FULL=1 npm run eval:l2

# Live (staging gateway) — gasta tokens de verdade
AI_MODE=gateway CF_ACCOUNT_ID=… AI_GATEWAY_ID=… AI_GATEWAY_TOKEN=… \
  EVAL_L2_MODE=live EVAL_L2_FULL=1 npm run eval:l2

AI_MODE=gateway … EVAL_L3_MODE=live EVAL_L3_FULL=1 npm run eval:l3
```

O L1 (`npm run test:dialogs`) **não** é alterado por este harness.

## Calibração do juiz

κ de Cohen juiz↔humano (≥ 0,6 **Proposto**) fica para a amostra da [#402](https://github.com/intentzero/tredane/issues/402). Até lá o juiz é informativo, não gate de merge.

## Após #416

O extrator (M6) muda o caminho do modelo: **re-correr L2** na `main` pós-merge do #416 e comparar com a baseline desta issue.
