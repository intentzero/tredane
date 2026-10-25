# F6 — Exclusão de contacto e expurgo de clínica (≤30 dias)

**Estado:** implementação da issue [#43](https://github.com/intentzero/tredane/issues/43) (épico [#14](https://github.com/intentzero/tredane/issues/14)), com polish de UI + Workflows. DEC-011/038/047/048; REQ-071; JRN-10 (exclusão lógica de tenant); VAL-09. Dados sintéticos apenas. **Não** fecha revisão jurídica LGPD nem DPA de terceiros.

## Decisões aplicadas (Confirmado)

| DEC / REQ | Comportamento neste entrega |
| --- | --- |
| DEC-011 / REQ-071 | Dados enquanto cliente; owner exclui contacto (mensagens/anexos/R2); compromissos ficam **anonimizados**; encerramento → exclusão total em ≤30 dias (SQLite DO + prefixo R2) |
| DEC-038 / ADR-0012 | Wipe no SQLite do DO da clínica; D1 central para comando/tombstone; R2 privado por prefixo |
| DEC-047 | Cobranças Pix no DO; **não** inventar retenção financeira longa que contradiga DEC-011 — passo `financial_noted` documenta **Em aberto** |
| DEC-048 | UI de exclusão no painel com React Aria Components (Modal/Dialog); sem Radix |
| REQ-006 / AC-18 | Exclusão lógica `pending_deletion` + comando (já em #24); este fluxo **consome** o comando até `completed` / tenant `purged` |

## Schema

| Store | Versão | Alteração |
| --- | --- | --- |
| Clinic DO SQLite | **15** (`0015_contact_retention`) | `contact_deletion_tombstones`; `clinic_purge_state` |
| Admin D1 | **13** (`0013_tenant_purge`) | Colunas de progresso em `tenant_deletion_commands`; tabela `purged_tenants`; status tenant `purged` |

## Fluxo — exclusão de contacto

1. Owner com `clinic.contacts.delete` → `DELETE /api/tenants/:id/contacts/:contactId`.
2. TX no DO: soft-delete anexos meta → apaga IA/mensagens/conversas/oportunidades → anonimiza compromissos (`contact_label = «Contacto removido»`) → tombstone `wa_id` → apaga contacto → audit **sem** PII → outbox `contact.deleted`.
3. Worker apaga objectos R2 pelos ids devolvidos (fora de `transactionSync`).
4. Replay webhook/job com o mesmo `wa_id` → ingest **suprimido** (`suppressedTombstone`); não recria contacto.

### UI no painel (Confirmado neste polish)

- Ficha do contacto (Conversas → contacto): zona «Excluir contacto» **só para owner**.
- Confirmação destrutiva (React Aria `Modal`/`Dialog`); sucesso/erro sem PII no cliente (sem `console.log` de nome/telefone).
- Atendente não vê a acção; API continua a negar `clinic.contacts.delete`.

## Fluxo — expurgo de tenant (processo durável)

Fonte de verdade operacional: máquina de estados em `tenant_deletion_commands` + barreiras `purged_tenants` (anti-replay).

`claim` → `integrations_frozen` → `push_cleared` → `r2_prefix_cleared` → `clinic_sqlite_wiped` → `d1_scrubbed` → `financial_noted` → `completed`

| Passo | Efeito |
| --- | --- |
| claim | `queued`→`in_progress`; garante `deadline_at = pending_deletion_at + 30d` |
| integrations_frozen | Liberta binding WhatsApp (webhooks deixam de rotear) |
| push_cleared | Apaga `push_subscriptions` do tenant |
| r2_prefix_cleared | Lista+apaga `tenants/{id}/attachments/` |
| clinic_sqlite_wiped | RPC DO: wipe tabelas operacionais; idempotente |
| d1_scrubbed | Revoga memberships; cancela convites; limpa `detail_json` de receipts |
| financial_noted | Regista política **Em aberto** (sem reter PHI) |
| completed | `purged_tenants` + `tenants.status=purged` |

Alerta de atraso: audit `tenant.purge.deadline_alert` a ≤3 dias do deadline ou após vencimento (relógio injectável nos testes).

### Drivers (Confirmado / Proposto / Em aberto)

| Driver | Estado | Quando |
| --- | --- | --- |
| Máquina sync `tickTenantPurge` | **Confirmado** | CI/unit com `syncAdminDbFactory` (node:sqlite); harness sintético |
| Cloudflare Workflow `TENANT_PURGE` / `TenantPurgeWorkflow` | **Confirmado** (binding + classe) | Produção/runtime: `step.do` por checkpoint com retries; arranque em `DELETE` tenant e `purge/tick` |
| Tick D1 pontual `tickTenantPurgeOnEnv` | **Confirmado** | Fallback sem Workflow ou `useWorkflow=false` |
| Provisionamento do Workflow em **staging** na conta CF do projecto | **Em aberto** | Contrato em `wrangler.jsonc` `env.staging`; CI não exige secrets live |
| Cron / drain automático de comandos presos | **Proposto** | Schedules no binding — não bloqueia MVP sintético |

Idempotência da instância: `tenant-purge-{commandId}`. Re-create com o mesmo id reutiliza a instância (anti-replay). Guards `purged_tenants` / ingest freeze **não** mudam.

## APIs

| Método | Path | Quem |
| --- | --- | --- |
| DELETE | `/api/tenants/:tenantId/contacts/:contactId` | owner (`clinic.contacts.delete`) |
| GET | `/api/platform/tenants/:tenantId/purge` | superadmin |
| POST | `/api/platform/tenants/:tenantId/purge/tick` | superadmin (`runUntilDone` / Workflow) |
| POST | `/api/f6/retention/purge-run` | harness (`clinic-demo-*`) |
| DELETE | `/api/platform/tenants/:tenantId` | superadmin — enfileira comando + arranca Workflow se binding existir |

## Barreiras anti-reintrodução

| Vector | Guard |
| --- | --- |
| Ingest / upsert contacto | Tombstone por `wa_id` |
| Fila WhatsApp | `assertTenantAcceptsClinicalIngest` — ack sem mutar se `purged` / `pending_deletion` |
| Restore / rebind | `purged_tenants` + status `purged`; memberships revogados |
| Evidência de exclusão | Audit sem corpos, nomes ou `wa_id` |
| Workflow create | Id estável por `commandId` |

## Em aberto / fora deste recorte

- Revisão jurídica LGPD (VAL-09 / [legal-review-brief.md](../product/legal-review-brief.md)) antes de dados reais
- Retenção mínima de logs/auditoria central e de cobranças no provedor Pix (Q5/Q10)
- Binding Workflow **provisionado** em staging/prod na conta Cloudflare do projecto (contrato já declarado)
- Observabilidade operacional — ver [#44](f6-ops.md)

## Testes

- `src/clinic/retention/retention.test.ts` — cascade, anonimização, tombstone, isolamento A/B, wipe idempotente
- `src/retention/retention.test.ts` — máquina de estados, deadline 30d, alerta, gate pós-purga
- `src/retention/workflow-start.test.ts` — no-op sem binding; create/reuse idempotente
- `src/client/panel/screens/inbox/InboxContact.delete.test.tsx` — owner vs attendant; confirmação; erro sem PII
- Matriz de permissões: attendant **sem** `clinic.contacts.delete`
- Harness: `ADMIN_SCHEMA_VERSION = 13`, `CLINIC_SCHEMA_VERSION = 15`
