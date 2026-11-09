# Runbooks operacionais — piloto Tredane

**Estado:** **Proposto** (issue [#44](https://github.com/intentzero/tredane/issues/44)). Ensaiar com dados sintéticos (`clinic-demo-*`). Procedimentos live exigem staging provisionado (Em aberto).

| Runbook | Quando usar |
| --- | --- |
| [Indisponibilidade](unavailable.md) | Worker/DO/D1/R2/Queue inacessível ou degradado |
| [Reprocessamento](reprocess.md) | DLQ, outbox stale, status incerto — sem duplicar efeitos |
| [Credenciais](credentials.md) | Rotação Clerk/Meta/Pix/AI/VAPID |
| [Recuperação](recovery.md) | Restore por clínica, schema, PITR |
| [Incidentes](incidents.md) | Classificação, correlação, comunicação, três casos de IA |
| [Preocupação com a IA](ai-concern.md) | Sugestão, resumo ou marcação que alguém contesta; sem falha de fila |
| [Pausar o botão de agendamento](ai-autobook-kill-switch.md) | Owner pausa novas propostas/Pix do botão; sem auto-cancel |
| [Funil booking_session (T4)](booking-session-funnel.md) | Outcomes / dropStep / friction / flowUsed sem transcript — `scripts/booking-session-funnel.mjs` |
| [Ritual semanal sessão (T5)](booking-session-weekly-ritual.md) | Amostra N + rótulos humanos + backlog stop/synonym só-lista — `scripts/booking-session-weekly-sample.mjs` |

Código de apoio: [f6-ops.md](../f6-ops.md), `src/ops/`, `npm run ops:smoke`. Gates SEG-IA: [seg-ia-s9-e2e-validation.md](../../security/seg-ia-s9-e2e-validation.md).
