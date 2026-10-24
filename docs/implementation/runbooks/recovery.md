# Runbook — Recuperação por clínica (D1 / DO / R2)

**Estado:** Proposto · #44 · DEC-038 · ADR-0012

## Objectivo

Restaurar ou reconciliar a clínica A **sem** alterar B, **sem** reenviar WhatsApp/Pix, **sem** reativar membership/suporte expirado ou revogado.

## Ensaio local (disponível agora)

```bash
# Com Worker local + auth synthetic:
# POST /api/f6/ops/recovery/rehearse
npm run ops:smoke
```

O relatório confirma schema (`ADMIN_SCHEMA_VERSION` / `CLINIC_SCHEMA_VERSION`), coerência do prefixo R2 e isolamento de contagens B.

## Compatibilidade de schema

| Store | Esperado | Acção se divergir |
| --- | --- | --- |
| D1 `admin_schema_state` | versão do código | Aplicar migrações revistas; **não** placeholder |
| DO `clinic_schema_state` | `CLINIC_SCHEMA_VERSION` | Boot DO corre migrações; se `failed`, investigar antes de tráfego |
| R2 prefixo `tenants/{id}/attachments/` | listável | Recriar bucket só se vazio/errado; objectos órfãos = limpeza controlada |

## PITR (Em aberto — live)

Documentação Cloudflare: PITR de SQLite DO até ~30 dias. **Este repositório não executa restore remoto.** Quando a conta staging existir:

1. Identificar `tenantId` e instante alvo (RPO/RTO **Em aberto** com produto).
2. Restore **só** do DO de A.
3. Reconciliar D1: memberships/suporte pelo estado **actual** do D1 (não pelo snapshot antigo).
4. Reconciliar R2: listar prefixo; objectos em falta ≠ recriar de webhook.
5. Meta/Pix: leitura de estado; **proibido** reenviar mensagem ou recriar charge.
6. Correr ensaio de isolamento A/B.

## Rollback de deploy

1. `wrangler rollback` / redeploy do artefact anterior.
2. Se migração D1 já aplicada e incompatível: plano de forward-fix (nova migração); rollback SQL só com revisão explícita.
3. Smoke + `check:env`.

## Critério de aceite (AC #44)

Recuperar A não altera B; membership/suporte expirado não revive; dados excluídos permanecem excluídos (tombstones / `purged_tenants`).
