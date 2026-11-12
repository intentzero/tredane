# F1 — Login, seletor de clínica e navegação mobile first

**Estado:** implementação da issue [#22](https://github.com/intentzero/tredane/issues/22) (épico [#14](https://github.com/intentzero/tredane/issues/14)). Clinic App com Clerk (ou synthetic local), seletor multi-tenant, shell React Aria e isolamento por aba. **Sem** conteúdo de Conversas/Agenda/Pipeline (F2+). Platform Admin continua superfície separada (#24). Dados sintéticos apenas.

## Decisões aplicadas (Confirmado)

| DEC / ADR | Comportamento |
| --- | --- |
| DEC-039 | Mobile first desde 360 px; desktop amplia largura |
| DEC-041 | Inter + Lucide + tokens v0.2; alvos ≥44 px; safe-area |
| DEC-045 | Nav «Acompanhar»; título da tela «Acompanhamento» |
| DEC-048 / ADR-0013 | React Aria Components — sem Radix |
| DEC-007 / REQ-005 | Login ≠ membership; seletor só com >1 clínica |
| DEC-042 | Aba Clínica só `role === owner` |
| DEC-017 | Sem Clerk Organizations |

## Rotas do cliente

| Path | Ecrã |
| --- | --- |
| `/entrar` (+ `/entrar/*` Clerk) | Login |
| `/cadastro` (+ `/cadastro/*` Clerk) | Cadastro (DEC-021); entrada por defeito do link de convite sem sessão |
| `/invite/accept` | Aceite de convite (S3); `?token=` guardado na sessão e retirado da barra; sem sessão → `/cadastro` |
| `/clinicas` | Seletor (M-10) |
| `/c/:tenantId/conversas` | Shell + placeholder |
| `/c/:tenantId/acompanhamento` | Shell + placeholder |
| `/c/:tenantId/agenda` | Shell + placeholder |
| `/c/:tenantId/clinica` | Owner only; attendant → sem permissão |

## APIs usadas

| Método | Path | Notas |
| --- | --- | --- |
| GET | `/api/auth/client-config` | público — `authMode` + publishable key |
| GET | `/api/me` | sessão |
| GET | `/api/me/tenants` | inclui `name` (#22) |
| GET | `/api/tenants/:id/context` | membership vigente |

## Auth no browser

- **`AUTH_MODE=synthetic` (dev):** UI no estilo M-09 + escolha de persona `user_synth_*`; Bearer `synth:<id>` em sessionStorage (por aba).
- **`AUTH_MODE=clerk`:** `@clerk/react` `<SignIn />` em `/entrar` e `<SignUp />` em `/cadastro` (estilizados); `getToken()` → Bearer no Worker. Com convite pendente, `signUpUrl` no SignIn aponta para `/cadastro` (não para si mesmo).

Clínica ativa: `sessionStorage` por aba (AC-17). Troca cancela `AbortController` e incrementa geração — respostas tardias de A não pintam B.

## Código

| Área | Path |
| --- | --- |
| Painel | `src/client/panel/` |
| Estilos | `src/client/ui/panel.css` |
| Testes | `src/client/panel/*.test.tsx`, `src/auth/http.test.ts` |

## Passos humanos no Clerk Dashboard (obrigatórios para `AUTH_MODE=clerk`)

1. Aplicação **sem Organizations**.
2. Método de login: **e-mail + código** (passwordless / email code). Sem MFA (DEC-028).
3. Copiar Publishable + Secret → `.dev.vars` / secrets Wrangler.
4. `CLERK_AUTHORIZED_PARTIES` inclui a origem da Clinic App (ex. `http://localhost:5173`).
5. Paths: permitir `/entrar` e `/cadastro` (e factor paths dos componentes SignIn/SignUp).
6. **Access mode → Open** (API `sign_up_mode=public`). **Não** deixe Invite-only / Restricted: o SignUp mostra «Acesso restrito / Cadastros estão desabilitados…» e o convite D1 (ADR-0008) **não** gera ticket Clerk — o produto não contorna Restricted. O gate de quem entra na clínica continua a ser o aceite do convite Tredane, não o Access mode.
7. Memberships continuam no D1 — criar utilizadores Clerk e mapear `clerk_user_id` nas memberships (não há auto-membership no login; aceite do convite cria o vínculo).

## Cadastro transparente (UX)

Confirmado (paridade Legal Layer / DEC-021): `/cadastro` e `/entrar` usam `clerkAppearance` com `options.elevation: 'flush'`, `logoPlacement: 'none'`, fundo transparente e marca Tredane fora do Clerk. Isto só estiliza o formulário; se Access mode estiver Invite-only, o cartão Restricted continua a bloquear o cadastro até o passo 6.

Dead-end guard (convidada): se o `<SignUp />` pintar cabeçalho/«Entrar» **sem** campo de e-mail/OTP após ~8s com Clerk loaded (Restricted ou falha), o painel mostra «Cadastro indisponível» **sem desmontar** o SignUp (só esconde) — hydrate/captcha tardio ou «Tentar novamente» recuperam sem reload. Mantém o lead do convite até haver `input` real.

## Fora deste PR

- Conteúdo Inbox / Acompanhamento / Agenda (#29+)
- UI Platform Admin
- Pedidos de suporte (#26)
- PWA / push (#42); VoiceOver em aparelho (Q-UX-01)
