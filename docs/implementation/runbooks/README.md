# Runbooks operacionais — piloto Tredane

**Estado:** **Proposto** (issue [#44](https://github.com/intentzero/tredane/issues/44)). Ensaiar com dados sintéticos (`clinic-demo-*`). Procedimentos live exigem staging provisionado (Em aberto).

| Runbook | Quando usar |
| --- | --- |
| [Indisponibilidade](unavailable.md) | Worker/DO/D1/R2/Queue inacessível ou degradado |
| [Reprocessamento](reprocess.md) | DLQ, outbox stale, status incerto — sem duplicar efeitos |
| [Credenciais](credentials.md) | Rotação Clerk/Meta/Pix/AI/VAPID |
| [Recuperação](recovery.md) | Restore por clínica, schema, PITR |
| [Incidentes](incidents.md) | Classificação, correlação, comunicação |
| [Kill switch AI_AUTOBOOK](ai-autobook-kill-switch.md) | Interromper novas marcações/Pix do botão (S9 #180); sem auto-cancel |

Código de apoio: [f6-ops.md](../f6-ops.md), `src/ops/`, `npm run ops:smoke`. Gates SEG-IA: [seg-ia-s9-e2e-validation.md](../../security/seg-ia-s9-e2e-validation.md).
