# Funil operacional de sessão de marcação (T4 / DEC-148)

**Estado:** **Proposto** (implementação T4; desenho de analytics aprovado pelo Paulo 07/11/2026). Sem dashboard de transcript. Sem nota LLM por sessão. Sem ritual T5.

## Quando usar

Responder às quatro perguntas do funil live **sem** abrir a conversa:

1. Terminou em `agendado` / `handoff` / `abandon`?
2. Onde caiu (`dropStep`)?
3. Quais friction flags (T2) aparecem mais?
4. Quantos turnos / `flowUsed` (T3)?

Cadência alinhada à DEC-139 (piloto semanal). Revisão humana amostral continua no **painel da clínica**, sob autorização vigente — não neste script.

## Pré-requisitos

- Sessões T1–T3 emitidas no Clinic DO (`booking_sessions` + outbox / Workers Logs).
- Acesso de suporte/ops ao SQLite da clínica **ou** export de Workers Logs (`wrangler tail` / Observability).
- Sem deploy obrigatório neste runbook; o script só lê o que já foi emitido.

## Script

```bash
# Pacote operacional: SQL do DO + filtros de Workers Logs (não corre remoto sozinho)
node scripts/booking-session-funnel.mjs staging <tenantId> [YYYY-MM-DD]

# Agregar a partir de JSONL (tail / export) — só eventos, sem corpo de mensagem
node scripts/booking-session-funnel.mjs staging <tenantId> 2026-11-08 --from-jsonl ./tail.jsonl

# stdin
npx wrangler tail --env staging --format=json | node scripts/booking-session-funnel.mjs staging <tenantId> --from-jsonl -
```

`TREDANE_FUNNEL_DRY_RUN=1` força só o pacote SQL/filtros.

Complementar Flow por token D1 (DEC-143 b): `node scripts/flow-funnel.mjs staging <tenantId> [YYYY-MM-DD]`.

## O que **não** fazer

| Proibido neste recorte | Motivo |
| --- | --- |
| Lista de mensagens / transcript no Platform Admin | Confirmado (Paulo): revisão na clínica |
| Juiz / nota LLM por sessão | Fora do MVP deste desenho |
| Alterar stop-lists ou regras de booking a partir do funil | DEC-104 / DEC-061 / DEC-141 — só sugestão humana (T5) |
| Decisão DEC-143 (papéis texto vs Flow) só com feeling | Esperar T1–T3 + teste com pessoas |

## Referências

- Desenho: store `docs/session-analytics.md` §4.4 / §7 T4
- Código: `src/clinic/ai/booking-session.ts`, `turn-decided.ts`, `turn-friction.ts`
- Metodologia: [metodologia-avaliacao-conversacional.md](../metodologia-avaliacao-conversacional.md)
