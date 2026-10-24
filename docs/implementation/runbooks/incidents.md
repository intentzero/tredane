# Runbook — Incidentes do piloto

**Estado:** Proposto · #44 · REQ-070 / AC-15

## Severidade

| Severidade | Exemplos | Resposta |
| --- | --- | --- |
| critical | DLQ a crescer, schema mismatch, falha Meta/Pix em massa, vazamento cross-tenant | Interromper deploys; runbook unavailable + reprocess; escalar produto |
| warning | Outbox stale, IA indisponível, purge perto do deadline | Diagnosticar com correlação; prazo interno |
| info | Revogação esperada, smoke falhou em harness | Registo; sem page |

## Correlação

Campos obrigatórios nos logs técnicos:

- `correlationId`, `tenantId` (id interno), `channel`, `event`, `operation`, `stage`, `outcome`

Proibidos: corpos, telefones, tokens, nomes, e-mails, params de modelo.

Validar scrub: `POST /api/f6/ops/log/scrub-check`.

## Comunicação

- Interno: ticket com IDs técnicos e `correlationId` — **sem** colar payloads.
- Clínica piloto: linguagem do painel (estado compreensível); sem jargão de fila.
- Dados reais: só após GATE-04; até lá apenas sintéticos.

## Pós-incidente

1. Linha do tempo com correlationIds.
2. Falha injectável reproduzida no harness quando possível.
3. Actualizar limiares Propostos se a medição live divergir (não promover a Confirmado sem revisão).
4. Ligar a AC-15 / REQ-013 se houver lacuna de observabilidade.
