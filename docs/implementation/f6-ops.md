# F6 — Observabilidade, staging, recuperação e operação do piloto

**Estado:** implementação da issue [#44](https://github.com/intentzero/tredane/issues/44) (épico [#14](https://github.com/intentzero/tredane/issues/14)). DEC-038/043; REQ-013/070/071; AC-12/15/53; JRN-06/07. Dados sintéticos apenas. **Não** declara staging/produção live nem inventa provisionamento Cloudflare.

## Decisões aplicadas

| Item | Estado | Nota |
| --- | --- | --- |
| Workers Observability (`wrangler.jsonc` → `observability.enabled`) | **Confirmado** no contrato de deploy | Logs estruturados JSON no Worker; dashboard CF depende de conta |
| Correlação `tenantId` / `correlationId` / `operation` / `stage` / `outcome` | **Confirmado** (engenharia) | `src/ops/log.ts`; canais WhatsApp/Pix passam a scrub PII |
| Alertas DLQ/outbox/incerto/Meta/Pix/IA/revogação/expurgo | **Proposto** (limiares) | Catálogo em `src/ops/alerts.ts`; destino externo Em aberto |
| Budgets de latência/storage/filas/custo | **Proposto** | `src/ops/budgets.ts` — medir em staging antes de go-live |
| PITR DO/D1 e restore live | **Em aberto** | Ensaiado em harness; restore real = GATE conta CF |
| Política de retenção/acesso a logs | **Em aberto** (REQ-070) | Sem conteúdo pessoal; prazo/ACL a acordar com jurídico |
| Staging com D1 real | **Em aberto** | Placeholders bloqueados por `npm run check:env`; nunca no caminho piloto |

## Ambientes e deploy controlado

Ver [environments.md](environments.md) (inventário de secrets, smoke, rollback). Resumo:

1. `npm run check:env -- staging|production` — recusa D1/UUID placeholder.
2. `npm run ops:secrets` — imprime inventário (nomes, sem valores).
3. Migrations D1: revisar SQL → `wrangler d1 migrations apply <db> --env <env>` só após IDs reais.
4. Clinic DO: migrações por instância no boot (`CLINIC_SCHEMA_VERSION`).
5. Smoke: `npm run ops:smoke` (checklist) + `GET /api/f6/ops/smoke` com auth.
6. Rollback: redeploy do Worker na versão anterior; **não** reverter migração D1 destrutiva sem plano; ver runbook [recovery](runbooks/recovery.md).

## Correlação e alertas

| Kind | Severidade Proposta | Gatilho |
| --- | --- | --- |
| `dlq.depth` | critical | Mensagens na DLQ inbound |
| `outbox.stale` | warning | Outbox pending/publishing ≥ 10 |
| `outbound.uncertain` | warning | `delivery_state=unknown` ≥ 5 |
| `meta.failure` | critical | Falhas Meta agregadas |
| `pix.failure` | critical | Falhas Pix agregadas |
| `ai.failure` | warning | Falhas IA (não bloqueia envio manual) |
| `realtime.revoke` | info | Revogação membership/suporte |
| `tenant.purge` | warning | Deadline de expurgo próximo/vencido |
| `schema.mismatch` | critical | Versão D1/DO ≠ esperada |
| `recovery.isolation` | critical | Ensaio A afectou B |

Emissão: `emitOpsAlert` → log JSON canal `ops.alert` (Workers Observability). PagerDuty/Slack = **Em aberto**.

## Métricas e budgets (Proposto)

| ID | Alvo Proposto | Validação |
| --- | --- | --- |
| `latency.do.ping_p95_ms` | 150 ms | `/api/f6/ops/load` |
| `latency.api.p95_ms` | 400 ms | carga sintética local |
| `storage.do.sqlite_mb_per_clinic` | 200 MiB | snapshot contagens + doc CF |
| `queue.inbound.lag_s` | 60 s | Queues staging |
| `ws.connections_per_clinic` | 20 | ensaio multi-aba |
| `cost.clinic_month_relative` | Em aberto | Sem preços inventados (GATE-05/08/09) |

Carga: `POST /api/f6/ops/load` ou `npm run ops:load` (documenta comando; medição HTTP local).

## Recuperação por clínica

`POST /api/f6/ops/recovery/rehearse` valida:

- Schema admin (`ADMIN_SCHEMA_VERSION`) + clinic (`CLINIC_SCHEMA_VERSION`) + listagem R2 por prefixo
- Isolamento: contagens de B inalteradas após operação em A
- Garantias: sem reenvio WhatsApp/Pix; sem reativar membership/suporte; reconciliar tombstones/`purged_tenants`

**Em aberto (live):** PITR DO ≤30d (doc CF), backup D1, reconciliação Meta/Woovi read-only.

## APIs / harness

| Método | Path | Quem |
| --- | --- | --- |
| GET | `/api/f6/ops/catalog` | público (budgets/kinds; sem dados) |
| GET | `/api/f6/ops/secrets-inventory` | superadmin |
| GET | `/api/f6/ops/tenants/:id/snapshot` | auth (sintético ou superadmin) |
| POST | `/api/f6/ops/alerts/inject` | auth + `clinic-demo-*` |
| POST | `/api/f6/ops/log/scrub-check` | auth |
| POST | `/api/f6/ops/load` | auth |
| POST | `/api/f6/ops/recovery/rehearse` | auth |
| GET | `/api/f6/ops/smoke` | auth |
| RPC DO | `getOpsSnapshot` | contagens sem PII |

## Runbooks

Índice: [runbooks/README.md](runbooks/README.md) — indisponibilidade, reprocessamento, credenciais, recuperação, incidentes.

## Testes

- `src/ops/ops.test.ts` — scrub, alertas, budgets, recovery
- `src/ops/http.test.ts` — rotas HTTP com stub DO
- Canais WhatsApp/Pix: default logger com scrub (#44)

## Em aberto / gates

| Item | Nota |
| --- | --- |
| Conta Cloudflare staging com D1/R2/Queues reais | GATE-09 + provisionamento humano |
| Destino de alerta externo | Em aberto |
| Retenção/ACL de logs | REQ-070 + jurídico |
| Clerk/Meta/Pix/AI keys live | GATE-05/01/02/08/06 |
| Medição de custo por clínica em moeda | Não inventar; após facturação real |
| PITR / restore ensaiado em conta | Documentado; não executado neste PR |
