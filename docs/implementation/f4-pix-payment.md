# F4 — Processar pagamento Pix e confirmar horário atomicamente

**Estado:** implementação da issue [#39](https://github.com/intentzero/tredane/issues/39) (épico [#14](https://github.com/intentzero/tredane/issues/14)). DEC-047; REQ-079/080; AC-47/48; JRN-16. Depende de [#38](f4-pix-charge.md) (cobrança) e [#36](f4-booking.md) (confirmação atómica). **Sem** expiração automática / cancel UX / estorno ([#40](https://github.com/intentzero/tredane/issues/40)). Dados sintéticos / `PIX_MODE=synthetic` até GATE-08.

## Decisões aplicadas (Confirmado)

| DEC / REQ | Comportamento |
| --- | --- |
| DEC-047 / REQ-079 / AC-47 | Webhook assinado → marca **Paga**; se horário livre, confirma compromisso **sem** ação da IA/equipe |
| DEC-047 / REQ-080 / AC-48 | Horário ocupado ou pagamento após prazo local → **Pago sem horário** + alerta durável (M-32) |
| DEC-047 | Confirmação à cliente continua pelo fluxo humano de mensagem (#33) |
| ADR-0014 | Eventos Woovi `OPENPIX:CHARGE_COMPLETED*`; assinatura RSA; consulta `GET /charge/{id}` para reconciliar valor/estado quando necessário |

## Garantias do provedor (documentar no adaptador)

- **Webhook:** at-least-once; assinatura RSA-SHA256 (`x-webhook-signature`); reentrega possível.
- **Consulta:** `getCharge` no adaptador — usada quando o envelope não basta ou o valor diverge do ledger (neste PR a conferência primária é ledger local no DO; mismatch → rejeição).
- **Não há** atomicidade entre API financeira Woovi e SQLite do Clinic DO: o pagamento real no provedor pode existir sem compromisso local (pago sem horário / alerta).

## Fluxo

1. **Borda** `POST /api/webhooks/pix`: valida assinatura (Woovi ou HMAC sintético); exige `tredaneTenantId` / `tredaneAccountId` em `additionalInfo`; recibo D1 idempotente; enfileira só `charge.paid`.
2. **Fila** `pix_webhook` → Clinic DO `processPixPayment`.
3. **TX SQLite única:** associa cobrança↔conta↔valor; disputa slot; ou confirma compromisso + alocações, ou `payment_resolution=paid_without_slot` + `pix_payment_alerts` aberto.
4. **Pós-commit:** outbox `cobranca.paga` / `cobranca.sem_horario` / `appointment.confirmed` → WS; alerta persiste se fan-out falhar.

## Schema

- D1 migração **0011** — `pix_webhook_receipts` (`ADMIN_SCHEMA_VERSION = 11`)
- Clinic migração **12** — colunas de resolução em `pix_charges`; `pix_webhook_events`; `pix_payment_alerts` (`CLINIC_SCHEMA_VERSION = 12`)

## APIs

| Método | Path | Quem |
| --- | --- | --- |
| POST | `/api/webhooks/pix` | público (assinatura) |
| GET | `/api/tenants/:id/pix/alerts?conversationId=` | `clinic.agenda.operate` (reconnect M-32) |

## UI

| Path | Comportamento |
| --- | --- |
| Conversa (M-31/M-32) | Faixa **Sinal pago, mas o horário foi ocupado** + atalho Agendar; ações Devolver / Confirmar com sinal pago = #40 |

## Em aberto / fora deste PR

- Expiração automática, cancelar cobrança end-to-end, estorno e resolução do alerta (#40)
- DPA / `PIX_MODE=live` (GATE-08)
- Moeda: Pix BRL implícito (sem multi-currency no MVP)
