# F3 — Webhooks WhatsApp, fila de entrada e deduplicação (#32)

**Estado:** implementação da issue [#32](https://github.com/intentzero/tredane/issues/32) (épico [#14](https://github.com/intentzero/tredane/issues/14)). **Sem** envio Graph API (#33) nem anexos R2 (#34). Dados sintéticos / `META_MODE=synthetic` até gates [#18](https://github.com/intentzero/tredane/issues/18).

## Decisões aplicadas (Confirmado / Proposto)

| REQ / AC | Comportamento |
| --- | --- |
| REQ-050 / AC-05 | Challenge GET + `X-Hub-Signature-256` no corpo original; tenant só via `resolveTenantByPhoneNumberId` (índice D1 #31) |
| REQ-011 / AC-04 | Recibo D1 antes do ack; Queue → DO `ingestMessage`; dedup `(tenant, provider_event_key)` + `external_message_id` |
| REQ-013 / AC-15 | Retries Queue (`max_retries=3`) + DLQ; recibo `failed` observável; logs sem corpo/telefone/credencial |
| REQ-070 | Logs técnicos: `receiptId`, `tenantId`, `kind`, `providerEventKey`, `phone_number_id` (id Meta da linha), nunca waId/corpo |

## Fluxo

```text
Meta POST → verify HMAC(rawBody) → parse → resolve phone_number_id
  → insert whatsapp_webhook_receipts (UNIQUE provider_event_key)
  → INBOUND_EVENTS.send({ source: 'whatsapp_webhook', tenantId, … })
  → HTTP 200
Consumer → Clinic DO ingestMessage / recordInboundStatus / applyWhatsappInterrupt
  → outbox + WS fan-out pós-commit
```

Número `released`/desconhecido → recibo `discarded`, **sem** escrita no DO de qualquer clínica.

## APIs

| Método | Path | Auth |
| --- | --- | --- |
| GET | `/api/webhooks/whatsapp` | Challenge Meta (`hub.*`) |
| POST | `/api/webhooks/whatsapp` | `X-Hub-Signature-256` |
| POST | `/api/webhooks/whatsapp/dev/inject` | Só `META_MODE≠live` — assina e injeta fixture |

## Filas (Wrangler)

| Ambiente | Queue | DLQ | max_retries |
| --- | --- | --- | --- |
| development | `tredane-inbound-dev` | `tredane-inbound-dlq-dev` | 3 |
| staging | `tredane-inbound-staging` | `tredane-inbound-dlq-staging` | 3 |
| production | `tredane-inbound-production` | `tredane-inbound-dlq-production` | 3 |

`source: clinic_outbox` (drain do DO): `whatsapp.send` consumido em #33 ([f3-whatsapp-send.md](f3-whatsapp-send.md)); outros tipos ack.

## Código

| Área | Path |
| --- | --- |
| Verify / parse / ingest | `src/whatsapp/webhook-*.ts` |
| Consumer | `src/whatsapp/queue-consumer.ts` |
| Recibos D1 | migração `0009_whatsapp_webhook_receipts.sql` (`admin_schema_state=9`) |
| Worker | `src/worker/index.ts` (`fetch` + `queue`) |
| Testes | `webhook.test.ts`, `webhook-http.test.ts` |

## Em aberto / fora deste PR

- Envio e reconciliação de status de entrega outbound (#33)
- Download de mídia / R2 (#34) — tipos não texto entram como mensagem explícita «não suportado»
- Gates Meta humanos (#18); `META_VERIFY_TOKEN` / `META_APP_SECRET` reais via secret
- Consumer dedicado da DLQ (redrive operacional: `prepareWebhookReceiptRedrive` + re-enqueue)
