# F3 — Embedded Signup e gestão da conexão WhatsApp (#31)

**Estado:** implementação da issue [#31](https://github.com/intentzero/tredane/issues/31) (épico [#14](https://github.com/intentzero/tredane/issues/14)). **Sem** webhooks Meta (#32) nem envio (#33). Dados sintéticos / `META_MODE=synthetic` até gates [#18](https://github.com/intentzero/tredane/issues/18).

## Decisões aplicadas (Confirmado)

| DEC / REQ / AC | Comportamento |
| --- | --- |
| DEC-009 / REQ-051 | Owner conecta via Embedded Signup; Tredane Tech Provider |
| DEC-042 | Só owner escreve (`clinic.config.write`); attendant lê estado |
| AC-14 | Readiness exige WhatsApp `connected` no espelho do DO |
| AC-39 | Estado `interrupted` + banner a todos; só owner reconecta; sem reenvio automático |
| AC-40 | Troca liberta número antigo no índice; conversas no DO preservadas |

## Localização do índice (documentado neste PR)

| Store | Responsabilidade |
| --- | --- |
| **D1 central** | Índice global `phone_number_id` → tenant (`whatsapp_phone_bindings` com UNIQUE parcial activo/interrompido); credenciais (`whatsapp_credentials`, nunca na API); sessões state/nonce; histórico de binding; auditoria central |
| **SQLite do Clinic DO** | Espelho `whatsapp_channel` para readiness/UI/eventos WS; **sem tokens** |
| **R2 / Queues** | Fora deste PR |

Resolução futura de webhook (#32): `resolveTenantByPhoneNumberId` no D1 → se `released`/ausente, descartar (não cria dados; não reencaminha a outra clínica).

## Protocolo de troca / desconexão / trânsito

1. **Troca:** libertar binding antigo (`released`) + apagar credenciais; criar binding novo; espelhar DO. Webhooks do `phone_number_id` antigo deixam de resolver para a clínica.
2. **Desconexão:** igual (released + delete credentials); confirmação pelo nome da clínica (M-26).
3. **Interrupção:** status `interrupted`; credenciais removidas (não reenviar com segredo revogado); índice mantém associação até troca/desconexão (evita hijack). Em synthetic: `POST .../dev/interrupt`. Em produção: evento Meta via #32.
4. **Mensagens em trânsito:** outbox/envios com credencial revogada falham como «Não enviada» (#33); histórico de conversas no DO **não** é apagado.
5. **Cancelado/forjado:** state inválido ou código inválido → canal permanece `disconnected`; state consumido só após troca Meta bem-sucedida (antes da activação atómica).

## APIs

| Método | Path | Quem |
| --- | --- | --- |
| GET | `/api/tenants/:id/whatsapp` | owner + attendant |
| POST | `.../whatsapp/session` | owner (`purpose`: connect \| reconnect \| replace) |
| POST | `.../whatsapp/complete` | owner (state, code, phoneNumberId, wabaId) |
| POST | `.../whatsapp/disconnect` | owner (`clinicNameConfirmation`) |
| POST | `.../whatsapp/dev/interrupt` | owner, só `META_MODE=synthetic` |

## UI

| Path | Ecrã |
| --- | --- |
| `/c/:id/clinica/whatsapp` | M-19 / M-23 / M-24 |
| `.../whatsapp/trocar` | M-25 |
| `.../whatsapp/desconectar` | M-26 |

Banner global de interrupção no `PanelShell` (todos os membros).

## Código

| Área | Path |
| --- | --- |
| Domínio D1 | `src/whatsapp/` |
| Espelho DO | `src/clinic/whatsapp/` |
| Migração D1 | `db/migrations/0008_whatsapp_bindings.sql` (`admin_schema_state=8`) |
| Migração DO | `src/clinic/migrations/0006_whatsapp_channel.ts` (`CLINIC_SCHEMA_VERSION=6`) |
| Testes | `src/whatsapp/whatsapp.test.ts`, `http.test.ts` |

## Em aberto / gates humanos

- Tech Provider + Business Verification + App Review (GATE-01/02, #18)
- `META_MODE=live` + secrets no dashboard Cloudflare
- Textos finais Embedded Signup; modelos aprovados (GATE-10)
- Webhooks (#32) e envio (#33)
- Registo de número de telefone Cloud API pós-signup (passo Meta) — a activar em live
