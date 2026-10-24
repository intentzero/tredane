# F1 — Pedidos de suporte e aprovação pelo owner

**Estado:** implementação da issue [#26](https://github.com/intentzero/tredane/issues/26) (épico [#14](https://github.com/intentzero/tredane/issues/14)). API Platform Admin + Clinic App (decisão) + e-mail informativo simulado + fan-out WebSocket só a owners. **Sem** UI de login/biblioteca (#22). **Sem** ativação de sessão/handoff — isso é [#27](https://github.com/intentzero/tredane/issues/27). Dados sintéticos apenas.

## Decisões aplicadas (Confirmado)

| DEC / ADR | Comportamento neste entrega |
| --- | --- |
| DEC-029 / ADR-0011 | Pedido `pending` sem acesso clínico; owner ativo do tenant aprova/rejeita; primeira decisão atómica no D1 + auditoria |
| DEC-030 | Painel (GET + eventos WS `audience: owners`) + e-mail com link autenticado **sem** token/handoff/PHI; decisão só no painel |
| DEC-031 | `expires_at = created_at + 24h` (UTC servidor); aprovação/rejeição exigem `pending` e `now < expires_at` |
| ADR-0006 | Superadmin cria na Platform Admin; não herda capacidades clínicas |
| Arquitetura | Aprovação ≠ ativação: `POST .../decision` **não** cria `support_sessions` nem handoff (#27) |

## Migração `0006_support_request_email.sql`

- Alarga `email_delivery_jobs.template` com `support_access_request`.
- `invitation_id` nullable; nova coluna `support_request_id`.
- `admin_schema_state.version = 6`.

## Rotas

| Método | Caminho | Authz |
| --- | --- | --- |
| POST | `/api/platform/support-requests` | superadmin (`platform.support.request`) |
| GET | `/api/platform/support-requests/:id` | superadmin |
| GET | `/api/tenants/:tenantId/support-requests` | owner (`clinic.support.decide`) |
| GET | `/api/tenants/:tenantId/support-requests/:id` | owner do tenant |
| POST | `/api/tenants/:tenantId/support-requests/:id/decision` | owner; body `{ decision: 'approve' \| 'reject' }` |

Respostas de decisão incluem `accessGranted: false`, `session: null`, `handoff: null`.

Código: `src/support/`, e-mail em `src/email/`, fan-out `ClinicDurableObject.publishTenantEvent` + filtro `audience` em `src/realtime/`.

## Eventos tempo real

- `support.request.created` / `support.request.decided` com `audience: 'owners'`.
- Catch-up HTTP `/realtime/events` filtra pelo role do caller.
- Owners removidos: membership deny → sem entrega (barreira #23).

## Testes

- Domínio: `admin.test.ts` (aprovação sem sessão; ativação/handoff só via `activateSupportSession` de domínio para #27)
- Audience: `realtime.test.ts`
- HTTP: `support/http.test.ts` (AC-27–29: pending/rejeitado/expirado/owner B; corrida; e-mail down; reconnect)

## Fora deste PR

- Ativação de sessão, handoff, cookie, TTL 30min, revogação de sessão — ver [#27](https://github.com/intentzero/tredane/issues/27) / [f1-support-session.md](f1-support-session.md)
- UI Clinic App / login (#22)
- Provedor de e-mail real
