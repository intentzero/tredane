# F1 — Equipe, convites por e-mail e remoção de attendants

**Estado:** implementação da issue [#25](https://github.com/intentzero/tredane/issues/25) (épico [#14](https://github.com/intentzero/tredane/issues/14)). API Equipe + convites + e-mail simulado + remoção com barreira D1→DO (#23). UI login/nav = [#22](f1-login-nav.md). **S1 UI Equipe (lista + convite + pendentes)** na Clinic App: `EquipeScreen`, hub sem «Em breve», copy **Atendente**, enriquecimento nome+e-mail no GET `/team` (DEC-102). **S2 UI remoção:** owner confirma e chama `POST …/members/:clerkUserId/revoke`; lista atualiza; owners sem ação (DEC-020). Aceite do link = S3. Dados sintéticos apenas.

## Decisões aplicadas (Confirmado)

| DEC / ADR | Comportamento neste entrega |
| --- | --- |
| DEC-021 / ADR-0008 | Owner convida só `attendant` no próprio tenant; aceite com Clerk + e-mail verificado correspondente |
| DEC-022 | Validade 7 dias (168 h); `expires_at` no servidor; login não prolonga |
| DEC-023 | Reenvio roda token + novo prazo 7 dias; token anterior inválido na mesma operação |
| DEC-024 | Cooldown 10 min; máx. 5 reenvios / 24 h por `(tenant, e-mail)`; bloqueio **não** invalida link vigente |
| DEC-025 | Qualquer owner do tenant cancela pending; não altera memberships |
| DEC-026 / ADR-0009 | Remoção usa `POST .../members/:id/revoke` + fence DO; B preservado; sem logout Clerk |
| DEC-020 | Owners listados na Equipe **sem** ações de gestão pela clínica |

## Transporte de e-mail (Em aberto → simulador)

**Confirmado para F1:** adaptador testável `simulated` com fila `email_delivery_jobs`, retentativas e idempotência por `inv:{invitationId}:{tokenHash}`. Token em claro só no payload em memória / mailbox de teste — **nunca** em D1, auditoria, logs ou resposta HTTP.

**Em aberto (produto):** provedor real (Resend, SES, etc.), remetente, bounces e política de dados. Envio real bloqueado até escolha + configuração. Variáveis: `EMAIL_TRANSPORT=simulated` (default em development), `APP_BASE_URL`.

## Migração `0005_email_delivery_jobs.sql`

- Tabela `email_delivery_jobs` (status, tentativas, `idempotency_key` único).
- `admin_schema_state.version = 5`.

## Rotas

| Método | Caminho | Authz |
| --- | --- | --- |
| GET | `/api/tenants/:tenantId/team` | membership; owners sem `canRevoke`; membros com `displayName` + `email` (DEC-102, Clerk Backend / sintético) |
| POST | `/api/tenants/:tenantId/invitations` | owner (`clinic.members.invite_attendant`) |
| POST | `.../invitations/:id/resend` | owner; 429 + `retryAfterMs` em cooldown/quota |
| POST | `.../invitations/:id/cancel` | owner do mesmo tenant |
| POST | `/api/invitations/accept` | sessão Clerk + e-mail verificado; ignora tenant/role do body |
| POST | `/api/tenants/:tenantId/members/:clerkUserId/revoke` | owner — barreira #23 |

Código: `src/team/`, `src/email/`, e-mail verificado em `src/auth/verified-email.ts`. Remoção já em `src/realtime/routes.ts`.

## Testes

- Domínio: `src/db/admin/admin.test.ts` (rotação, quota, corrida, cancel)
- Entrega: `src/email/delivery.test.ts` (retry sem convite extra; token fora da audit)
- HTTP: `src/team/http.test.ts` (AC-21–23, limites, e-mail errado/não verificado, corridas)
- Harness: aceite D1 + revoke; tenant B preservado

## Fora da API #25 / ainda em fatias

- Aceite do link no painel (S3)
- Provedor de e-mail real e secrets de produção
- Controles antiabuso globais (IP/owner) além de DEC-024
- Notificação ao destinatário quando o convite é cancelado
- Faixa TEL-10 (suporte) dentro de Equipe
