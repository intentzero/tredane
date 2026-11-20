# ADR-0018 — Página web da cliente aberta a partir do WhatsApp

- **Estado:** **Proposto**. A direção está **Confirmada** (Paulo, 17/11/2026): **DEC-202** (o chat não marca, não remarca e não cancela; a página fica sempre ligada; a equipe também envia o link), DEC-196 (a página substitui o Flow), DEC-197 (confirma na própria página), DEC-198 (cancela e remarca sozinha, também com sinal) e DEC-199 (uso único = troca única por sessão curta). Este ADR é o desenho de engenharia e ainda não foi revisto pelo Paulo; os valores e as rotas abaixo ficam **Propostos**.
- **Origem:** planeamento de 17/11/2026 sobre uma alternativa determinística ao agendamento puramente conversacional.
- **Relacionados:** [ADR-0016](0016-whatsapp-flow-agendamento.md) (Flow, **suspenso** pela DEC-196; o desenho do `flow_token` é a base), [ADR-0012](0012-clinic-durable-object-sqlite.md), [ADR-0015](0015-estado-persistente-da-conversa.md), DEC-061, DEC-104, DEC-138, DEC-044.
- **Escopo:** rotas, token, sessão, proposta no canal web, isolamento por componente, eventos, testes. **Não** é implementação.

## 1. Problema

1. O agendamento, a remarcação e o cancelamento por conversa continuam frágeis (zona que cai, dia perdido no toque, Confirmar em proposta expirada: DEC-138, [metodologia](../implementation/metodologia-avaliacao-conversacional.md)).
2. O Flow, a resposta decidida, depende da verificação de negócio da Meta, bloqueada sem CNPJ (VAL-13, #514).
3. O código já tem quase tudo o que a página precisa; falta uma superfície pública e a sua autenticação.

**Confirmado (código de hoje, só leitura):** não há rota de cliente sem login além dos webhooks; o `flow_token` (`src/whatsapp/flow/tokens.ts`) é opaco, guardado no D1 e de uso único; o envio interativo é botão, lista ou Flow, sem botão com URL (`src/whatsapp/meta.ts`).

## 2. Opções

| Opção | Resumo | Estado |
| --- | --- | --- |
| **(a) Página web com link pessoal** | Link no chat → troca por sessão curta → agendar, remarcar, cancelar, ver marcações. | **Confirmado** (DEC-196) |
| (b) WhatsApp Flow | Quatro ecrãs com `data_exchange`. | **Suspenso** (DEC-196); volta a ser considerado quando a Meta liberar |
| (c) Só melhorar o texto livre | Mais gates e mais casos L1. | Mantém-se **em paralelo**, não resolve a fragilidade de raiz |
| (d) Web escolhe, WhatsApp confirma | A página monta a proposta; só o botão do WhatsApp marca. | Recomendada pelo agente, **descartada** pelo Paulo (DEC-197) |

## 3. Desenho (Proposto)

### 3.1 Link, token e sessão

- **Token:** `cw1_` + 32 bytes aleatórios (`generateOpaqueToken`, `src/db/tokens.ts`). Guarda-se só o hash SHA-256 (`hashToken`), comparado em tempo constante (`hashesEqual`).
- **Tabela `client_web_links` (D1):** `token_hash`, tenant, binding do WhatsApp, `contact_id`, `conversation_id`, `purpose` (`home` | `agendar` | `remarcar` | `cancelar`), `appointment_id` opcional, `expires_at`, `consumed_at`. Um link ativo por conversa: inserir um novo expira o anterior (padrão de `insertFlowToken`).
- **Tabela `client_web_sessions` (D1):** `session_hash`, tenant, `contact_id`, `conversation_id`, `expires_at`, `revoked_at`.
- **Troca única (DEC-199):**
  1. `GET /c/:token` serve só a casca da página; **não** consome o token e responde `Cache-Control: no-store`.
  2. A página chama `POST /api/c/exchange {token}`. O consumo é atómico: `UPDATE … SET consumed_at = now WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > now`. Uma linha afetada abre a sessão; zero linhas devolvem o ecrã «link já usado ou expirado».
  3. A resposta grava o cookie de sessão (`HttpOnly; Secure; SameSite=Strict; Path=/api/c`).
- **Valores Propostos:** token 60 min; sessão 30 min, sem renovação deslizante além do teto.

### 3.2 Rotas públicas (sem Clerk)

| Rota | Efeito | Origem do tenant |
| --- | --- | --- |
| `POST /api/c/exchange` | Troca o token por sessão | Linha do token no D1 |
| `GET /api/c/state` | Nome da clínica, marcações futuras da cliente, catálogo ativo | Sessão |
| `POST /api/c/availability` | Horas livres de um intervalo de datas; também devolve, por dia do mês, se há horário livre (para o calendário C-12). Aceita `professionalId` opcional (DEC-218: filtra; omitido/null = Sem preferência = união) | Sessão |
| `POST /api/c/book` | Cria a proposta e confirma. Aceita `professionalId` opcional (preferência fixa ou round-robin se omitido/null) | Sessão |
| `POST /api/c/reschedule`, `POST /api/c/cancel` | Remarca, cancela | Sessão |

O pedido **nunca** traz `tenant_id` nem `contact_id`. O Worker resolve o hash da sessão no D1 e chama o DO da clínica por RPC (`env.CLINIC.get(idFromName(clinicDurableObjectName(tenantId)))`), como `defaultDataLookup` em `src/whatsapp/flow/routes.ts`.

### 3.3 Proposta e marcação no canal web (DEC-197)

- `book`: `createOrSupersedeProposal` com canal `web`, depois `executeProposalConfirmOp`, que revalida vaga, Tempo e antecedência e ramifica para o Pix (`createSignalChargeAndSendOp`) quando há sinal.
- `reschedule`: proposta com `replacesAppointmentId`, `rescheduleAppointmentOp`, motivo `contato_remarcou`.
- `cancel`: `cancelAppointmentOp`, motivo `contato_cancelou`; com sinal pago, só depois da regra da DEC-198.
- Idempotência por `clientRequestId` enviado pela página (dois toques ou reenvio não duplicam a marcação).
- `evaluateProposalAuthorization` passa a aceitar o canal `web` e valida tenant, contacto e conversa **da sessão**.
- **Intervalo de datas (Proposto):** `listFlowFreeSlots` calcula hoje 7 dias a partir de agora (`AI_FREE_SLOT_DAYS`). A página precisa de pedir por intervalo (`from`, `to`), para mudar de semana, e de um resumo por dia do mês. O intervalo é limitado pelo horizonte máximo da clínica (DEC-201, configuração ainda não implementada) e pela antecedência mínima (DEC-182).
- Horas: `listFlowFreeSlots` (`src/whatsapp/flow/slots.ts`) sobre `queryAutomaticAvailability`, com ids civis `YYYY-MM-DDTHH:MM`. O título de uma hora não autoriza o slot.

### 3.4 Envio do link no WhatsApp

- `sendInteractiveCtaUrlMessage` novo no `MetaAdapter`, com variante sintética para o laboratório (DEC-186). O botão «Abrir agenda» só sai **dentro da janela de 24 h**.
- Fora da janela: template com botão URL (**Em aberto**, GATE-10; TMPL novo em [whatsapp-templates-draft.md](../product/whatsapp-templates-draft.md)). Sem aprovação, a janela fechada continua a ser handoff, sem inventar template (DEC-040(d)).
- **Recibo** depois de cada ação: frase determinística do backend com «Não foi você? Falar com a equipe». Uma falha de envio do recibo não desfaz a ação.

### 3.5 Pesquisa e género (DEC-200, **Proposto**)

- `GET /api/c/state` devolve o catálogo ativo e agendável (serviços, zonas, sinónimos, audiência e género de cada zona). A pesquisa corre no navegador: normaliza (minúsculas, sem acentos), tolera plural leve e compara com nome e sinónimos. Sem índice nem rota de pesquisa no servidor; o tamanho esperado são dezenas de itens. Se um catálogo crescer muito, a decisão volta a ser aberta.
- O género da cliente **não é determinado nem guardado**: o contacto não tem sexo (DEC-075). `availability` e `book` recebem a linha escolhida (`feminino` | `masculino`) como parte do pedido, validada contra a audiência do serviço e o género das zonas (DEC-079). O valor inicial vem do quadro da conversa (DEC-142), quando existir.

### 3.6 Preferência de profissional (DEC-218, **Confirmado**)

- O catálogo (`GET /api/c/catalog` / estado) lista, por serviço, as profissionais ativas ligadas (`id` + nome de exibição; sem dados de login).
- `availability` e `book` / `reschedule` aceitam `professionalId` opcional. Valor presente = só horas/atribuição dessa profissional (validada no DO contra o serviço e o tenant da sessão). Omitido ou `null` = «Sem preferência»: união das vagas; no Confirmar, round-robin entre quem está livre na hora (cursor SQLite `client_web_rr_cursor` por `tenant_id` + `service_id`, última atribuída em Sem preferência).
- Remarcar pré-escolhe a profissional da marcação; a cliente pode mudar. Com ≤1 profissional no serviço a UI esconde o bloco. O nome atribuído volta no Feito e no recibo WhatsApp. O Agendar do painel (TEL-05) **não** partilha este rodízio neste recorte.
- Revê, no canal web, a leitura herdada do Flow (ADR-0016 §6) «o id de horário não escolhe profissional / não é escolha da cliente».

## 4. Isolamento por componente

| Componente | Regra |
| --- | --- |
| API pública | Autorização só pela sessão; `Origin` verificado nos POST; limites por IP e por token ([abuse-limits.md](../security/abuse-limits.md)); respostas idênticas para token inexistente, usado e expirado, para não permitir enumeração. |
| D1 central | `client_web_links` e `client_web_sessions` escopadas por tenant; consultas sempre pelo hash. |
| DO + SQLite | O RPC recebe `contactId` e `conversationId` da sessão e só lê e escreve esses dados. O DO revalida que o contacto pertence ao tenant. |
| WebSocket | A página **não** abre WebSocket no MVP. As marcações feitas na página chegam ao painel pelos eventos que o painel já recebe da agenda. |
| Queues | O recibo e o Pix saem pelo outbox existente, com o tenant e o id lógico da ação; reentrega não duplica o efeito. |
| R2 | Sem anexos na página. |
| Workflows | Sem Workflow novo. |
| Logs | Sem token, sem telefone, sem corpo do pedido (REQ-070). |
| IA | O LLM não vê a página, o token nem a sessão; não escolhe serviço, zona nem hora. |

## 5. Cabeçalhos e página

`Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`, CSP com `frame-ancestors 'none'`, sem scripts nem fontes de terceiros (Roboto servida pelo próprio app). A página não mostra o telefone nem dados de saúde, mostra o nome da clínica e uma frase «esta página não pede pagamento nem senha».

## 6. Riscos e o que ainda não fecha

| Risco | Tratamento | Estado |
| --- | --- | --- |
| Link reencaminhado age como a cliente | Sessão curta, um link por conversa, recibo no WhatsApp | **Proposto**; o risco foi **aceite** pelo Paulo (DEC-197) |
| Link visto como golpe | Domínio estável, nome da clínica visível, texto de segurança | **Proposto** |
| Cancelar com sinal sem janela de crédito aplicada | Só liga depois da regra da DEC-198 | **Proposto** |
| Pré-visualização, antivírus ou browser interno gastam o link | Troca por POST (DEC-199) | **Confirmado** |
| Dados reais sem parecer LGPD | Bloqueado pela GATE-04 | **Em aberto** |
| Link fora das 24 h | Template com botão URL | **Em aberto** (Meta) |

## 7. Testes

- Unitários e de integração: troca atómica e replay, expiração, link novo invalida o anterior, `GET` que não consome, sessão de outro tenant ou contacto recusada, `Origin` errado, idempotência, vaga perdida, Tempo recusado, sinal dentro e fora da janela.
- Gates da [metodologia](../implementation/metodologia-avaliacao-conversacional.md): `npm run eval:scorecard` e um caso L1 por comportamento novo na oferta do link.
- Laboratório MCP em staging (DEC-186) e aparelhos reais (iPhone e Android, pré-visualização, browser interno, recarregar, voltar).
- Revisão de segurança curta antes de produção (enumeração, CSRF, clickjacking, limites).

## 7a. Estado da implementação

**Fase 1 implementada (17/11/2026; a flag de ambiente saiu em 18/11/2026):**

- migração `0027_client_web.sql` (links e sessões, só hashes); `src/clientweb/{links,routes,state,first-name}.ts`;
- `POST /api/c/exchange` e `GET /api/c/state`, com `Origin` obrigatório nos POST e cabeçalhos de privacidade;
- RPC `clientWebState` no Clinic DO (só leitura; o contacto tem de ser o da conversa da sessão);
- botão de URL (`cta_url`) no `MetaAdapter`, no envio (`interactive.ctaUrl`) e na fila `whatsapp.send`;
- página `/c` (C-01 só leitura e C-09), sem Clerk, em `src/client/clientweb/`.

**Fechado depois (17/11/2026), ainda atrás da flag:**

- **Limite de pedidos** nas rotas públicas: janela fixa de 10 min no D1 (`client_web_rate_limits`, migração 0028), por hash do IP na troca (20) e por hash da sessão no estado (120); `429` com `Retry-After`. Valores **Propostos**. Se o D1 falhar, deixa passar.
- **O URL com o token já não fica guardado:** depois do envio (resultado aceite ou falhado) o URL é trocado por `[removido]` em `outbound_messages.interactive_json` e em `outbox_events.payload_json`. Em resultado incerto mantém-se, porque o envio pode repetir-se.
- **Clínica suspensa ou em exclusão** deixa de servir a página (`GET /api/c/state` devolve 401); não depende de revogar sessões uma a uma.

**Fase 2 implementada (17/11/2026, atrás da flag): agendar na página**

- `GET /api/c/catalog`, `POST /api/c/availability` (intervalo de datas) e `POST /api/c/book`; RPCs `clientWebCatalog`, `clientWebSlots` e `clientWebBook` no Clinic DO (`src/clientweb/booking.ts`).
- `book` cria a proposta versionada (`createOrSupersedeProposal`), marca-a enviada (30 min) e passa-a pelo **mesmo executor** do botão do WhatsApp (`executeProposalConfirmOp`) com `channel: 'web'`: ator `contact:web`, auditoria `appointment.client_web_booked`, nota «Marcado pela cliente (web)», e o texto de «marcado» no chat leva o recibo «Marcado pela página. Não foi você? Fale com a equipe.». Mesmos gates do chat: vaga e Tempo revalidados na transação, Pix sem reserva antes do pagamento, limites S7 e pausa da owner (`paused`).
- O toque duplo não duplica: `findRecentWebBooking` devolve a marcação da própria cliente (mesmo serviço e hora, últimos 10 min).
- Página: Início com «Agendar novo horário», «Para quem é?» (só se o catálogo depende de género), serviço, zonas (só as da linha, total somado), horário (semana com setas, Manhã/Tarde/Noite), revisão e resultado (marcado, Pix, pausa, erro). Layout compacto (C-02 a C-06).
- **Horizonte provisório:** 30 dias fixos em `CLIENT_WEB_HORIZON_DAYS`, até a configuração da clínica existir (DEC-201).

**Pesquisa e calendário implementados (17/11/2026, atrás da flag):**

- **Pesquisa** (C-10, C-11, DEC-200): um campo em Serviço acha serviços e zonas pelo nome e pelos sinónimos, sem acentos e com plural leve, com o termo realçado e resultados agrupados pelo serviço; tocar numa zona abre Zonas com ela marcada. Zonas tem o seu campo. Sem resultado mostra «Nada encontrado» e «Ver todos os serviços». Corre no navegador sobre o catálogo (`search-model.ts`).
- **Sinónimos no catálogo:** o catálogo de `GET /api/c/catalog` passa a levar `synonyms` (serviço e zona) **só para a pesquisa casar**; a página nunca os escreve (há teste). A DEC-110 diz «nunca à cliente»; isto dá ao navegador da cliente a lista de nomes populares. **Confirmado (Paulo, 17/11/2026, «Aceitar»):** fica assim; se a lista de sinónimos passar a ser sensível, a pesquisa passa para o servidor (uma rota a mais, com o mesmo resultado e sem expor a lista).
- **Calendário do mês** (C-12): a data do cabeçalho do horário abre uma folha com o mês, pontos nos dias com horas livres, dias cheios ou fechados apagados, mês anterior e seguinte só dentro do horizonte, e «Primeira data livre». Usa `daysOnly` em `POST /api/c/availability` (só a primeira hora de cada dia, sem o teto de 400 horas, que escondia os últimos dias). Vale também em Remarcar.

**Fase 5 implementada (17/11/2026, atrás da flag e do interruptor da owner): oferta do link no chat**

- A abertura do hub do chat («Oi» e pedido vago de marcar, `shouldAttachHubOpeningCta`) leva o botão **«Abrir agenda»** (`cta_url`) em vez do CTA do Flow, quando a base `APP_BASE_URL` é https. A página não tem interruptor (DEC-202, revisão 18/11/2026). É o mesmo gancho `prepareBookingFlowOffer`: o Clinic DO emite o link (`issueClientWebLink`, `purpose: 'home'`) e devolve o corpo e o botão (`src/clientweb/offer.ts`). Sem binding ativo ou sem https cai no Flow, se existir, e depois no M5.
- Corpo determinístico (DEC-104), **Proposto**: o do hub sem a pergunta aberta + «Para agendar, remarcar ou cancelar, toque em «Abrir agenda». Para tirar dúvidas, escreva aqui.» Serviço nomeado, pedido com dia e perguntas de informação **não** abrem o link: seguem o funil e o catálogo.
- **Interruptor da owner por clínica** (DEC-199, desligado por defeito): tabela `clinic_client_web` (migração 73 do Clinic DO), `GET|PUT /api/tenants/:id/config/client-web` (só a owner, auditoria `config.client_web_updated`) e o cartão «Agendamento por link» em Clínica. Com o interruptor desligado, todos os RPCs `clientWeb*` devolvem `null` (a página não serve) e desligar revoga as sessões abertas.
- Família L1 **CW-01 a CW-05** (`cw-cases.ts`, harness `clientweb-driver.ts`): abertura com o botão, pedido vago, serviço nomeado, informação e página desligada. O token nunca aparece no corpo.

**Remarcar e cancelar no chat oferecem o link (Confirmado, Paulo, 17/11/2026, «sim remarcar e cancelar também oferecem o link»):**

- Com a página ligada (plataforma e owner), a cliente **com compromisso futuro** que diz «quero remarcar» ou «quero cancelar» recebe o botão «Abrir agenda» em vez do caminho conversacional (DEC-091 e o botão «Cancelar marcação»). Gancho novo `prepareClientWebOffer` (`src/clientweb/offer.ts`), chamado em `autodraft.ts` antes de `tryAiReschedule` e de `handleCancelIntentAutodraft`.
- O link leva a **finalidade** (`remarcar` ou `cancelar`) e, se a cliente só tem **uma** marcação futura, a **marcação alvo**: a página abre direto no ecrã de remarcar ou de cancelar dessa marcação (`exchange` devolve `purpose` e `appointmentId`). Com várias, abre as marcações. Se o alvo já não existe, abre as marcações.
- Corpos fixos, **Propostos**: «Para remarcar, toque em «Abrir agenda» e escolha a nova data e hora. Se preferir, escreva aqui.» e «Para cancelar, toque em «Abrir agenda» e confirme a marcação. Se preferir falar com a equipe, escreva aqui.»
- **Não** oferece o link: sem compromisso futuro (segue o caminho de hoje: equipe), com a pausa da owner ativa, ou fora da janela de 24 h (o envio falha e o chat segue). A página em si não se desliga (revisão 18/11/2026).
- A conversa continua a ser a alternativa: quem escreve «quero cancelar» e prefere falar com a equipe escreve na mesma conversa.
- L1 **CW-06 a CW-10**: remarcar com uma marcação, cancelar com uma, cancelar com duas (sem alvo), cancelar sem marcação (equipe) e página desligada (sem botão).
- L1 **CW-12** (`gu-cases.ts`): depois do cancelamento na página, **um** recibo «Cancelado:… Cancelado pela página…» e o follow-up «Posso ajudar em algo mais?» (DEC-086); o toque na UI da página é simulado pelo mesmo `cancelFromWeb` + `appendWebCancelChatEffects` do Clinic DO.

**Fase 5, ainda não feito:**

2. **Fora das 24 h** o link não sai (TMPL-05 por aprovar na Meta).
3. A base `APP_BASE_URL` de staging e produção é https; em desenvolvimento (http) a oferta não sai.

**Fases 3 e 4 implementadas (17/11/2026, atrás da flag): remarcar e cancelar** (`src/clientweb/manage.ts`)

- **Remarcar:** `POST /api/c/availability` aceita `appointmentId` (serviço e zonas vêm da marcação; a própria marcação não ocupa a vaga) e `POST /api/c/reschedule`. Cria a proposta com `replacesAppointmentId` e passa pelo mesmo executor, canal `web`; a mesma marcação é movida (motivo `contato_remarcou`), mantém serviço, zonas e duração, sem sinal novo. O recibo no chat começa por «Remarcado:» e leva «Marcado pela página. Não foi você?…». Toque duplo devolve a marcação (`rescheduleAlreadyAt`).
- **Cancelar:** `POST /api/c/cancel`. Só marcações **sem sinal pago**; cancela com ator `contact:web` (motivo `contato_desistiu`), idempotente por marcação, e envia **um** recibo «Cancelado: {serviço}[ · zonas] · {quando}. Cancelado pela página. Não foi você? Fale com a equipe.» ao chat (melhor esforço; fora das 24 h não sai). O aviso genérico do painel (DEC-095) **não** sai neste caminho (`skipCancelNotice`). A seguir, o follow-up «Posso ajudar em algo mais?» com «Abrir agenda»|«Terminar» (DEC-086), com idempotência própria (`followup.postcancel:…`).
- **Com sinal pago não cancela:** a página mostra «Pedir cancelamento» e `POST /api/c/ask-team` faz o mesmo que «Falar com a equipe» no chat (pausa a IA e avisa a equipe; fora do expediente só responde o horário, DEC-155). É a regra Proposta da DEC-198(b): a janela de crédito ainda não é aplicada pelo backend.
- Só se mexe em marcações **do contacto da sessão**, futuras e confirmadas; qualquer outra dá `not_found`. A página mostra Remarcar e Cancelar em cada marcação.

**Fases 3 e 4, ainda não feito:**

1. **Cancelar com sinal pago sozinha** (aceite explícito da política fora da janela, DEC-198(c)): depende de aplicar a janela de crédito e da validade do crédito (**Em aberto**, Paulo).
2. **Remarcar uma marcação com sinal pago** funciona como qualquer outra (mantém a marcação e não gera sinal novo), sem aplicar a janela de crédito. Confirmar com o Paulo se isso é aceitável antes de produção.
3. Cancelar e remarcar não têm limites S7 próprios de cancelamento; a remarcação passa pelos limites de propostas (S7) como no chat.

**Fase 2, ainda não feito:**

2. **«Para quem é?» não vem pré-escolhido** da conversa (DEC-142); a cliente escolhe sempre.
3. **Hora perdida entre Confirmar e a marcação** (DEC-202): no canal web o executor **já não** envia a frase do chat; a página mostra o aviso. No WhatsApp legado (Confirmar já redireccionado para o link) a cópia aponta «Abrir agenda» sem listar horas.
4. Sem caso L1 novo: o canal web não é um diálogo. O comportamento está coberto por `booking.test.ts` e `BookFlow.test.tsx`; o scorecard (222 casos) não regrediu.

**Staging preparado (17/11/2026):**

- A página faz parte do Worker em todos os ambientes (**Confirmado**, Paulo, 18/11/2026, «tira a flag»). Runbook [pagina-web-cliente.md](../implementation/runbooks/pagina-web-cliente.md).
- **Casca `/c` e `/c/*` servida pelo Worker** (`src/clientweb/shell.ts`, binding `ASSETS`, `run_worker_first`): devolve o `index.html` com `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex` e sem moldura, e pede sempre a raiz dos assets (o token do URL não chega à busca de ficheiros).
- **Limpeza diária** no cron das 04:15 UTC (`src/clientweb/cleanup.ts`): links expirados há mais de 7 dias, sessões há mais de 1 dia, contadores com mais de 1 dia.
- **Teste no runtime do Cloudflare** (`npm run test:runtime`, workerd): o ciclo completo no Clinic DO real (interruptor da owner, sessão, estado, catálogo, horas, Confirmar com erro tratado, cancelar, revogação ao desligar). Fecha a lacuna de só termos testado a lógica sem o RPC.

**Ainda não feito (bloqueia ligar em produção):**

1. **Expurgo por tenant e por contacto** no D1 central (DEC-099, REQ-071): a limpeza diária só trata o que expirou.
2. Um erro de rede ou de D1 em `/api/c/state` mostra «Não foi possível abrir a agenda»; uma clínica suspensa mostra o aviso de «link já usado», que não é exato. Texto próprio por decidir.
3. GATE-04 (LGPD), TMPL-05 (fora das 24 h) e a revisão de segurança curta.

## 7b. DEC-202: o chat só informa e encaminha (17/11/2026, **Confirmado**)

- **Encaminhamento (`src/clientweb/route-intent.ts`, léxico puro, sem LLM):** cumprimento → `home`; pedido de marcar ou de vaga → `agendar`; «remarcar» ou «cancelar» com marcação futura → `remarcar` ou `cancelar` (com a marcação alvo se só houver uma); sem marcação futura → `agendar` com «Não encontrei marcações…». Perguntas de informação (preço, duração, o que é, onde fica) e perguntas condicionais sobre política não são pedido de marcar. Um **único** serviço reconhecido (nome, sinónimo ou zona; o nome longo ganha ao curto contido) pré-escolhe o serviço no link (`client_web_links.service_id`, migração `0030`); a página salta a lista se o serviço está ativo e não depende de género, senão pergunta «Para quem é?» e, se já não existe, abre a escolha de serviço.
- **Sempre ligada:** sai o interruptor da owner (tabela `clinic_client_web`, migração de clínica `0074`, rotas `config/client-web`, cartão do painel). **Revisão (Paulo, 18/11/2026, «tira a flag»):** sai também `CLIENT_WEB_ENABLED`. Não há freio de ambiente. A pausa da owner continua a bloquear marcar.
- **Pausa da owner:** o pedido passa à equipe (frase fixa e alerta «Precisa de alguém»), sem link; a página mostra as marcações e bloqueia agendar, remarcar e cancelar com «Falar com a equipe». Sem link possível (sem número ativo, base sem https) ou fora das 24 h o chat também passa à equipe; o template fora das 24 h continua **Em aberto** (TMPL-05, gate Meta).
- **Botões antigos no WhatsApp** (listas M5, Confirmar/Alterar de propostas, cancelar no chat, «Continuar» do FAQ, «Marcar outro», «Prosseguir»): respondem com o link e nunca marcam; o «Falar com a equipe» do cartão de proposta continua a passar à equipe (`src/clientweb/legacy-buttons.ts`).
- **Equipe:** `POST /api/tenants/:id/client-web-links` (`clinic.agenda.operate`) e o RPC `sendClientWebLinkFromStaff` enviam o link com o botão «Abrir agenda» (auditoria `client_web.link_sent_by_staff`); o painel Agendar passa de «Enviar proposta» a «Enviar link de agenda». O horário escolhido no painel não fica reservado.
- **Removido:** `autobook`, `choice-offer`, reagendar e cancelar por conversa, `alter-details`, extrator LLM e job `extract` da fila, sombra do interpretador (tabela por migração `0031`, rota `/api/platform/quality/shadow`, ferramenta `get_interpreter_shadow_report`), `src/whatsapp/flow/` e as rotas do Flow, `staff-send`. As tabelas e o quadro de estado da conversa (`BookingFrame`, sessão de agendamento) ficam sem escritor do funil e saem numa limpeza de dados separada.
- **Turno misto (Confirmado, 18/11/2026):** pedido de marcar com pergunta de informação no mesmo texto → uma só mensagem com a resposta (`catalogReply`) e a frase do link, com o botão «Abrir agenda»; `ClientWebRoute.mixed` vem do léxico `INFO` de `route-intent.ts`.
- **Limites e riscos:** as respostas com link não passam pela quota `autoDraftsPerContact` (não geram rascunho); a quota por contacto e a limitação de pedidos às rotas públicas continuam. Cada link novo invalida o anterior da conversa.

## 8. Em aberto

Índice resumido em [docs/memory/MEMORY.md](../memory/MEMORY.md) (`em-aberto-pagina-web-cliente.md`).

### Paulo (produto)

| # | Pergunta | Bloqueia |
| --- | --- | --- |
| 1 | Valores de **60 min** (token) e **30 min** (sessão), DEC-199 (**Propostos** hoje) | Afinar limites antes de produção |
| 2 | **Validade do crédito** do sinal (DEC-198(c); liga DEC-180) | Cancelamento com sinal pago sem «Pedir à equipe» |
| 3 | **Valor padrão** do horizonte máximo e ecrã de configuração da owner (DEC-201) | Substituir `CLIENT_WEB_HORIZON_DAYS` fixo |
| 4 | **Revisão dos textos** das mensagens no chat e recibos (**Propostos**) | Copy definitiva (DEC-104) |
| 5 | Aceitar ou não **remarcar** uma marcação com sinal pago **sem** aplicar a janela de crédito (hoje remarcar funciona; cancelar com sinal não) | Produção com sinal |

### Engenharia

| # | Lacuna | Bloqueia |
| --- | --- | --- |
| 1 | **Expurgo** por tenant e por contacto no D1 central (`client_web_links`, `client_web_sessions`; DEC-099, REQ-071) — o Flow tem a mesma lacuna | LGPD / offboarding |
| 2 | Texto próprio para **erro de rede** e para **clínica suspensa** (hoje mostra «link já usado», impreciso) | UX e suporte |
| 3 | Pré-escolher **«Para quem é?»** a partir da conversa (DEC-142) | Menos atrito na página |
| 4 | ~~Suprimir no canal web a frase do chat «Horário já não está livre…»~~ **Feito** (DEC-202) | — |
| 5 | Template **TMPL-05** (implementação): link fora das 24 h | Clientes que só abrem o chat no dia seguinte |

### Externos / gates

| # | Gate | Bloqueia |
| --- | --- | --- |
| 1 | **GATE-04** — parecer LGPD | Dados reais e produção |
| 2 | **TMPL-05** — template Meta com botão URL fora da janela de 24 h | Mesmo critério que o item 5 de engenharia |
| 3 | **Revisão de segurança curta** (enumeração, CSRF, clickjacking, limites), como em [suporte-revisao-e-pentest.md](../implementation/runbooks/suporte-revisao-e-pentest.md) | Produção |

### Outros (DEC-196)

- As listas M5 e o código do Flow foram removidos (DEC-202, §7b).
- O interruptor da owner por clínica foi **retirado pela DEC-202**: a página fica sempre ligada (ver §7b).
