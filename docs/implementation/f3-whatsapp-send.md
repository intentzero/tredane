# F3 — Envio manual, modelos WhatsApp e reconciliação de status (#33)

**Estado:** implementação da issue [#33](https://github.com/intentzero/tredane/issues/33) (épico [#14](https://github.com/intentzero/tredane/issues/14)). Depende de [#32](https://github.com/intentzero/tredane/issues/32) (webhooks) e [#31](https://github.com/intentzero/tredane/issues/31) (conexão). Anexos R2 = [#34](f3-attachments.md). Dados sintéticos / `META_MODE=synthetic` até gates [#18](https://github.com/intentzero/tredane/issues/18) e GATE-10.

## Decisões aplicadas

| ID | Comportamento |
| --- | --- |
| DEC-040 / Q-UX-06 | Janela 24 h no backend + UI; fora dela só modelo aprovado |
| REQ-012 / AC-16 | Composer + `POST …/messages` com `clientRequestId`; roles owner/attendant |
| REQ-013 / AC-07 | Timeout → `unknown` (Desconhecido); sem retry automático; falha → nova intenção humana |
| REQ-033 | Falha de envio **não** toca appointments |
| states.md | Estados: pending → accepted → delivered → read; failed/unknown; monotónico |
| GATE-10 | Textos/aprovação Meta reais pendentes; catálogo sintético TMPL-01/02/03 |

## Fluxo

```text
UI/API (auth + clinic.inbox.reply)
  → DO sendOutboundMessageOp (TX: message pending + outbound_messages + outbox)
  → fan-out WS + drain INBOUND_EVENTS { source: clinic_outbox, type: whatsapp.send }
Consumer
  → credenciais D1 → MetaAdapter.send* (synthetic/live)
  → DO applyOutboundSendResult (accepted | failed | unknown)
Webhook status (#32)
  → DO recordInboundStatus → reconcileOutboundStatusOp (delivered/read; sem regressão)
```

## Schema (Clinic DO v7)

- `messages.delivery_state`: + `delivered` / `read`
- `outbound_messages`: intenção com `client_request_id` único e `provider_message_id`
- `whatsapp_templates`: catálogo local (categoria + `pricingNote` vigente — **sem preços inventados**)

## APIs

| Método | Path | Notas |
| --- | --- | --- |
| POST | `/api/tenants/:id/inbox/conversations/:cid/messages` | `{ clientRequestId, body? }` ou `{ template }` |
| GET | `/api/tenants/:id/whatsapp/templates` | Lista aprovados + nota de custo Meta |
| GET | conversa | inclui `messagingWindow` |

## Testes

- `src/whatsapp/send.test.ts` — idempotência, 24 h, templates, unknown/status, consumer, REQ-033
- Inbox/HTTP actualizados para canal conectado + estados reais

## Em aberto / fora deste PR

- GATE-10 aprovação Meta real; textos finais
- Anexos R2 — [f3-attachments.md](f3-attachments.md)
- Live Graph exige secrets + Tech Provider (#18)
- Reminder automático (**posterior**, Q-UX-06)
