# F1 — Sessão própria de suporte, TTL e encerramento (#27)

**Estado:** implementação da issue [#27](https://github.com/intentzero/tredane/issues/27) (épico [#14](https://github.com/intentzero/tredane/issues/14)). API Platform Admin + Clinic App (estado/revogação/aviso) + e-mail de início simulado + fan-out owners+subject. **Sem** UI de login/banner (#22). Dados sintéticos apenas.

## Decisões aplicadas (Confirmado)

| DEC / ADR | Comportamento neste entrega |
| --- | --- |
| DEC-032 / ADR-0007 | `activated_at` + `expires_at = +30min`; sem renovação por handoff/uso/refresh |
| DEC-033 | Sem `extend`/`renew`; continuidade = novo pedido + aprovação |
| DEC-034 | Owner ativo ou actor encerra; corte HTTP + cookie; auditoria |
| DEC-035 | E-mail de início idempotente por sessão/destinatário; **sem** e-mail de fim |
| DEC-036 | Notice ao subject; owners no painel; outros attendants não |
| DEC-037 | Subject pede encerramento (idempotente); owner Encerrar/Manter; TTL intacto |
| ADR-0007 | Handoff one-shot → cookie `tredane_support` HttpOnly; hash no D1; CSRF Origin em cookie transport; binding `actor_clerk_session_id` |

## Migração `0007_support_session_email.sql`

- Template `support_session_started` + coluna `support_session_id`.
- `admin_schema_state.version = 7`.

## Rotas

| Método | Caminho | Authz |
| --- | --- | --- |
| POST | `/api/platform/support-requests/:id/activate` | superadmin actor do pedido |
| POST | `/api/support/handoff` | superadmin; body `{ handoffCode }`; Set-Cookie |
| GET | `/api/support/session` | superadmin + cookie |
| POST | `/api/support/session/extend` | **405** (DEC-033) |
| POST | `/api/platform/support-sessions/:id/end` | actor da sessão |
| GET | `/api/tenants/:tenantId/support-sessions` | owner |
| GET | `/api/tenants/:tenantId/support-sessions/notice` | subject (membership) |
| POST | `/api/tenants/:tenantId/support-sessions/:id/revoke` | owner |
| POST | `.../termination-requests` | subject |
| POST | `.../termination-requests/:id/decision` | owner `{ decision: end\|keep }` |

Escritas sensíveis: `assertSupportOperationAllowed` — só leitura/diagnóstico até política explícita.

## Eventos tempo real

- `support.session.started` / `support.session.ended` / `support.termination.*` com `audience: owners_and_subject` (ou `owners` no pedido de encerramento).
- Filtro em fan-out/catch-up por role + `subjectClerkUserId`.

## Testes

- Domínio: `admin.test.ts` (handoff one-shot, TTL 30min, auditoria sem segredos)
- HTTP: `support/session.http.test.ts` — replay, CSRF cookie, tenant forjado, timeout exacto, cookie antigo, O2 revoga, notice subject, termination idempotente, membership corta sessão, sem e-mail de fim

## Fora / lacunas

- UI Clinic App banner/botões (#22)
- Caminho D1 assíncrono Worker sem `syncAdminDbFactory` (rotas de sessão exigem AdminDb sync nos testes; produção precisa de ops D1 espelhadas ou adapter)
- Provedor de e-mail real; política de capacidades de escrita; revisão de segurança
- Fence WS dedicado ao actor de suporte (corte via evento + cookie; handshake WS de suporte ainda não existe)
