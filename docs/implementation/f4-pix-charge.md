# F4 — Cobrança Pix e sinal na conversa (sem reservar)

**Estado:** implementação da issue [#38](https://github.com/intentzero/tredane/issues/38) (épico [#14](https://github.com/intentzero/tredane/issues/14)). DEC-047; REQ-078; AC-46/51. Depende de [#37](f4-pix-account.md) (conta) e [#36](f4-booking.md) (confirmação atómica). **Sem** confirmação de pagamento ([#39](https://github.com/intentzero/tredane/issues/39)) nem expiração/estorno automática ([#40](https://github.com/intentzero/tredane/issues/40)). Dados sintéticos / `PIX_MODE=synthetic` até GATE-08.

## Decisões aplicadas (Confirmado)

| DEC / REQ | Comportamento |
| --- | --- |
| DEC-047 / REQ-078 / AC-46 | Enviar sinal cria cobrança e mensagem; **não** cria `appointment_allocations` |
| DEC-047 / AC-51 | **Confirmar sem sinal** exige motivo; regista autor; confirma via booking atómico |
| DEC-047 | Cobrança prévia aberta é cancelada ao confirmar sem sinal (evita dupla reserva em #39) |
| DEC-040 | Fora da janela 24 h: template `tredane_cobranca_sinal_pix` (catálogo sintético; Meta = GATE-10) |

## Schema SQLite (migração 11)

- `scheduling_intents` — horário pretendido sem alocação (`awaiting_signal` / `waived` / …)
- `pix_charges` — snapshot (serviço, slot, fuso, política, prazo, sinal) + `message_id` + `provider_create_state`
- `pix_charge_commands` — idempotência por `clientRequestId`

`CLINIC_SCHEMA_VERSION = 11`. Intents **não** entram na disponibilidade.

## Fluxo

1. **Prepare (TX):** intent + charge `pending` + snapshot; sem I/O externo.
2. **Provedor (fora TX):** `adapter.createCharge` (Woovi ou Simulated); `uncertain`/`timeout` → `provider_create_state=uncertain` (reconciliar sem nova cobrança cega).
3. **WhatsApp:** `sendOutboundMessageOp` com `clientRequestId` distinto (`…:wa`); falha WA **não** cancela cobrança.
4. UI / conversa: «Aguardando sinal — horário não reservado»; etapa permanece/move para `horario_proposto` (badge, sem nova etapa CHECK).

## APIs

| Método | Path | Quem |
| --- | --- | --- |
| POST | `/api/tenants/:id/pix/charges` | `clinic.agenda.operate` |
| GET | `/api/tenants/:id/pix/charges/:chargeId` | read (inclui `pixCopyPaste`) |
| POST | `/api/tenants/:id/pix/charges/:chargeId/reconcile` | operate |
| GET | `/api/tenants/:id/conversations/:cnv/pix-charges` | read |
| POST | `/api/tenants/:id/appointments/confirm-without-signal` | operate |

## UI

| Path | Comportamento |
| --- | --- |
| `…/agenda/agendar?conversationId=` | Serviço com sinal → **Enviar sinal** / **Confirmar sem sinal** |
| Conversa (M-31) | Cartão **Aguardando sinal** + Copiar Pix |

## Em aberto / fora deste PR

- Webhook pago → confirmar horário (#39)
- Expiração automática / cancelar cobrança end-to-end / estorno (#40)
- DPA / `PIX_MODE=live` (GATE-08); aprovação Meta do template (GATE-10)
- Contrato fino de cobrança prévia já documentado como cancelamento local + tentativa no provedor
