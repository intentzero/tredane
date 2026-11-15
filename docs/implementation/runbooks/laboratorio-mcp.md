# Laboratório conversacional (MCP) — como usar

**Estado:** Confirmado (DEC-186, Paulo, 14/11/2026). Fase 1 (conversar e ler) e fase 2 (configurar a clínica demo) implementadas.

Um MCP com escrita, **separado** do Review MCP (que é só leitura, DEC-159), para um agente conversar com o sistema
como se fosse uma cliente, sem WhatsApp, e ler o estado da clínica. Serve para testes conversacionais repetíveis e
para reproduzir um defeito antes de o tratar (caso L1 primeiro; ver `metodologia-avaliacao-conversacional.md`).

## Limites (não se contornam)

- **Só staging** (`ENVIRONMENT=staging`) e **só a clínica demo** (`tenant_dec0de000000000000000001`). Sem tenant novo.
- Gate: `ENVIRONMENT=staging`, `LAB_ENABLED=true` (já em `wrangler.jsonc`, staging) e `OAUTH_KV` configurado (o mesmo do
  Review MCP). Fora disso a rota responde 404.
- **Autenticação por OAuth MCP**, sem secret estático: consentimento só de superadmin (sessão Clerk), recurso
  `/api/mcp/lab`, escopo `lab:converse`. Um token do Review MCP não abre o laboratório, nem o contrário. O ator
  gravado na auditoria é `lab:<clerkUserId>`.
- **Nada sai para a Meta.** O consumer já ignora o tenant demo; o resultado do envio é marcado como entregue de forma
  sintética para a proposta avançar. Números só `5500…` (inexistentes); outro prefixo é recusado.
- **Orçamento:** teto diário de turnos (`LAB_MAX_TURNS_DAILY`, padrão 400), proxy do teto de US$ 10 dos testes L2.
  Esgotado, o turno é recusado antes de qualquer efeito. Cada `lab_say` chama o modelo; `lab_tap` e `lab_state` não
  chamam, mas `lab_tap` conta no teto para manter a regra simples.
- Os dados do laboratório vivem na clínica demo e misturam-se com o seed; não usar para medir produção.

## Ligar

Nada a configurar além do deploy de staging (o `OAUTH_KV` já existe por causa do Review MCP). No cliente MCP, registar
`https://<staging>/api/mcp/lab` como servidor remoto; o cliente descobre o OAuth sozinho
(`/.well-known/oauth-protected-resource/api/mcp/lab`) e abre o consentimento. Entrar antes no painel com a conta
superadmin. JSON-RPC por POST, sem sessão.

**Paridade com o Review MCP (Cursor):** `initialize` e `ping` respondem **sem** token (só para o cliente ler
`serverInfo` e montar o fluxo OAuth). `tools/list` e `tools/call` devolvem `401` com
`WWW-Authenticate: Bearer … resource_metadata="…/.well-known/oauth-protected-resource/api/mcp/lab", scope="lab:converse"`.
Escopo a pedir: `lab:converse` (não reutilizar o token do Review). Descoberta canónica = path insertion RFC 9728;
também existe a forma appendida `/api/mcp/lab/.well-known/oauth-protected-resource`. O documento raiz
`/.well-known/oauth-protected-resource` continua a descrever **só** o Review (`review-central`) — não serve para o Lab.
O AS aceita o redirect `cursor://anysphere.cursor-mcp/oauth/callback` (`allowPrivateUseRedirectUris`); sem isso o
Cursor Desktop regista o cliente mas falha em `/authorize` com «Invalid redirect URI» / «Declined».
O AS tem **dois** recursos (Review + Lab): o Cursor omite o parâmetro RFC 8707 `resource` no `/authorize`;
sem inferência, o provider devolve `error=invalid_target` no callback («resource parameter is required…») e o
Cursor mostra «Declined». O `/authorize` injeta o recurso a partir do `scope` quando este é inequívoco
(`lab:converse` → Lab; `review_samples:read` → Review). Cloud Agents usam
`https://www.cursor.com/agents/mcp/oauth/callback` (já aceite no DCR); o desktop usa `cursor://` — ambos
precisam da mesma inferência de `resource`.

**Login no meio do OAuth:** se `/authorize` não tem sessão Clerk, a página aponta para
`/entrar?return_to=/authorize?…`. Depois do login o painel retoma esse `/authorize` (consentimento →
callback `cursor://` ou agents). Sem `return_to`, o `forceRedirect` do painel ia para `/clinicas`
(«Escolha a clínica») e o Cursor ficava Declined.

## Ferramentas (fase 1)

| Ferramenta | O que faz |
| --- | --- |
| `lab_status` | Tenant demo, teto diário e turnos usados. Chamar primeiro. |
| `lab_say` | A cliente envia texto; a IA responde já (sem esperar o debounce). Devolve as mensagens novas e `tappable` (botões/lista a tocar). |
| `lab_tap` | A cliente toca num botão ou numa linha de lista (`buttonId` e `title` vêm de `options`/`tappable`; `kind: "list"` para listas). Só o botão Confirmar marca (DEC-061). |
| `lab_state` | Contato, conversa, mensagens, propostas, jobs da IA e marcações da clínica. Só leitura. |

`waId` omitido usa `550000000001`; outro número (`5500…`) é outra cliente, com conversa própria.

## Receita de um teste

1. `lab_status`; 2. `lab_say` com a frase do caso; 3. se a resposta traz opções, `lab_tap` com um id devolvido;
4. `lab_state` para ver proposta e marcação; 5. repetir com variantes da frase (a escolha entre frases aprovadas varia
por conversa: usar `waId` diferentes). Um defeito confirmado vira um caso L1 em
`src/clinic/ai/evals/dialogs/cc-cases.ts` antes da correção.

## Configurar a clínica demo (fase 2)

Ferramentas `lab_config_*`, que chamam as mesmas operações do painel (mesma validação, auditoria com ator `lab:mcp` e
eventos em tempo real). Lista fechada, sem apagar:

| Ferramenta | O que faz |
| --- | --- |
| `lab_config_get` | Configuração completa e os ids (serviços, variantes, salas, profissionais, horários, bloqueios). Chamar antes de alterar. |
| `lab_config_service` | Cria (sem `id`) ou atualiza um serviço (nome, duração, sinónimos, audiência, sala, profissionais, `variantKind`…). Omitido na edição mantém. |
| `lab_config_service_active` | Ativa ou desativa um serviço. |
| `lab_config_zones` | Substitui as variantes/zonas de um serviço (`serviceId` + lista: name, audience, duração, preço, synonyms, `clientExplanation`…). |
| `lab_config_resource` | Cria ou atualiza sala, profissional ou equipamento. |
| `lab_config_resource_active` | Ativa ou desativa um recurso. |
| `lab_config_windows` | Substitui as faixas semanais de um recurso. |
| `lab_config_block` | Cria um bloqueio de agenda (`dryRun: true` só lista os compromissos afetados). |
| `lab_config_ai_assist` | Liga ou desliga a IA assistiva (mesmo opt-in do painel). Sem isto, `lab_say` grava o inbound e não responde. O seed da demo liga a IA por defeito. |

Fora desta fase: apagar serviços ou salas (desativar chega), Pix e cobrança, e «repor seed». Alterações ficam na
clínica demo e persistem entre sessões: anotar o que se mudou e desfazer no fim do teste.
