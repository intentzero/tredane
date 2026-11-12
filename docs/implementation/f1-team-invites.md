# F1 — Equipe, convites por e-mail e remoção de attendants

**Estado:** implementação da issue [#25](https://github.com/intentzero/tredane/issues/25) (épico [#14](https://github.com/intentzero/tredane/issues/14)). API Equipe + convites + e-mail simulado + remoção com barreira D1→DO (#23). UI login/nav = [#22](f1-login-nav.md). **S1 UI Equipe (lista + convite + pendentes)** na Clinic App: `EquipeScreen`, hub sem «Em breve», copy **Atendente**, enriquecimento nome+e-mail no GET `/team` (DEC-102). **S2 UI remoção:** owner confirma e chama `POST …/members/:clerkUserId/revoke`; lista atualiza. **S3 aceite do link:** rota `/invite/accept` → login se preciso → `POST /api/invitations/accept` → entrada na clínica (`AcceptInviteScreen`). **DEC-103 (01/11/2026):** owner convida `role=owner`, promove attendant→owner, despromove owner→attendant e remove outros owners, com `last_owner_protected`. Dados sintéticos apenas.

## Decisões aplicadas (Confirmado)

| DEC / ADR | Comportamento neste entrega |
| --- | --- |
| DEC-021 / ADR-0008 | Owner convida no próprio tenant; aceite com Clerk + e-mail verificado correspondente |
| DEC-022 | Validade 7 dias (168 h); `expires_at` no servidor; login não prolonga |
| DEC-023 | Reenvio roda token + novo prazo 7 dias; token anterior inválido na mesma operação |
| DEC-024 | Cooldown 10 min; máx. 5 reenvios / 24 h por `(tenant, e-mail)`; bloqueio **não** invalida link vigente |
| DEC-025 | Qualquer owner do tenant cancela pending; não altera memberships |
| DEC-026 / ADR-0009 | Remoção usa `POST .../members/:id/revoke` + fence DO; B preservado; sem logout Clerk |
| DEC-020 / **DEC-103** | Owner gere attendants e outros owners na Equipe (convidar/promover/despromover/remover); último owner protegido; Platform Admin continua |

## Transporte de e-mail

**Confirmado (F1 + Paulo 2026-11-11):** adaptador testável `simulated` (development/CI) com fila `email_delivery_jobs`, retentativas e idempotência por `inv:{invitationId}:{tokenHash}`. Em staging/prod: **Cloudflare Email Sending** via binding Workers `EMAIL` (`EMAIL_TRANSPORT=cloudflare`, `EMAIL_FROM=noreply@tredane.com`, `APP_BASE_URL` pública). Token em claro só no payload do send — **nunca** em D1, auditoria, logs ou resposta HTTP. Sem binding/`EMAIL_FROM` → fail-closed (`emailSent: false`); a UI Equipe **não** mostra «Pronto».

**Ops (gate Paulo antes do Deploy live):** Workers Paid na conta Tredane; Onboard Domain `tredane.com` no Email Service (preferir `mail.tredane.com` só se MX/SPF da raiz conflitar — From fica `noreply@tredane.com` salvo o onboard forçar subdomínio). Não activar Email Routing na raiz se já houver MX externo. Sem secret de API no path binding.

**Em aberto:** política fina de bounces/suppressions (ADR-0008); «Copiar link» no painel.

## Migrações relevantes

- `0005_email_delivery_jobs.sql` — tabela `email_delivery_jobs` (status, tentativas, `idempotency_key` único).
- **`0015_invitation_owner_role.sql` (DEC-103)** — rebuild de `tenant_invitations` para `role IN ('owner','attendant')`; `admin_schema_state.version = 15`.

## Rotas

| Método | Caminho | Authz |
| --- | --- | --- |
| GET | `/api/tenants/:tenantId/team` | membership; `manageActions` (canRevoke / canPromote / canDemote); membros com `displayName` + `email` (DEC-102) |
| POST | `/api/tenants/:tenantId/invitations` | owner; body `{ email, role?: 'attendant' \| 'owner' }` (default attendant) |
| POST | `.../invitations/:id/resend` | owner; 429 + `retryAfterMs` em cooldown/quota |
| POST | `.../invitations/:id/cancel` | owner do mesmo tenant |
| POST | `/api/invitations/accept` | sessão Clerk + e-mail verificado; ignora tenant/role do body; aplica role do D1; best-effort `invitation.accepted` no DO da clínica (`audience: owners`, DEC-038) para Equipe em tempo real |
| POST | `/api/tenants/:tenantId/members/:clerkUserId/promote` | owner — attendant→owner |
| POST | `/api/tenants/:tenantId/members/:clerkUserId/demote` | owner — owner→attendant; `last_owner_protected` |
| POST | `/api/tenants/:tenantId/members/:clerkUserId/revoke` | owner — attendants e owners; `last_owner_protected`; barreira #23 |

Código: `src/team/`, `src/email/`, e-mail verificado em `src/auth/verified-email.ts`. Remoção já em `src/realtime/routes.ts`.

## Testes

- Domínio: `src/db/admin/admin.test.ts` (rotação, quota, corrida, cancel)
- Entrega: `src/email/delivery.test.ts` (retry sem convite extra; token fora da audit)
- HTTP: `src/team/http.test.ts` (AC-21–23, limites, e-mail errado/não verificado, corridas)
- Harness: aceite D1 + revoke; tenant B preservado

## Aceite no painel (S3)

| Peça | Comportamento |
| --- | --- |
| Link | `APP_BASE_URL/invite/accept?token=…` (Cloudflare Email Sending em staging/prod; simulated em dev) |
| Sessão | Sem sessão → guarda token em `sessionStorage` (nunca logado) → **`/cadastro`** (formulário Legal Layer **Nome** + e-mail→código via `useSignUp`; DEC-021 conta nova; DEC-172 Proposto / DEC-043 / DEC-102) → após autenticação retoma aceite; quem já tem conta usa «Entrar» → `/entrar` e volta ao aceite. Contas novas sem Nome ficavam só com e-mail na Conta/Equipe. **Pré-requisito Dashboard:** Access mode **Open** — Invite-only falha no create com «Cadastro indisponível» (token D1 não contorna Restricted; ver [f1-login-nav.md](f1-login-nav.md)). |
| API | `acceptInvitation(token)` no cliente; Worker ignora tenant/role do body |
| Erros | Expirado / inválido-cancelado / e-mail diferente / e-mail não confirmado em PT-BR |
| Sucesso | Membership com a role do convite → abre Conversas da clínica (ou seletor se a abertura falhar) |
| Tempo real (Equipe) | Após aceite, owners com Clínica → Equipe aberta recebem `invitation.accepted` no WS do DO; `EquipeScreen` refaz `GET /team` (sem refresh). Falha do fan-out **não** reverte o membership. |

## Fora da API #25 / ainda em fatias

- Controles antiabuso globais (IP/owner) além de DEC-024
- Notificação ao destinatário quando o convite é cancelado (**Em aberto** ADR-0008)
- Eventos WS para create/cancel/promote/demote/revoke entre owners (só `invitation.accepted` neste recorte)
- Faixa TEL-10 (suporte) dentro de Equipe
- Smoke inbox real pós-Deploy (domínio onboarded + Workers Paid)
