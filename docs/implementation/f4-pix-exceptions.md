# F4 — Resolver Pix pago sem horário, expiração, cancelamento e devolução

**Estado:** implementação da issue [#40](https://github.com/intentzero/tredane/issues/40) (épico [#14](https://github.com/intentzero/tredane/issues/14)). DEC-047; REQ-080–082; AC-48–50; JRN-05/16. Depende de [#39](f4-pix-payment.md). Completa F4-Pix antes de F5. Dados sintéticos / `PIX_MODE=synthetic` até GATE-08.

## Decisões aplicadas (Confirmado)

| DEC / REQ | Comportamento |
| --- | --- |
| DEC-047 / REQ-080 / AC-48 | Alerta durável **Pago sem horário**: **Escolher outro horário** (sinal já pago, sem nova cobrança) ou **Devolver sinal**; alerta só resolve quando a acção efectiva (confirmação ou estorno confirmado) |
| DEC-047 / REQ-081 / AC-49 | Cobrança não paga expira (padrão 2 h); cancelável pela atendente; local + provedor com reconciliação; aviso de pago após prazo → pago sem horário (dinheiro rastreável) |
| DEC-047 / REQ-082 / AC-50 | Cancelar compromisso pago: motivo + **Devolver/Reter** (política visível); estorno `solicitado→devolvido\|falhou`; UI nunca mostra **Devolvido** antes da confirmação; IA não cria/cancela/estorna |

## Fluxos

1. **Alt horário:** `POST .../pix/alerts/:id/confirm-slot` → TX atómica (mesmo primitivo de #36); conflito preserva alerta e sinal pago.
2. **Devolver (alerta):** `POST .../pix/alerts/:id/refund` → estorno idempotente; alerta resolve só se `refunded`.
3. **Expirar:** alarm do Clinic DO + `expireDueChargesOp`; webhook `charge.expired` / `charge.cancelled`.
4. **Cancelar não paga:** `POST .../pix/charges/:id/cancel`.
5. **Cancelar pago:** `POST .../appointments/:id/cancel-with-signal` — reserva cancela sempre; estorno é separado (falha financeira não reabre compromisso).
6. **Estorno retry:** `POST .../pix/charges/:id/refund`; status incerto → consulta antes de novo efeito.

## Schema

- Clinic migração **13** — disposição do sinal, campos de estorno, `pix_exception_commands`, `pix_lifecycle_events` (`CLINIC_SCHEMA_VERSION = 13`)

## Eventos em tempo real

`cobranca.expirada`, `cobranca.cancelada`, `estorno.atualizado` (+ existentes de #38/#39).

## Em aberto / fora deste PR

- F5 IA / PWA
- DPA / `PIX_MODE=live` (GATE-08)
- Decisão automática reter/devolver, crédito, pagamentos além do sinal
