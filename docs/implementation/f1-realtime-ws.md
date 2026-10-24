# F1 — WebSockets, reconciliação e revogação D1/DO

**Estado:** implementação da issue [#23](https://github.com/intentzero/tredane/issues/23) (épico [#14](https://github.com/intentzero/tredane/issues/14)). Protocolo WS hibernável, fence de entrega, catch-up HTTP e revogação imediata por tenant. **Sem** telas produtivas do painel (#22; biblioteca Confirmada em DEC-048 — React Aria). Dados sintéticos apenas.

## Decisão e protocolo (Confirmado — DEC-004/026/038; ADR-0003/0009/0012)

| Camada | Responsabilidade |
| --- | --- |
| Worker Hono | Clerk/sessão + membership D1 no handshake; monta headers internos; revoke HTTP |
| D1 central | Fonte autoritativa de membership/tenant; ponto de corte após `UPDATE` confirmado |
| Clinic DO + SQLite | Eventos versionados, fence local de denials, fan-out pós-persistência, hibernação |
| UI (biblioteca) | Estados `live` / `offline` / `reconnecting` / `access_revoked` — sem tela de produto |

### Ponto de corte

1. Revogação confirma-se no **D1** (`membership.revoke` auditado).
2. Desde a confirmação, HTTP e novo handshake WS resolvem membership vigente — **fail closed**.
3. Sinal best-effort ao DO (`applyUserFence`): grava denial local, envia `access_revoked` (sem payload clínico) e fecha sockets do utilizador.
4. Em **toda entrega** de evento clínico: fence local **ou** revalidação D1; se autoridade indisponível → **não entrega** (não degrada para permissivo).
5. Falha de notificação DO **não** reverte o D1; reconexão/hibernação com membership revogado continua negada.

### Attachment hibernável

Metadados mínimos (`connectionId`, `clerkUserId`, `sessionId`, `role`, `tenantId`, `authEpoch`, `connectedAt`). **Sem tokens** nem conversas.

### Reconciliação (REQ-041/042)

- Eventos com `seq` monotónico por clínica em `realtime_events`.
- `GET /api/tenants/:id/realtime/events?after=N` e `.../snapshot` após reconnect.
- `mergeEventsById` evita duplicar itens se o mesmo evento chegar por WS e HTTP.

## Rotas

| Método | Caminho | Notas |
| --- | --- | --- |
| GET | `/api/tenants/:tenantId/ws` | Upgrade autenticado → DO |
| GET | `/api/tenants/:tenantId/realtime/events` | Catch-up |
| GET | `/api/tenants/:tenantId/realtime/snapshot` | Contactos + `eventSeq` |
| POST | `/api/tenants/:tenantId/members/:clerkUserId/revoke` | Owner remove attendant; propaga fence |

Harness (não produto): `/api/f1/clinic/.../authority-override`, `revalidate-sockets`.

## Código

| Área | Caminho |
| --- | --- |
| Protocolo / fence / fan-out / revoke | `src/realtime/` |
| Migração DO v2 | `src/clinic/migrations/0002_realtime_fence.ts` |
| DO | `src/worker/clinic-do.ts` |
| Testes | `src/realtime/*.test.ts`, `runtime.harness.test.ts` |

## Critérios vs evidência

| Aceite | Evidência |
| --- | --- |
| Revogar A bloqueia leituras/escritas/eventos/sockets A; B e Clerk OK | unit HTTP + runtime WS |
| Revogação × fan-out, cache positivo antigo, unavailable, falha DO | `realtime.test.ts`, harness authority-override |
| Duas sessões A convergem; B sem payload | fan-out unit + runtime catch-up |
| Perda de autoridade não vira acesso permissivo | fail-closed em `deliverEventToSockets` |

## Fora deste PR

- Login UI / seletor — entregue em [#22](f1-login-nav.md)
- Ciclo completo de suporte WS (DEC-029–037) — fence reutilizável já exposto (`FenceSource`)
- Domínio F2/F3 (agenda/pipeline/WhatsApp completo)
