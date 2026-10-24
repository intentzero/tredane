# F4 — Conta Pix da clínica e configuração de sinais

**Estado:** implementação da issue [#37](https://github.com/intentzero/tredane/issues/37) (épico [#14](https://github.com/intentzero/tredane/issues/14)). Adaptador **Woovi** + conta M-33 + sinal no serviço (REQ-076/077). **Sem** criar cobrança na conversa ([#38](https://github.com/intentzero/tredane/issues/38)) nem confirmar pagamento ([#39](https://github.com/intentzero/tredane/issues/39)). Dados sintéticos / `PIX_MODE=synthetic` até GATE-08.

## Decisões aplicadas (Confirmado)

| DEC / REQ | Comportamento |
| --- | --- |
| DEC-049 / ADR-0014 | Provedor **Woovi (OpenPix)**; Mercado Pago só alternativa documentada |
| DEC-047 / REQ-076 | Sinal por serviço: fixo (centavos) ou % inteiro do preço; % exige preço |
| DEC-047 / REQ-077 | Conta da clínica; Tredane não recebe/repassa; desconexão preserva cobranças |
| DEC-047 | Prazo padrão **2 h** ajustável; política de cancelamento escrita pela owner |
| DEC-042 | Só owner conecta/desconecta e edita sinal/prazo/política |

## Schema SQLite (migração 10)

- Colunas em `clinic_settings`: `signal_deadline_seconds`, `signal_cancellation_policy`
- Colunas em `services`: `requires_signal`, `signal_kind`, `signal_fixed_cents`, `signal_percent`
- `pix_account` (1 linha/clínica): status, `app_id_cipher`, hint, environment, `credential_version`
- `pix_charges`: ledger local (sobrevive a disconnect); uso de domínio completo em #38/#39

`CLINIC_SCHEMA_VERSION = 10` (após #36 / migração 9 de agendamento).

## Adaptador

| Peça | Path |
| --- | --- |
| Contrato | `src/pix/contract.ts` |
| Woovi | `src/pix/woovi/adapter.ts` |
| Sandbox CI | `src/pix/woovi/sandbox.ts` (fixture HTTP; sem conta live) |
| Simulado | `src/pix/simulated/` (mantido) |
| Cifra App ID | `src/pix/crypto.ts` |
| Dinheiro inteiro | `src/pix/money.ts` |

## APIs

| Método | Path | Quem |
| --- | --- | --- |
| GET | `/api/tenants/:id/pix` | owner + attendant |
| POST | `.../pix/connect` | owner |
| POST | `.../pix/disconnect` | owner |
| PATCH | `.../pix/signal-settings` | owner |
| GET | `.../pix/charges?accountId=` | owner + attendant |
| POST | `.../pix/dev/revoke` | owner, só synthetic |

Respostas **nunca** incluem App ID nem cipher.

## UI

| Path | Ecrã |
| --- | --- |
| `.../clinica/recebimento` | M-33 conta + prazo + política |
| `.../clinica/servicos/:id` | «Exige sinal» fixo/% (M-16) |

## Em aberto / gates

- DPA, taxas contratuais e App ID real (GATE-08) — bloqueiam dinheiro real
- Criação de cobrança + WhatsApp (#38)
- Webhook de pagamento → compromisso (#39)
