# F5 — PWA instalável e push de nova conversa

**Estado:** implementação da issue [#42](https://github.com/intentzero/tredane/issues/42) (épico [#14](https://github.com/intentzero/tredane/issues/14)). DEC-039/040/041; Q-UX-01/05; JRN-01/07; M-14; UX-01–08. **Não** absorve preferências extras nem silêncio (Q-UX-05 Em aberto). Dados sintéticos / `PUSH_MODE=synthetic` até VAPID em staging/prod e aceite em aparelhos da clínica.

## Decisões aplicadas (Confirmado)

| DEC / REQ | Comportamento |
| --- | --- |
| DEC-039 | Painel mobile first; PWA sem app nativo no MVP |
| DEC-040 | Push de **nova conversa**; texto sem conteúdo da mensagem («Nova conversa na {clínica}») |
| DEC-041 | Ícone provisório (azul primary); marca definitiva Em aberto |
| DEC-026 / REQ-003 | Revogação remove assinaturas push do par user×tenant; deep link revalida Clerk + membership |
| Q-UX-05 | Só «Nova conversa» é requisito Confirmado; restantes toggles M-14 ficam **Propostos** / desactivados na UI |

## Schema D1 (migração 12)

`push_subscriptions` — endpoint único, tenant, `clerk_user_id`, keys Web Push, `notify_new_conversation`, timestamps.

`ADMIN_SCHEMA_VERSION = 12`.

## Fluxo

1. Cliente regista `public/sw.js` (cache só de assets estáticos; **nunca** `/api/*`).
2. Ecrã M-14 `/c/:tenantId/avisos` — instalação iPhone/Android + **Ativar avisos**.
3. `PushManager.subscribe` + `POST /api/tenants/:id/push/subscriptions`.
4. Ingest WhatsApp com `conversation.created` → `maybeNotifyNewConversationPush` (best-effort).
5. Envio revalida membership activa; 404/410 apagam a assinatura.
6. Logout / troca de clínica limpa caches do SW (UX-05).

## APIs

| Método | Path | Quem |
| --- | --- | --- |
| GET | `/api/push/vapid-public-key` | autenticado |
| GET/POST/DELETE | `/api/tenants/:id/push/subscriptions` | `clinic.inbox.read` |
| PATCH | `/api/tenants/:id/push/preferences` | `clinic.inbox.read` |
| POST | `/api/f5/push/notify-new-conversation` | harness (tenants `clinic-demo-*`) |

## Modos

| Modo | Uso |
| --- | --- |
| `PUSH_MODE=synthetic` (default) | Transporte em memória; CI sem FCM/APNs; VAPID estável de teste |
| `PUSH_MODE=live` | `@block65/webcrypto-web-push` + `VAPID_*` (secret) |

## Cache / offline

- Precache: manifest + ícones; assets com cache-first.
- Navegação: network-first; offline mostra aviso — **sem** fila de agenda/Pix como confirmada.
- Faixa «Sem ligação» no shell do painel.

## Em aberto / fora deste PR

- Aceite Safari iPhone / Chrome Android da clínica (Q-UX-01)
- Preferências atribuída / falha de envio / resposta / silêncio (Q-UX-05)
- Identidade visual definitiva do ícone PWA
- F6 observabilidade (#43)
