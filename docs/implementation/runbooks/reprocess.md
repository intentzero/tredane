# Runbook — Reprocessamento (DLQ / outbox / status incerto)

**Estado:** Proposto · #44 · REQ-013 / AC-15

## Princípios

1. **Idempotência primeiro** — redrive só com a mesma chave de evento/`client_request_id`.
2. **Sem efeitos financeiros/mensagens duplicados** — status `unknown` exige reconciliação Meta/Pix **antes** de novo envio/cobrança.
3. Logs com `correlationId` + `tenantId` + `operation`; sem `body`/`wa_id`/tokens.

## DLQ inbound (`tredane-inbound-dlq-*`)

1. Alert `dlq.depth` ≥ 1.
2. Inspecionar metadados da mensagem (tipo, `receiptId`, `tenantId`) — não o payload completo de texto.
3. Se poison (`__poison` / schema inválido): ack + registo de incidente; **não** redrive.
4. Se transitório: redrive 1×; confirmar `webhook.duplicate_receipt` / dedup no DO.
5. Se tenant `purged` / `pending_deletion`: ack sem mutar (gate #43).

## Outbox stale

1. Snapshot: `GET /api/f6/ops/tenants/:id/snapshot` (sintético) ou RPC `getOpsSnapshot`.
2. Se `pending`/`publishing` acima do limiar: drenar consumer; verificar erros `last_error` técnicos.
3. Não marcar `acknowledged` manualmente sem prova de efeito externo.

## Status incerto (WhatsApp / Pix)

| Caso | Acção |
| --- | --- |
| WhatsApp `unknown` | Consultar Graph status; reconciliar para accepted/failed/delivered; **nunca** auto-retry de envio |
| Pix `uncertain` | Consultar Woovi por `correlationID`; reconciliar; **nunca** criar nova charge |
| Ambos falharam permanente | Estado visível no painel; acção humana |

## Ensaio sintético

`POST /api/f6/ops/alerts/inject` com `kind=dlq.depth` ou `outbound.uncertain`; confirmar linha de log sem PII (`/api/f6/ops/log/scrub-check`).
