# Staging — página web da cliente em 17/11/2026

**Estado:** registo operacional; itens **Confirmados** só onde houve verificação explícita.

## Deploy

| Campo | Valor |
| --- | --- |
| Worker | `tredane-dev-staging` |
| Versão (UUID) | `fd8c3d86-726a-40a7-a5a7-17d1f8de6395` |
| Conta Cloudflare | Tredane — `fc4be5a9597f5f05126209205ee98339` |
| Origem | PR #898 (branch `claude/tredane-web-scheduling-16450f`) |
| `CLIENT_WEB_ENABLED` | Em 17/11 estava `true` só em staging e produção respondia 404. **Revisto** em 18/11/2026 (Paulo, «tira a flag»): a variável saiu. |

## Base de dados

- Migrações D1 **`0027_client_web`** e **`0028_client_web_rate_limits`**: **aplicadas** em staging (**Confirmado**).

## CI / configuração

- **`CLOUDFLARE_ACCOUNT_ID`** no GitHub Environment `staging`: **Em aberto** — precisa de ser fixada como variable (conta `fc4be5a9597f5f05126209205ee98339`); ver [DEPLOY.md](../DEPLOY.md). Sem isto, o pipeline de deploy pode falhar.

## Verificado (17/11/2026)

- Casca `/c/*` com cabeçalhos esperados (`Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`, `X-Frame-Options: DENY`).
- `GET /api/c/state` sem cookie de sessão → **401**.
- `POST` nas rotas públicas sem cabeçalho `Origin` → **403**.
- Token inventado em `POST /api/c/exchange` → **410**.
- Tabelas `client_web_*` presentes no D1 de staging.
- Logs do Worker sem erros relevantes na verificação feita.

## Não verificado

- Teste de fumo **completo** com o interruptor «Agendamento por link» da owner ligado na clínica demo (passos 2–8 do [runbook](../implementation/runbooks/pagina-web-cliente.md)).
- Envio **real** do botão `cta_url` pela API da Meta.
- Uso num **telemóvel real** (browser interno do WhatsApp, recarregar, voltar).

## Risco operacional

**Proposto:** o próximo deploy automático da branch `main` para staging **substitui** esta versão do worker até o trabalho da página web estar na `main` e o pipeline publicar de novo.

## Ligações

- [Runbook pagina-web-cliente.md](../implementation/runbooks/pagina-web-cliente.md)
- [ADR-0018 §7a](../adr/0018-pagina-web-cliente.md)