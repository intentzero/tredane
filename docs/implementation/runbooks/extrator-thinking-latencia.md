# Runbook — latência e thinking do extrator (proposta H9)

**Estado:** Proposta — não altera staging/prod sem OK do Paulo.

## Objetivo

Medir tokens e tempo de *extended thinking* do `claude-haiku-5-5` no extrator, e comparar qualidade vs latência com thinking `default` (gateway), `off` ou `minimal`.

## Pré-requisitos

- Staging com `AI_MODE=gateway` e secrets do AI Gateway.
- Clínica demo com IA assistiva ligada.
- Acesso a `wrangler tail` ou Workers Logs (eventos `ai.llm_usage` e `ai.turn_decided`).

## Variável (só staging, proposta)

```bash
# wrangler secret put AI_EXTRACTOR_THINKING_MODE --env staging
# Valores: off | minimal  (omisso = comportamento actual, sem campo thinking no body)
```

**Não** definir em production sem decisão explícita.

## Telemetria (sem PII)

| Evento | Campos relevantes |
|--------|-------------------|
| `ai.llm_usage` | `purpose=extract`, `model`, `latencyMs`, `inputTokens`, `outputTokens`, `thinkingTokens` |
| `ai.turn_decided` | `latencyMs.model`, `tokens.input`, `tokens.output`, `tokens.thinking` (extrator in-DO) |
| `do.step_timing` | fase `autodraft_extractor` (ms no DO, inclui rede até ao gateway) |

## Experimento A/B em staging

1. Baseline: sem `AI_EXTRACTOR_THINKING_MODE` (1–2 dias de tail ou amostra rsamp).
2. `off`: redeploy com secret; repetir cenários do laboratório (`lab/cenarios.json`) via MCP `tredane-staging-lab`.
3. `minimal`: idem.
4. Em cada modo: `npm run eval:scorecard` no branch de deploy (CI) e comparar regressões.
5. Agregar no tail: `jq 'select(.event=="ai.llm_usage" and .purpose=="extract")'`.

## Critérios

- **Qualidade:** scorecard 218/218 (ou justificar regressão no PR).
- **Latência:** comparar p50/p95 de `latencyMs` em `ai.llm_usage` e `do.step_timing.autodraft_extractor` entre modos (não inventar números sem amostra).

## Rollback

Remover o secret `AI_EXTRACTOR_THINKING_MODE` ou deixar omisso; redeploy staging.