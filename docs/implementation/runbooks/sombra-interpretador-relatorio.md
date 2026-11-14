# Runbook: relatório da sombra do interpretador LLM (TEMPORÁRIO)

**Estado:** Proposto. Para agentes e pessoas que vão **medir a hipótese H1** ([hipotese-compreensao-llm-primeiro.md](../../architecture/hipotese-compreensao-llm-primeiro.md)). Temporário: sai com a lista de remoção da secção 5.3d desse documento. Não altera nenhuma DEC.

## 1. O que é

Com `AI_INTERPRETER_SHADOW=on` (só em staging), cada turno de texto livre dispara uma chamada extra ao extrator LLM, só para **medir**: não grava o quadro, não envia mensagem, fica fora do teto diário. O resultado é um registo mínimo (ids e veredictos por campo, **sem texto da conversa**) no D1 central, que a ferramenta `get_interpreter_shadow_report` do Review MCP resume.

## 2. Ligar ao MCP

O Review MCP é o da [DEC-159](../../product/decisions.md): cross-tenant, só leitura, **só superadmin** (Clerk `privateMetadata.superadmin`), revalidado em cada chamada.

| Item | Valor |
| --- | --- |
| Endpoint (staging) | `POST https://staging.app.tredane.com/api/mcp/review-central` (JSON-RPC sem estado; o `GET` devolve 405) |
| Protocolo | MCP `2025-03-26`, servidor `tredane-review-central` |
| Autorização | OAuth com PKCE (`S256`), `authorization_code` e `refresh_token`; escopos `review_samples:read` e `offline_access` |
| Descoberta | `/.well-known/oauth-protected-resource` e `/.well-known/oauth-authorization-server` |
| Registo de cliente | `/oauth/register`; consentimento em `/authorize` (só superadmin) |
| Alternativa | `Authorization: Bearer <sessão Clerk de superadmin>` |

No Claude Code: `claude mcp add --transport http tredane-review https://staging.app.tredane.com/api/mcp/review-central` e depois autenticar em `/mcp`. Sem credenciais o endpoint responde `401` com `WWW-Authenticate: Bearer … resource_metadata=…`, que é o que os clientes MCP usam para iniciar o OAuth. Se a ferramenta nova não aparecer, **voltar a ligar o servidor**: alguns clientes guardam a lista de ferramentas em cache.

**Verificado a 14/11/2026 contra staging, sem autenticação:** os dois documentos de descoberta, o `initialize`, o `401` do `tools/list` e o `405` do `GET`. **Não verificado:** o consentimento completo com um cliente real, nem a duração dos tokens.

## 3. Usar `get_interpreter_shadow_report`

Parâmetros: `sinceHours` (1 a 168, por defeito 24), `tenantId` (opcional), `sample` (0 a 50: lista até N ids de divergências por tipo).

1. **Ver se a amostra serve.** `total`, `conversations`, `compared` e `byStatus`. Abaixo de uns 30 a 40 turnos de texto livre, de várias conversas, só reportar os números e pedir mais mensagens; se forem quase só saudações, dizê-lo.
2. **Ler as divergências por campo:** `llm_only` (ganho potencial), `differ` (risco), `rule_only` (o que o modelo perderia), `agree` e `none`. `strictDiscarded` é o que a citação literal de hoje recusaria; `relaxedRejected` é o que nem a validação por id aceita.
3. **Rotular.** Com `sample`, abrir cada conversa no painel pelo `conversationId` e `messageId` e marcar «modelo certo», «léxico certo» ou «ambos errados». O MCP **não** devolve o texto.
4. **Concluir** com os mesmos critérios do corpus: acertos, erros, campos em falta e **inventados**, em especial a `line` (o contacto não tem sexo, DEC-079).

## 4. O que o relatório não prova

- Sem rótulo humano, `llm_only` e `differ` são a **lista do que rever**, não uma taxa de acerto.
- Em staging escreve quem testa, e tende a escrever mais limpo do que as clientes: **subestima** o ganho.
- Não mede conversão, só a leitura do turno. Uma só configuração (modelo, catálogo, clínica) e sem variância entre corridas.
- Só inclui turnos depois do deploy do #741, que passou a colher também os respondidos antes do extrator.

## 5. Privacidade

A tabela guarda ids e veredictos, nunca texto, e apaga ao fim de 7 dias e no purge de tenant. Os ids de `sample` são dados do tenant: não os partilhar fora da equipa. Antes de convidar pessoas de fora a conversar com o staging, resolver a questão de dados pessoais em aberto no [teste da DEC-143](../dec143-teste-com-pessoas.md).
