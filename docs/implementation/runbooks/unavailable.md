# Runbook — Indisponibilidade

**Estado:** Proposto · #44 · JRN-07 / REQ-042

## Sintomas

- `/api/health` falha ou timeout
- Painel mostra desconexão WebSocket persistente
- Filas com lag; erros 5xx em massa nos logs Workers Observability

## Triagem (sem PII)

1. Confirmar `ENVIRONMENT` e Worker name (`tredane-dev-staging` / production).
2. Filtrar logs por `channel` + `event` + `tenantId` interno (nunca abrir corpo de mensagem).
3. Separar: Worker (HTTP) vs Clinic DO (RPC/WS) vs D1 vs Queue vs R2 vs provedor externo (Meta/Pix/AI).
4. Verificar alertas `schema.mismatch`, `dlq.depth`, `outbox.stale`.

## Acções

| Componente | Acção segura | Evitar |
| --- | --- | --- |
| Worker | Redeploy última versão conhecida boa | Deploy com placeholder D1 |
| DO | Reinício por cold start (tráfego); ensaio `/api/f6/ops/recovery/rehearse` em sintético | Wipe de clínica real sem comando de purge |
| D1 | Conferir `admin_schema_state`; não aplicar migração ad-hoc | `DROP` / push Drizzle remoto |
| Queue | Pausar consumer só se documentado; drenar DLQ via reprocess.md | Ack cego de DLQ |
| Meta/Pix | Marcar integração degradada no painel; operação manual | Reenviar cobranças/mensagens em massa |

## Critério de saída

Health ok; lag de fila abaixo do budget Proposto; sem novos `alert.*` critical; painel reconcilia após reconexão (AC-12).
