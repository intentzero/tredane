# Runbook — página web da cliente (agendar, remarcar e cancelar por link)

**Estado:** **Proposto** (DEC-196 a DEC-202, [ADR-0018](../../adr/0018-pagina-web-cliente.md)). Desde a DEC-202 o chat **não marca, não remarca e não cancela**: só informa e envia o link. **Confirmado** (Paulo, 18/11/2026, «tira a flag»): a página faz parte do aplicativo; não há `CLIENT_WEB_ENABLED` nem forma de a desligar. Dados reais continuam bloqueados pelo GATE-04.

## O que liga o quê

| Interruptor | Onde | Efeito |
| --- | --- | --- |
| Página | parte do Worker | `/api/c/*` e `/c/*` existem em qualquer ambiente. Não há var para as apagar. |
| `APP_BASE_URL` https | var do Worker | Base do link. Sem https o chat não emite o botão e passa à equipe. |
| Pausa da owner (limites das automações) | Clínica › Limites das automações | A página mostra as marcações, mas agendar, remarcar e cancelar ficam bloqueados com «Falar com a equipe»; o chat passa à equipe em vez de enviar o link (DEC-202). |

## Teste de fumo em staging (clínica demo)

1. Confirmar que a clínica demo tem serviços e profissionais. A página não depende de uma variável de ambiente.
2. A página está sempre ligada nas clínicas do ambiente (DEC-202): não há interruptor por clínica.
3. Pelo [MCP de laboratório](laboratorio-mcp.md) (`lab_say`): dizer «Oi», e depois «Quero marcar massagem amanhã às 10h» (o botão abre já na Massagem). Esperado, no «Oi»: uma mensagem com o expediente de hoje e o botão **«Abrir agenda»**; o `lab_state` mostra o botão de URL e **não** o token no corpo.
4. Abrir o URL num telemóvel (ou na vista móvel do navegador): a página mostra o nome da clínica e «Olá, <primeiro nome>»; o endereço passa a `/c` (sem token). Recarregar mantém a sessão (30 min).
5. Abrir **outra vez o mesmo URL**: «Este link já foi usado». Pedir outro no chat («Oi»): o link novo invalida o anterior.
6. Agendar: serviço → (zonas) → horário → Confirmar. Esperado: «Horário marcado», recibo no chat com «Marcado pela página. Não foi você?», marcação na agenda com o rótulo da cliente (web) e auditoria `appointment.client_web_booked`.
7. Remarcar e cancelar: dizer «quero remarcar» / «quero cancelar» no chat: o botão abre **direto** na marcação. Com sinal pago, a página pede à equipe em vez de cancelar.
8. Pausa da owner (Limites das automações): «quero marcar» no chat passa à equipe, sem botão; a página aberta mostra as marcações e bloqueia agendar, remarcar e cancelar.
9. Painel: Agendar → escolher serviço e horário → **Enviar link de agenda**. Esperado: a cliente recebe o botão «Abrir agenda» já nesse serviço; nada fica marcado; auditoria `client_web.link_sent_by_staff`.

## Cabeçalhos a verificar (`curl -sI`)

`GET /c/<qualquer>` → `200`, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`, `X-Frame-Options: DENY`. `GET /api/c/state` sem cookie → `401` com os mesmos cabeçalhos.

## Logs e sinais (sem token nem telefone)

Eventos `client_web.exchange_ok`, `client_web.exchange_refused`, `client_web.book`, `client_web.reschedule`, `client_web.cancel`, `client_web.ask_team`, `client_web.rate_limited`. Muitos `exchange_refused` seguidos = link a ser reaberto depois de usado ou tentativa de adivinhar. `429` = limite de pedidos (troca: 20 por IP e 10 min; restantes: 120 e 30 por sessão).

## Desligar em emergência

1. Pausa da owner (Limites das automações): o chat passa à equipe e a página deixa de marcar.
2. Não há desligar global. A pausa da owner é o único corte, e a página continua a mostrar as marcações.
3. Marcações já feitas pela página ficam como estão (a auditoria identifica-as).

## Limpeza e retenção

O cron diário (04:15 UTC) apaga do D1 central os links expirados há mais de 7 dias, as sessões expiradas ou revogadas há mais de 1 dia e os contadores de limite com mais de 1 dia. **Ainda por fazer:** expurgo por tenant e por contacto (DEC-099, REQ-071), como no Flow.

## Estado do staging (17/11/2026)

**Confirmado** (verificação manual e deploy atrás do PR #898; detalhe em [docs/memory/staging-client-web-17-11-2026.md](../../memory/staging-client-web-17-11-2026.md)):

| Item | Estado |
| --- | --- |
| Migrações D1 `0027_client_web` e `0028_client_web_rate_limits` | **Aplicadas** em staging |
| Worker `tredane-dev-staging`, versão `fd8c3d86-726a-40a7-a5a7-17d1f8de6395`, conta Tredane `fc4be5a9597f5f05126209205ee98339` | **Confirmado** |
| `CLOUDFLARE_ACCOUNT_ID` no GitHub Environment `staging` | **Em aberto** — falta fixar a variable (ver [DEPLOY.md](../../DEPLOY.md)); bloqueia CI de deploy |
| `CLIENT_WEB_ENABLED` | Existia só em staging em 17/11. **Retirada** em 18/11/2026 (Paulo, «tira a flag»): a página deixa de depender dela. |
| Casca `/c/*`: cabeçalhos de privacidade | **Verificado** |
| `GET /api/c/state` sem sessão | **401** (**Verificado**) |
| `POST` sem `Origin` | **403** (**Verificado**) |
| Token inventado na troca | **410** (**Verificado**) |
| Tabelas `client_web_*` no D1 | **Existem** (**Verificado**) |
| Logs do Worker | Sem erros relevantes na verificação (**Verificado**) |
| Fumo completo com interruptor da owner | **Não verificado** |
| Envio real do botão `cta_url` pela Meta | **Não verificado** |
| Uso num telemóvel real | **Não verificado** |

**Proposto (operação):** o próximo deploy da `main` para staging **sobrepõe** este worker até o PR #898 (ou equivalente) estar merged e o pipeline voltar a publicar esta versão.

## Antes de produção

Lista completa em [ADR-0018 §8](../../adr/0018-pagina-web-cliente.md) e [em-aberto-pagina-web-cliente.md](../../memory/em-aberto-pagina-web-cliente.md). Resumo: GATE-04 (parecer LGPD), TMPL-05 (link fora das 24 h aprovado pela Meta), revisão de segurança curta (enumeração, CSRF, clickjacking, limites) como em [suporte-revisao-e-pentest.md](suporte-revisao-e-pentest.md), valores de 60 e 30 min do link e da sessão (DEC-199), valor padrão do horizonte (DEC-201), texto das mensagens (**Proposto**) e a decisão sobre cancelar com sinal pago (DEC-198).
