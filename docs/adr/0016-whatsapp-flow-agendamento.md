# ADR-0016 — WhatsApp Flow de agendamento

- **Estado:** **Confirmado** (Paulo, 04/11/2026 America/Sao_Paulo, opção A — promover o ADR). A [DEC-138](../product/decisions.md) fixa o caminho de produto; este ADR fixa o desenho de engenharia. A **implementação** e os pré-requisitos Meta continuam na [#514](https://github.com/intentzero/tredane/issues/514). Na secção 13, o item 6 (Sim/Corrigir) ficou **Confirmado**; os restantes permanecem **Em aberto**.
- **Origem:** issue [#513](https://github.com/intentzero/tredane/issues/513); [DEC-138](../product/decisions.md) (Confirmado, Paulo, 03/11/2026, com a revisão «Eu queria avançar desde já para flow»); secção «Agendar sem perder o pedido» do [épico](../implementation/epic-nucleo-conversacional.md).
- **Complementa:** [ADR-0012](0012-clinic-durable-object-sqlite.md) (um Durable Object por clínica) e [ADR-0015](0015-estado-persistente-da-conversa.md) (um `BookingFrame` por conversa). Não altera DEC-061, DEC-079, DEC-083, DEC-104 nem DEC-127.
- **Escopo:** desenho do Flow (ecrãs, `data_exchange`, cifra, `nfm_reply`, versões, pré-requisitos Meta, copy C1–C15 Confirmada, testes). **Não** é implementação.

Documentação Meta consultada em 03/11/2026. Cada passo abaixo cita o URL. O que a página não fecha fica **Em aberto**.

## 1. Contexto

**Confirmado (DEC-138 e o épico):** a sonda real de novembro de 2026 na clínica de teste mostrou o bot a avançar com um pedido incompleto. O Flow é a frente principal **já**, no WABA da clínica de teste, sem flag. As listas e botões de escolha do M5 saem quando o Flow entrar ([#515](https://github.com/intentzero/tredane/issues/515)).

| Defeito da sonda | O que o Flow muda | Estado |
| --- | --- | --- |
| Zona que caía em silêncio | A variante sai de um `CheckboxGroup` com ids do catálogo. Não há matcher de texto neste caminho. | **Confirmado** (problema); **Proposto** (o ecrã) |
| Dia perdido no toque: o id guardava só `HH:MM` e o título saía em mês-dia | A opção de horário usa o id civil `YYYY-MM-DDTHH:MM` que [#507](https://github.com/intentzero/tredane/issues/507) fecha, e o título `terça 03/11 17:00`. O título não autoriza o slot. | **Confirmado** (o id que o código da lista já grava em [`offerFramePatch`](../../src/clinic/ai/deferred-booking-frame.ts)); **Proposto** (o Flow reutiliza esse id) |
| Sessão antiga que saltava para horários | O `flow_token` e o `catalogVersion` do envio limitam a sessão. Um token velho não reaproveita escolhas de outra. | **Proposto** |
| Confirmar depois de expirar | O Flow não marca. A proposta versionada continua a valer 30 min (DEC-061). Expirada ou ocupada: não marca, explica, oferece outras horas. | **Confirmado** (DEC-061 / DEC-138) |
| Catálogo sem match a despejar um link | O ecrã de serviço lista só serviços agendáveis activos. Sem match no texto, o chat continua a ser o recurso; o Flow não inventa um link. | **Confirmado** (o chat é o recurso, DEC-138); **Proposto** (o ecrã não leva link) |

**Confirmado:** o texto livre continua e preenche o mesmo quadro, com o eco da DEC-137. Se o Flow não abrir, o chat assume. O LLM não escolhe zona nem hora (DEC-104, DEC-138).

**Proposto ([DEC-143](../product/decisions.md), 06/11/2026, não decidido):** o texto livre deixaria de gravar a escolha final de zonas e hora e passaria a pré-preencher o Flow (zonas marcadas, hora pedida primeiro); o eco Sim/Corrigir sairia. Até decisão do Paulo, vale o parágrafo acima.

**Confirmado (fora do Flow, DEC-138):** não marca, não escolhe sala nem profissional, não cobra Pix, não tem preço editável, não duplica a agenda. Um «sim» escrito nunca confirma horário (DEC-061).

**Confirmado (código de hoje, só leitura):** o envio interactivo é botão ou lista ([`meta.ts`](../../src/whatsapp/meta.ts), `sendInteractiveButtonsMessage` / `sendInteractiveListMessage`). O webhook distingue `button_reply` e `list_reply` ([`webhook-parse.ts`](../../src/whatsapp/webhook-parse.ts)); um `interactive` que não seja esses dois cai em `unsupported`. Não há `nfm_reply` nem mensagem `type: flow`. As ofertas M5 estão em [`choice-offer.ts`](../../src/clinic/ai/choice-offer.ts): ids `ch1~`, `catalogVersion`, toque que não marca.

## 2. Opções

| Opção | Resumo | Por que não chega | Estado |
| --- | --- | --- | --- |
| **(a) Flow com `data_exchange`** | Quatro ecrãs. O endpoint devolve o ecrã seguinte com dados lidos na hora (serviços, variantes da linha, horas livres). | É a escolha. | **Confirmado** (Paulo, 04/11/2026, opção A); o caminho em si já era **Confirmado** (DEC-138) |
| **(b) Catálogo estático no JSON do Flow** | Serviços, variantes e horas gravados no Flow JSON. | A hora depende das zonas escolhidas, da duração, da sala, da profissional, do intervalo e da grade. Um JSON publicado não acompanha a agenda. | **Confirmado** descartado (issue #513) |
| **(c) Flow só para as zonas** | O chat continua a perguntar serviço, género e hora; o Flow só lista variantes. | A DEC-138 descartou esta opção. Os quatro passos é que fecham o pedido incompleto da sonda. | **Confirmado** descartado (DEC-138) |

### Escolha

**Confirmado** (Paulo, 04/11/2026, opção A): opção (a). O JSON do Flow declara ecrãs, componentes e o routing model. Os `data-source` de serviço, variante e horário são dinâmicos (`${data.…}`), preenchidos pelo endpoint. Horas não vão no JSON.

Motivo: a DEC-138 já escolheu `data_exchange` em quatro passos; a agenda que o código consulta ([`queryAvailability`](../../src/clinic/scheduling/query.ts)) só existe depois de saber serviço, linha e variantes (a duração da visita é a soma das variantes, DEC-078).

## 3. Ecrãs e saltos

**Proposto**, com a revisão de 04/11/2026 abaixo. Quatro ecrãs, nesta ordem. No `data_exchange`, o endpoint devolve o primeiro que ainda falta. O `INIT` devolve sempre `SERVICO` (único entry do routing model publicado). Não há calendário genérico da Meta: o horário é a nossa lista.

Componentes confirmados na [referência de componentes](https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/components) (consultada 03/11/2026): `RadioButtonsGroup` e `CheckboxGroup` até 20 opções, título até 30 caracteres; `Dropdown` até 200 opções sem imagem, título até 30 caracteres. `DatePicker` existe e a mesma página avisa que o comportamento não é garantido se a clínica e a cliente estiverem em fusos diferentes. Por isso o horário **não** usa `DatePicker`.

| Ordem | Id do ecrã | Componente | Quando aparece | Salto |
| --- | --- | --- | --- | --- |
| 1 | `SERVICO` | `RadioButtonsGroup` dentro de `Form` (JSON publicado; revisão 05/11/2026 — deixa o Dropdown e o microcopy Meta «Enter {label}») | Depois de Agendar no `HUB`. Um só agendável: salta. Serviço já no quadro: `Form.init-values.service_id` = `${data.service_init}` pré-seleciona. Vários sem id: rádios sem selecção + `required: true` + corpo PT | O salto para o ecrã seguinte é no `data_exchange`. Zero agendáveis: o Flow fecha e o chat assume. Mais de 20: o chat assume (teto do RadioButtonsGroup). |
| 2 | `GENERO` | `RadioButtonsGroup` com `feminino` / `masculino` | O serviço tem variantes activas femininas **e** masculinas ao mesmo tempo — o mesmo critério de [`needsAudienceLine`](../../src/clinic/ai/variant-line.ts) | Um só sexo, só «ambos», ou a linha já está no quadro: salta. «Ambos» não é terceira opção; combina com a linha escolhida (DEC-079). |
| 3 | `VARIANTES` | `CheckboxGroup`, seleção múltipla das variantes reais, com preço | Há variantes activas na linha (ou na lista inteira, se não houve ecrã de género) | Sem variantes: salta e a visita usa a linha do serviço (DEC-078). Sem opção `todas`. |
| 4 | `HORARIO` | `Dropdown` com as horas livres | Sempre que o Flow chegou aqui com serviço (e variantes, se existirem) e ainda não há hora válida | Zero horas: não se mostra um dropdown vazio (o mínimo do componente é 1). O Flow termina e o chat envia a frase já existente de semana sem vaga. |

**Confirmado (DEC-079, não reaberto):** na mesma visita, «ambos» combina com masculino ou com feminino; masculino e feminino juntos são recusados e nada é gravado. O ecrã de género mais `zonesForAudienceLine` deixa só uma linha e as variantes «ambos», por isso a mistura nem entra na lista. A audiência do serviço (DEC-075) não filtra variantes e o contacto não ganha sexo.

**Confirmado (Paulo, 04/11/2026, ~14:34 America/Sao_Paulo, «Podemos retirar o Todas»):** a opção `todas` sai do `CheckboxGroup` do Flow. A cliente marca as variantes reais (DEC-078, `min-selected-items` = 1). Um id `todas` que ainda chegue é ignorado e não se grava. O rótulo Todas do M5 (DEC-134) e o «todas» do texto livre não mudam. Cabem 20 variantes (teto do componente). Acima disso o chat assume.

**Confirmado (mesmo momento; componente revisto 05/11/2026):** depois do hub, `SERVICO` usa `RadioButtonsGroup` (mesmo padrão do HUB), não `Dropdown` — o dropdown vazio da Meta mostrava «Enter Serviço». Se houver um só serviço agendável, o ecrã salta. Se o turno já souber o serviço, `service_init` pré-seleciona pela propriedade do `Form`, `init-values.service_id` (`init-value` no componente é recusado pelo validador, Flow JSON 7.3). Com vários serviços e sem id, `service_init` fica `""` (rádios sem selecção + corpo PT). O primeiro `data_exchange` sem id usa o pré-preenchido quando existir, sem apagar linha nem variantes já gravadas desse mesmo serviço. Trocar o serviço limpa o resto. Republicar o Flow JSON (`booking-flow.json`) no mesmo `flow_id`.

**Correção técnica (06/11/2026, sonda no staging às 17:20; Em aberto o caminho definitivo):** o `routing_model` publicado só tem a aresta `HUB → SERVICO`. Com serviço, linha e zonas já no quadro, o endpoint saltava do HUB para `HORARIO` e o cliente mostrava «Ocorreu um erro. Tente novamente mais tarde.». Até nova decisão, depois de Agendar no HUB o endpoint devolve sempre `SERVICO`, com o serviço pré-marcado por `service_init`, mesmo quando há um só serviço agendável. A partir de `SERVICO` os saltos para `GENERO`, `VARIANTES` ou `HORARIO` seguem como acima. **Em aberto (Paulo):** manter este passo extra, ou acrescentar arestas `HUB → GENERO/VARIANTES/HORARIO` e republicar o Flow JSON na Meta. Um teste verifica que cada salto devolvido existe no `routing_model`.

**Confirmado (preço, mesmo momento):** cada variante mostra o preço do cadastro no título quando cabe em 30 caracteres (`R$ 800,00`, o mesmo formato da proposta); se não cabe, o título fica o nome e a descrição leva o nome e o preço. O total da visita é o de `quoteVisit` (DEC-080, combo já aplicado) e aparece no corpo do `HORARIO`, depois da escolha. Não há total ao vivo no toque: o JSON não tem `on-select-action` no checkbox, e ficar no mesmo ecrã exigiria a aresta `VARIANTES → VARIANTES`. Sem preço cadastrado, a opção não inventa valor.

**Confirmado (DEC-104, mesmo momento):** depois do `nfm_reply` e antes da proposta, o chat envia «Recebi suas escolhas. Já preparo a proposta para você confirmar.» O Confirmar da proposta no chat mantém-se (DEC-061). Sem rótulo de fuso IANA.

**Proposto (horário):** a lista é a da agenda no relógio da clínica (`clinic_settings.timezone`; omissão `America/Sao_Paulo`), com dia da semana. Título visível no formato da DEC-138, por exemplo `terça 03/11 17:00`, sem nome de fuso IANA (DEC-137). O id da opção é `YYYY-MM-DDTHH:MM`, o mesmo de `offerFramePatch` e o que a [#507](https://github.com/intentzero/tredane/issues/507) torna obrigatório. A grade de início é `SCHEDULE_GRID_MINUTES = 15` ([`constants.ts`](../../src/clinic/constants.ts)). A vaga exige profissional que faz o serviço e está livre, e uma sala livre da lista do serviço (DEC-082), com o intervalo do cadastro. O Flow não mostra nem deixa escolher profissional ou sala. O preço da variante e o total da visita são a revisão de 04/11/2026 acima.

**Proposto (quantas horas):** os próximos 7 dias civis da clínica (o horizonte já usado em `AI_FREE_SLOT_DAYS`), todos os inícios livres da grade, do mais cedo ao mais tarde, no máximo 200 (teto do `Dropdown` sem imagem). O espaçamento de 30 min de `schedule-context.ts` é só para o contexto do modelo; não se aplica aqui. Se a lista for cortada nos 200, a copy do ecrã não promete que são todos; o texto livre continua a poder pedir outro dia.

**Proposto (Tempo, DEC-077):** o endpoint usa o mesmo filtro de horário automático que o chat (`queryAutomaticAvailability`), não a previsão crua. Se a previsão não responder a tempo do prazo da Meta (secção 5), o endpoint não oferece horas por filtrar. Devolve `error_message` e não lista slots «às escuras». O desenho do orçamento dentro dos 10 s fica **Em aberto** para a #514.

**Revisto (quadro já preenchido, 04/11/2026):** o `INIT` não salta ecrãs — isso partia o open (`invalid-screen-transition`, #545). O que o turno já gravou pré-seleciona o serviço e, no `data_exchange`, salta género, variantes ou horário que já estejam preenchidos. Se o turno já tem serviço, variantes (quando existem) e hora válidos, a proposta sai na hora (DEC-061) e o Flow não abre.

## 4. Como o Flow é aberto

**Confirmado (DEC-138):** a mensagem leva o botão do Flow quando a cliente quer agendar. Se o envio falhar, o chat é o recurso. Sem flag.

**Proposto (o que dispara):** o mesmo turno em que o funil de hoje passaria a perguntar serviço, linha, variantes ou horários — intenção de marcar no texto, ou resposta à saudação que pede para agendar — e em que ainda falta algum desses campos. Não dispara em handoff (DEC-083: pedido de pessoa, ofensa, saúde, remarcar/cancelar como assunto da equipe, etc.), nem quando a proposta já pode sair.

**Em aberto:** a remarcação de um compromisso existente (DEC-091) entra neste Flow de quatro ecrãs, ou continua na oferta actual do mesmo serviço. Recomendação: neste recorte a remarcação **não** muda; o Flow é marcação nova. A DEC-138 não fala em remarcar.

**Proposto (a mensagem):** uma mensagem interactiva Cloud API `type: flow`, no mesmo adaptador que hoje envia botão e lista, com:

- `flow_message_version`: `"3"`
- `flow_action`: `"data_exchange"` (o primeiro ecrã depende do quadro; por isso não se usa `navigate` com dados estáticos)
- `flow_id` do Flow publicado desse ambiente
- `flow_cta`: o rótulo da secção Copy
- `flow_token`: opaco, imprevisível, gerado no envio
- `mode`: `published` no caminho real; `draft` só no teste anterior à publicação

Fonte do formato: [enviar um Flow](https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/sendingaflow) (consultada 03/11/2026). O `flow_cta` é texto do botão; a página recomenda 30 caracteres ou menos, sem emoji. Não é o botão de resposta de 20 caracteres das listas.

**Proposto:** o envio segue o caminho que já existe: outbox no SQLite do DO, fila, [`outbound-send.ts`](../../src/whatsapp/outbound-send.ts) lê o vínculo activo da clínica no D1 e o token cifrado, e chama a Graph com o `phone_number_id` dessa clínica. Falha da Graph (Flow bloqueado `132068`, throttled `132069`, chave em falta, timeout) não silencia: o mesmo turno cai no chat. Códigos: [error codes](https://developers.facebook.com/docs/whatsapp/flows/reference/error-codes/) (consultada 03/11/2026).

**Proposto:** enquanto o bot prepara esta mensagem, vale o indicador de digitação da DEC-136, fail-soft.

## 5. Endpoint de dados

**Confirmado (Meta):** com `flow_action: data_exchange`, abrir o Flow gera um pedido `INIT`. Submeter um ecrã com `on-click-action` `data_exchange` gera outro pedido. O corpo HTTP é só `encrypted_flow_data`, `encrypted_aes_key` e `initial_vector`. O JSON decifrado traz `version`, `action` (`INIT`, `data_exchange`, `BACK` ou `ping`), `screen`, `data` e `flow_token`. Não traz `phone_number_id`. Fonte: [implementar o endpoint](https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/implementingyourflowendpoint/) (consultada 03/11/2026).

### Cifra

**Confirmado (Meta),** [cifra](https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/whatsapp-business-encryption) e o guia do endpoint:

- Par RSA de 2048 bits. A chave pública sobe com `POST /{PHONE_NUMBER_ID}/whatsapp_business_encryption`, campo `business_public_key`, token de system user com a permissão `whatsapp_business_messaging`. Um número por pedido. Volta a subir se o número for registado de novo ou se chegar alerta `public-key-missing` ou `public-key-signature-verification`.
- Para `data_api_version` 3.0: a chave AES de 128 bits vem de `encrypted_aes_key` com RSA/ECB/OAEP e SHA-256 (MGF1 com SHA-256). O payload usa AES-GCM; a tag de 128 bits vai no fim do bloco. A resposta cifra com a mesma chave AES e o IV do pedido com todos os bits invertidos (XOR `0xFF`), AAD vazio, e o corpo HTTP é o base64 em texto simples.
- Se não der para decifrar: HTTP 421. O cliente volta a buscar a chave pública e repete.

**Proposto:** a chave privada vive num segredo do ambiente (Worker secret), nunca no repositório, nunca em log, nunca no Flow JSON. A pública correspondente é a que se regista em cada número desse ambiente. Gerar sem frase-passe no PEM: o segredo do ambiente é a protecção. **Em aberto** o nome exacto do binding; recomendação `WHATSAPP_FLOW_PRIVATE_KEY`, distinto de `META_APP_SECRET`.

**Em aberto (chave por WABA):** o mesmo guia do endpoint diz que um Solution Partner deve usar endpoint e par de chaves dedicados por WABA. A issue #513 pede chave privada por ambiente. Com uma clínica de teste, os dois coincidem. Antes de uma segunda clínica no mesmo ambiente, o Paulo confirma se o par continua único no ambiente (a pública repete-se em cada número) ou passa a ser um par por WABA, selado como o token de acesso, fora do repositório na mesma.

**Proposto (versões a fixar na #514):** Flow JSON `7.3` e `data_api_version` `4.0`, as recomendadas no [changelog](https://developers.facebook.com/docs/whatsapp/flows/changelogs/) (página com data 07/11/2025, consultada 03/11/2026). A 4.0 acrescenta `flow_token_signature` (JWT HS256 com o app secret) a partir de Flow JSON 7.3. O guia de cifra que li descreve o algoritmo para a data API 3.0 e não descreve uma segunda cifra para a 4.0. **Em aberto:** se, no dia da #514, o guia passar a descrever uma cifra diferente para a 4.0, a implementação pára e este ADR actualiza-se. Até lá, a cifra é a da 3.0 e a assinatura do token verifica-se quando vier.

### Autenticação

**Confirmado (Meta):** o pedido traz `X-Hub-Signature-256` com `sha256=` e HMAC-SHA256 do corpo bruto, chave = app secret da aplicação ligada ao Flow. Falha de assinatura: HTTP 432. Fonte: o guia do endpoint, secção «Request signature validation».

**Proposto:** o endpoint verifica a assinatura no corpo original, com o mesmo `META_APP_SECRET` que [`webhook-verify.ts`](../../src/whatsapp/webhook-verify.ts) já usa no webhook de mensagens, e só depois decifra. Assinatura má → 432, sem consultar clínica. Além disso, o `flow_token` tem de existir, não estar expirado e bater certo com a assinatura `flow_token_signature` quando a versão 4.0 a enviar. Token desconhecido ou expirado → HTTP 427 com `error_msg` da secção Copy. O token não é previsível e não leva o id da clínica em claro.

### Tenant pelo número / WABA

**Confirmado (código):** o webhook de mensagens não cria tenant a partir de um id no payload. [`ingestWhatsappWebhook`](../../src/whatsapp/webhook-ingest.ts) resolve com `resolveTenantByPhoneNumberId` ([`bindings.ts`](../../src/whatsapp/bindings.ts)): uma linha `whatsapp_phone_bindings` com esse `phone_number_id` em `active` ou `interrupted`. O número não pode estar activo noutra clínica.

**Proposto:** o endpoint de dados não recebe o número no JSON. No envio, o servidor grava no D1 central uma linha do `flow_token` com o `tenant_id`, o `binding_id`, o `phone_number_id`, o `waba_id`, a `conversation_id` e o `catalogVersion` daquele momento. Esses ids são os do vínculo já resolvido, não um valor vindo da cliente. No pedido, o token só é aceite se essa linha existir e o vínculo continuar a ser o mesmo número na mesma clínica. Não se aceita `tenant_id` dentro de `data`.

### Isolamento

**Proposto**, no desenho do [ADR-0012](0012-clinic-durable-object-sqlite.md):

| Superfície | Regra |
| --- | --- |
| API do endpoint | Assinatura, cifra e token no Worker. Sem DO antes disso. O Worker chama só `CLINIC.idFromName(tenantId)` do token. |
| D1 central | A linha do token e o vínculo WhatsApp. Não é fonte do quadro nem da agenda. |
| SQLite do DO | Catálogo, agenda e, mais tarde, o `BookingFrame`. O DO recusa chamador cujo `tenantId` não é o nome da instância (`#assertInstanceTenant` em [`clinic-do.ts`](../../src/worker/clinic-do.ts)). |
| Queues | O `nfm_reply` entra na fila de webhook já com o `tenantId` do número, como as outras mensagens. O consumidor só fala com o DO desse tenant. |
| R2 | O Flow não grava anexo. |
| WebSocket | `booking_frame.updated` só para membros daquele tenant, como no ADR-0015. |
| Entre clínicas | Não há leitura de outro DO «para comparar horas». Não há transacção única D1 + SQLite + Meta. |

**Proposto:** o endpoint não chama o modelo, não envia WhatsApp e não escreve o `BookingFrame`. Lê catálogo e agenda e devolve o ecrã. A escrita do quadro fica no `nfm_reply` (secção 6), na mesma transacção da mensagem de saída.

### Idempotência, prazos, erros

**Confirmado (Meta):** health check periódico, `action: ping`, resposta `{ "data": { "status": "active" } }`. O endpoint tem de o cumprir antes de publicar. Pedido com mais de 10 s → `timeout_error` no cliente. Fonte: o guia do endpoint e a tabela de [error codes](https://developers.facebook.com/docs/whatsapp/flows/reference/error-codes/).

**Proposto:**

- `ping` não lê clínica e não grava nada.
- `INIT`, `BACK` e `data_exchange` são leituras. Repetir o mesmo pedido devolve o mesmo ecrã para o mesmo token, catálogo e agenda. Não criam compromisso nem proposta.
- Resposta de ecrã seguinte: `{ "screen", "data" }`. Input inválido (variante de outra linha, id que já não existe): o mesmo ecrã com `error_message`, que a Meta mostra como snackbar. Fonte: o guia do endpoint.
- Conclusão do Flow, ainda no endpoint: `{ "screen": "SUCCESS", "data": { "extension_message_response": { "params": { "flow_token", …escolhas } } } }`. Esses `params` seguem para o webhook. `SUCCESS` é nome reservado; nenhum ecrã nosso usa esse id.
- Prazo do token: 24 h desde o envio, ou até um token novo da mesma conversa o substituir — o mesmo horizonte da oferta na DEC-127. Depois disso, 427 e o botão deixa de servir; a cliente pede de novo no chat.
- Erro nosso inesperado: não devolver 500 opaco se der para responder com `error_message`. A Meta trata status inesperado como `unexpected_http_status_code` e pode throttlear ou bloquear o Flow ([health monitoring](https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/healthmonitoring)).
- Log: acção, id de ecrã, tenant, resultado. Sem corpo decifrado, sem `response_json`, sem número da cliente.

**Confirmado (dados pessoais, issue #513):** o Flow não pede nome, telefone, documento nem saúde. Só as escolhas. O número da cliente já está na conversa.

## 6. `nfm_reply` e o quadro

**Confirmado (Meta):** ao concluir, a cliente manda uma mensagem `interactive` / `nfm_reply` para o webhook de mensagens que já usamos. `nfm_reply.response_json` é uma string JSON com `flow_token` e os `params` do SUCCESS. O `context.id` é a mensagem do Flow. O corpo visível é `Sent`. A resposta **não** traz o Flow ID; o token é a correlação. Fonte: [webhooks de Flows](https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/flowswebhooks) (consultada 03/11/2026).

**Confirmado (código):** hoje esse `interactive.type` não é `button_reply` nem `list_reply`, logo seria `unsupported`. A [#514](https://github.com/intentzero/tredane/issues/514) passa a reconhecê-lo. O recibo continua idempotente pela chave `wa:msg:{id}` que o parser já usa.

**Proposto (um só quadro, [#510](https://github.com/intentzero/tredane/issues/510)):** o resultado escreve o `BookingFrame` da conversa (ADR-0015: uma linha em `schedule_sessions`, mesma transacção que a mensagem de saída). Não há segundo quadro para o Flow. Campos:

- `serviceId`, `line`, `variantIds` — ids do catálogo, não os títulos
- `date` + `time` — lidos do id `YYYY-MM-DDTHH:MM` da [#507](https://github.com/intentzero/tredane/issues/507), nunca do título `terça 03/11`
- `catalogVersion` — a versão contra a qual as escolhas foram aceites
- `provenance` — **Proposto** alargar a união do ADR-0015 com `source: 'flow'` na #514. Não mapear para `botao`, que é o toque M5.
- `phase` `ofertado` ao gravar a hora; `proposto` quando a proposta sair

O id de horário não escolhe profissional nem sala. Na montagem da proposta, o servidor volta a consultar a agenda e ata a profissional e a sala livres, como o chat já faz. Isso não é escolha da cliente.

**Confirmado (DEC-061):** em seguida o chat envia a proposta versionada (id + versão, 30 min, clínica, serviço, data com fuso, início e fim, profissional quando houver, preço e sinal). Só o botão Confirmar marca, dentro da transacção, uma vez. Texto «sim», o fecho do Flow e o `nfm_reply` não marcam. Serviço com sinal não reserva: segue o Pix (DEC-047).

**Proposto (hora ocupada ou expirada):** se, ao receber o `nfm_reply`, o id já não está livre, o tempo não serve (DEC-077) ou o token expirou, não se cria compromisso nem proposta de marcação. O chat explica e oferece outras horas, com as frases determinísticas que o funil já tem (`sem_vaga_*`, `sem_horario_*`, frases de tempo). Não se inventa frase nova para este caso neste ADR. A lista de alternativas, se for interactiva, só existe até a [#515](https://github.com/intentzero/tredane/issues/515); depois da retirada do M5, as alternativas vão em texto, no mesmo quadro.

**Proposto (idempotência do fecho):** o mesmo `wamid` não grava duas vezes. Um segundo `nfm_reply` do mesmo token, com as mesmas escolhas e proposta ainda válida, não envia outra proposta. Escolhas materialmente diferentes invalidam a proposta anterior e enviam nova versão (DEC-061).

**Proposto:** `catalogVersion` divergente no fecho revalida ids como `revalidateFrameCatalogIds` / `syncBookingFrameWithCatalog`. Id que já não existe é limpo, sem substituto inventado (ADR-0015). Se faltar serviço ou variante, não há proposta: o chat pergunta o que falta.

## 7. Versões, publicação, catálogo a meio do Flow

**Confirmado (Meta),** [Flows API](https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/flowsapi/) (página com data 16/06/2026) e [changelog](https://developers.facebook.com/docs/whatsapp/flows/changelogs/):

- Criar: `POST /{WABA-ID}/flows`. Estado inicial `DRAFT`. Categoria **Proposta:** `APPOINTMENT_BOOKING` (valor que a API lista).
- `endpoint_uri` vai na API, não no JSON, para Flow JSON ≥ 3.0.
- Publicar: `POST /{FLOW-ID}/publish`.
- Estados que a API devolve: `DRAFT`, `PUBLISHED`, `DEPRECATED`, `BLOCKED`, `THROTTLED`. `THROTTLED` deixa abrir, mas só 10 mensagens por hora. `BLOCKED` não envia nem abre. `DEPRECATED` não se envia a clientes reais; respostas de um Flow já aberto ainda podem chegar.
- Apagar só em `DRAFT`. Publicado deprecia-se (`POST /{FLOW-ID}/deprecate`); não se apaga (erro 139004).
- Desde 08/10/2024 o changelog diz que um Flow publicado pode ser editado (metadados ou JSON) e voltar a Draft, no mesmo `flow_id`. A página de [lifecycle](https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/lifecycle) descreve o mesmo, e o excerto consultado acrescenta: mensagens já enviadas não mudam; só mensagens novas, depois de republicar, levam o JSON novo; a Meta guarda até 5 versões e deprecia as mais antigas.
- A página de erros, actualizada em 02/07/2026, ainda documenta 139001: Flow publicado não se actualiza; a saída é clonar (`clone_flow_id`) e publicar o clone. 139002: não se republica o que já não está em draft.

**Em aberto:** qual destas duas páginas a Graph API do WABA de teste cumpre no dia da #514. **Proposto** até essa prova: tentar actualizar o mesmo `flow_id`; se a API devolver 139001, clonar, publicar e passar a enviar o id novo. Não assumir os dois como verdade ao mesmo tempo.

**Proposto (contrato estável):** os ids `SERVICO`, `GENERO`, `VARIANTES` e `HORARIO` não mudam entre versões. Partir um id é Flow novo, não um retoque. O endpoint responde pelo token, não por uma cópia congelada do JSON: um Flow já aberto no telemóvel continua a falar com o endpoint enquanto o token for válido.

**Proposto (`catalogVersion`):** em cada `data_exchange` o DO compara a versão do token com `readCatalogVersion` (`updated_at` máximo de serviços e de recursos, [`turn-context.ts`](../../src/clinic/ai/turn-context.ts)). Se divergir:

- ids que continuam válidos mantêm-se e o ecrã seguinte usa-os;
- id inválido não é substituído; o endpoint devolve o ecrã desse campo com `error_message` (secção Copy);
- a hora já escolhida volta a ser calculada; se deixou de estar livre, o ecrã `HORARIO` pede outra, sem marcar.

Isto é a regra do ADR-0015 aplicada no meio do Flow, não uma segunda política.

## 8. Pré-requisitos na Meta

Cada linha foi lida na documentação oficial em 03/11/2026. Nada disto está feito por este ADR. Não há deploy.

| Passo | O que a documentação diz | Fonte | Estado |
| --- | --- | --- | --- |
| Permissões do token | Scopes `whatsapp_business_management` e `whatsapp_business_messaging`, com o WABA nos granular scopes. No ecrã da conta: Message templates (view and manage) e Phone Numbers (view and manage). | [Flows API — troubleshooting](https://developers.facebook.com/docs/whatsapp/flows/reference/flowsapi/) | **Confirmado** (a doc); **Em aberto** se o token do WABA de teste já os tem |
| Verificação do negócio e qualidade | Para enviar e publicar, o negócio tem de estar verificado e com qualidade de mensagem alta. Criar o Flow em draft não exige isso. | [changelog, 08/10/2024](https://developers.facebook.com/docs/whatsapp/flows/changelogs/); [Flows API, Publishing](https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/flowsapi/) | **Confirmado** (a doc); **Em aberto** o estado do WABA de teste |
| Aplicação ligada ao Flow | `application_id` no Flow. Sem aplicação, a publicação falha. | Flows API, campo `application_id`; erro 139002 «No Application Connected to the Flow» | **Confirmado** (a doc) |
| URL pública do endpoint | HTTPS, POST, certificado TLS válido. O TLS não é a cifra do payload. `endpoint_uri` na API. | [guia do endpoint](https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/implementingyourflowendpoint/) | **Confirmado** (a doc); **Em aberto** o hostname do ambiente de teste (não se escolhe aqui) |
| Health check | `ping` → `{ "data": { "status": "active" } }` antes de publicar. | O mesmo guia; [health monitoring](https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/healthmonitoring) | **Confirmado** (a doc) |
| Chave pública | RSA 2048, `POST /{PHONE_NUMBER_ID}/whatsapp_business_encryption`, por número, permissão `whatsapp_business_messaging`. | [cifra](https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/whatsapp-business-encryption) | **Confirmado** (a doc); **Em aberto** o registo no número de teste |
| Webhook `flows` | No painel da app: WhatsApp → Configuration → Webhooks → subscrever `flows` e `messages`. O campo do aviso de estado é `flows`. Para um WABA concreto, `POST /{WABA-ID}/subscribed_apps`. Sem esta subscrição a publicação falha. | [webhooks de Flows](https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/flowswebhooks); [health monitoring](https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/healthmonitoring) | **Confirmado** (a doc); **Em aberto** se o WABA de teste já subscreve `flows`. O `nfm_reply` em si chega no webhook `messages`, que o Tredane já trata. |
| Versões publicáveis | Publicar: Flow JSON 5.1–7.3 (7.3 recomendada); data API 3.0 ou 4.0 (4.0 recomendada); mensagem versão 3. | [changelog](https://developers.facebook.com/docs/whatsapp/flows/changelogs/) | **Confirmado** (a tabela); a escolha 7.3 / 4.0 é **Proposto** |
| App Review | Parceiro pode precisar de `whatsapp_business_messaging` e App Review para webhooks de contas de clientes. Dá para testar durante a revisão. | [webhooks de Flows](https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/flowswebhooks) | **Em aberto** se o WABA da clínica de teste, já ligado por Embedded Signup, exige mais alguma revisão para este Flow. Não confirmei um nome de permissão além dos dois scopes acima. |
| Chave por WABA vs por ambiente | O guia pede par dedicado por WABA para Solution Partner. A issue #513 pede privada por ambiente. | Guia do endpoint | **Em aberto** (secção 5) |

**Confirmado:** o nome antigo `data_channel_uri` está deprecado; o campo actual é `endpoint_uri`. Erros 139002 ainda mencionam os dois.

## 9. O que sai do M5 e o que fica

**Confirmado (DEC-138, [#515](https://github.com/intentzero/tredane/issues/515)):** quando o Flow entrar, saem as listas e botões de escolha do M5. No código de hoje isso é:

- botões Feminina / Masculina (`buildLineChoiceInteractive`)
- lista Opções, incluindo a linha Todas (`buildVariantChoiceInteractive`)
- lista Horários (`buildSlotChoiceInteractive`)

A [#515](https://github.com/intentzero/tredane/issues/515) apaga esse envio. A [#514](https://github.com/intentzero/tredane/issues/514) deixa de o usar no caminho de marcar. Sem flag intermédia: não se mantêm as listas como alternativa permanente (opção que a DEC-138 descartou). O chat em texto livre mantém-se.

**Confirmado (fica):**

- Confirmar da proposta versionada (DEC-061)
- Falar com a equipe, nas respostas automáticas e como botão da proposta (DEC-083)
- Follow-ups já decididos: «Não, obrigado» / «Quero outro serviço» (DEC-086) e prosseguir / terminar no idle (DEC-087)
- Botões **Sim / Corrigir** do eco da DEC-137 no caminho de texto livre (**Confirmado**, Paulo, 04/11/2026 America/Sao_Paulo, opção A; fecha o Em aberto da [#515](https://github.com/intentzero/tredane/issues/515)). O texto livre continua; o eco continua a ser obrigatório nesse caminho; Sim não marca (DEC-061); Corrigir volta a perguntar as zonas. Não são o M5 de serviço/hora; são a confirmação do que o texto livre percebeu.

**Proposto (fica também):** Alterar detalhes da proposta. É acção da DEC-061, não é lista de escolha do M5. A DEC-138 não o lista na frase «ficam», mas também não o manda retirar.

## 10. Copy para aprovação do Paulo

**Confirmado (DEC-104; Paulo, 04/11/2026 America/Sao_Paulo, opção A), com revisão no mesmo dia (~14:34) depois do open em staging:** C1–C3, C5–C7 e C9–C15 ficam como na aprovação da opção A. C4 ganha a variante C4b, C8 deixa de citar Todas, C10 pode levar o total na linha seguinte, e entra C16. Rótulos reutilizados no Flow: **Feminina**, **Masculina** (DEC-134). **Todas** fica só no M5 / texto livre, não neste Flow. O plural do tipo («Zonas», etc.) vem do cadastro (DEC-079). Os títulos das horas (`terça 03/11 17:00`) são o formato da DEC-138, não uma frase. Frases de vaga ocupada, semana vazia e tempo (DEC-077) reutilizam o catálogo determinístico já existente; não estão nesta lista.

| Id | Onde | Texto Confirmado |
| --- | --- | --- |
| C1 | Corpo da mensagem que abre o Flow | Para marcar, toque em Escolher horário. Você escolhe o serviço, as opções e um horário livre. Depois eu envio a proposta para você confirmar. |
| C2 | Botão `flow_cta` (16 caracteres, sem emoji) | Escolher horário |
| C3 | Ecrã `SERVICO`, título | Serviço |
| C4 | Ecrã `SERVICO`, texto, quando ainda não há serviço | Qual serviço você quer marcar? |
| C4b | Ecrã `SERVICO`, texto, serviço único ou já escolhido | Depilação é o único serviço para marcar. Toque em Continuar. / O serviço já escolhido é Depilação. Toque em Continuar, ou troque se for outro. |
| C5 | Botão de continuar dos ecrãs 1 a 3 | Continuar |
| C6 | Ecrã `GENERO`, título | Versão |
| C7 | Ecrã `GENERO`, texto | Para {serviço}, qual versão? |
| C8 | Ecrã `VARIANTES`, texto | Pode marcar mais de uma. O preço está em cada opção; o total aparece no horário. |
| C9 | Ecrã `HORARIO`, título | Horário |
| C10 | Ecrã `HORARIO`, texto | Estes horários estão livres no relógio da clínica. |
| C10b | Mesmo ecrã, linha seguinte quando há preço | Total: R$ 160,00 (combo Axila e pernas) — só se `quoteVisit` tiver preço; o nome do combo só entra quando um combo vale |
| C16 | Chat, depois do fecho do Flow e antes da proposta (DEC-104) | Recebi suas escolhas. Já preparo a proposta para você confirmar. |
| C11 | Botão do ecrã `HORARIO` | Ver proposta |
| C12 | O Flow não chegou a abrir | Não consegui abrir a escolha. Pode me dizer por aqui o que quer marcar. |
| C13 | HTTP 427, `error_msg` que a cliente vê | Esta escolha expirou. Peça de novo no chat. |
| C14 | `error_message` quando o cadastro mudou | O cadastro mudou. Vamos refazer o que deixou de valer. |
| C15 | `error_message` quando a hora saiu da lista dentro do Flow | Esse horário já não está livre. Escolha outro. |

Exemplos fictícios. `{serviço}` é o nome do cadastro, não texto fixo.

## 11. Testes previstos

**Proposto.** Nada disto corre neste ADR.

1. **Flow simulado de ponta a ponta (L1, sem Graph e sem WABA).** Chave RSA gerada no teste, nunca a do ambiente. Cifrar um `INIT` que pousa em `SERVICO` (mesmo com serviço já na sessão), percorrer os saltos (um serviço pré-selecionado; dois sexos; sem variantes; sem `todas`; preço na opção; total no horário; mais de 20 variantes → chat), receber horas com dia da semana no fuso da clínica, concluir com SUCCESS, entregar um `nfm_reply` sintético, gravar um único `BookingFrame` com o id `YYYY-MM-DDTHH:MM`, enviar a frase de espera e a proposta versionada. Confirmar marca. O texto «sim» não marca. O mesmo `wamid` não grava duas vezes. Token de outra clínica não lê este DO.
2. **Casos da sonda ([#506](https://github.com/intentzero/tredane/issues/506)).** Zona que não pode cair em silêncio; dia presente no id e no título `terça 03/11 17:00`; sessão antiga que não salta para horas; Confirmar expirado que não marca; catálogo sem match que não despeja um link. As quatro métricas do F1-0 medem também o Flow: marcação igual ao pedido, zonas pedidas que entraram, correções, voltas até ao Confirmar. No L1, no L2/L3 ([#417](https://github.com/intentzero/tredane/issues/417)) e na sonda manual, como o épico já fixa.
3. **Teste real no WABA da clínica de teste, antes do merge da #514** (DEC-138). Publicar ou usar `mode: draft` nesse WABA, com a chave e o endpoint desse ambiente. Sem este teste, a #514 não faz merge. Este ADR não marca esse teste como feito.
4. **Estrago.** As mesmas quatro métricas, com exemplos fictícios. Queda (Flow que não abre, 421/432/427, timeout > 10 s, `BLOCKED` / `THROTTLED`) conta como volta extra e cai no chat, sem marcação.

## 12. O que fica de fora

**Confirmado:** DEC-061 (só o botão marca), DEC-079 (género da variante, nada sobre a pessoa), DEC-083 (equipe e pausa), DEC-104 (frase nova só com o Paulo), DEC-127 (validade da oferta, um quadro, `catalogVersion`). Pix, sala, profissional e preço editável continuam fora do Flow (DEC-138).

**Confirmado** (Paulo, 04/11/2026, opção A): o desenho das secções 2 a 7, 9 (Alterar detalhes) e 11. **Confirmado** (Paulo, 04/11/2026 America/Sao_Paulo, opção A): a copy C1–C15 da secção 10. Na secção 13, o item 6 (Sim/Corrigir) ficou **Confirmado**; os restantes permanecem **Em aberto**.

## 13. Em aberto

1. Chave privada por ambiente (pedido da #513) ou par por WABA (recomendação Meta para Solution Partner), antes da segunda clínica.
2. Se a Graph API do WABA de teste ainda devolve 139001 ao editar um Flow publicado, ou se a edição no mesmo `flow_id` (changelog de 08/10/2024) já é o comportamento real. Inclui se a Meta guarda mesmo 5 versões.
3. Cifra da data API 4.0, se o guia deixar de ser o algoritmo da 3.0.
4. Hostname do endpoint de teste, se o token actual tem os scopes, se o negócio está verificado, se a chave pública já está no número, se o WABA subscreve o campo `flows`, e se o App Review pede mais alguma permissão para este WABA.
5. Remarcação (DEC-091) dentro deste Flow. Recomendação: fora deste recorte.
6. ~~Botões Sim / Corrigir do eco (DEC-137).~~ **Confirmado** (Paulo, 04/11/2026 America/Sao_Paulo, opção A): **mantêm-se**. Ver secção 9 e [#515](https://github.com/intentzero/tredane/issues/515).
7. Mais de 200 serviços agendáveis, ou mais de 19 variantes numa linha. Recomendação: o chat assume.
8. Orçamento de tempo da previsão (DEC-077) dentro dos 10 s do endpoint.
9. Nome do Worker secret da chave privada. Recomendação: `WHATSAPP_FLOW_PRIVATE_KEY`.

A implementação ([#514](https://github.com/intentzero/tredane/issues/514)) depende também da [#507](https://github.com/intentzero/tredane/issues/507), da [#510](https://github.com/intentzero/tredane/issues/510) e dos pré-requisitos Meta que estiverem fechados. A revisão do ADR (#513) e a copy C1–C15 da secção 10 ficaram fechadas com este Confirmado.
