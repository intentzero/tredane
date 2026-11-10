# Referência de arquitetura para quem altera código

**Para quem:** um agente que vai mudar código e precisa de não violar invariantes.

**O que é:** um índice curto. Cada regra está resumida e aponta para a DEC, o ADR ou o ficheiro. O texto longo fica na fonte.

**O que não decide:** não cria DEC nem ADR, não promove proposta e não descreve topologia que não esteja num ADR. Se este ficheiro divergir de uma DEC ou de um ADR, vale a DEC ou o ADR, e este ficheiro corrige-se.

**Base lida:** `main` @ `0e75888` (merge do [#574](https://github.com/intentzero/tredane/pull/574), 06/11/2026). As quatro leituras de 06/11 ainda não estão neste commit.

## Onde está a verdade

- **Confirmado** ([`docs/MVP.md`](../MVP.md)): objetivo, recorte, decisões e limites do MVP. Mantém-se curto; o detalhe está nos documentos que ele aponta.
- **Confirmado** ([`docs/product/decisions.md`](../product/decisions.md)): registo das DEC. O estado é o da linha. Uma proposta não passa a decisão porque encaixa no código.
- **Confirmado** ([`docs/adr/`](../adr/)): desenho de engenharia. O estado está no cabeçalho de cada ADR.
- **Confirmado** ([issue #1](https://github.com/intentzero/tredane/issues/1), [`AGENTS.md`](../../AGENTS.md)): checkboxes de issue não substituem especificação aprovada. Hipóteses em [`docs/implementation/plan.md`](../implementation/plan.md), [`docs/product/states.md`](../product/states.md) e no validation-register cedem às decisões confirmadas ([issue #14](https://github.com/intentzero/tredane/issues/14)).
- **Confirmado** como mapa de 23/10/2026, com mecanismos abaixo do cabeçalho ainda sujeitos a validação ([`overview.md`](overview.md)): decisões posteriores prevalecem sobre a lista «em aberto» desse mapa.
- **Proposto** ([`nucleo-deterministico-conversacional.md`](nucleo-deterministico-conversacional.md)): análise de engenharia pedida em 01/11/2026. Não é o comportamento do código. Não o implementes como se a tese já fosse o produto.

## O que não podes partir

1. **Confirmado** (DEC-038, [ADR-0012](../adr/0012-clinic-durable-object-sqlite.md)): um Durable Object por clínica, com SQLite nativo para o operacional. O D1 central é administrativo. O SQLite do DO não é um D1. Um DO por clínica não isola D1, R2, Queues nem Workflows.
2. **Confirmado** (DEC-017, [ADR-0006](../adr/0006-clerk-platform-admin.md)): Clerk sem Organizations. `privateMetadata.superadmin` só é autoritativo no backend. Membership e role vivem no D1. A clínica activa é explícita. Cada contexto revalida e não reaproveita cache nem WebSocket de outro tenant.
3. **Confirmado** (DEC-038, ADR-0012, [ADR-0015](../adr/0015-estado-persistente-da-conversa.md)): o painel recebe tempo real por WebSocket do DO da clínica. A fonte de verdade operacional é o SQLite desse DO. Memória e WebSocket não a substituem.
4. **Confirmado** (DEC-061, revista da DEC-060): só o botão Confirmar de uma proposta versionada pelo backend, ainda válida, marca. Texto livre não marca. O Sim do eco não marca (DEC-137). O fecho do Flow não marca (DEC-138, [ADR-0016](../adr/0016-whatsapp-flow-agendamento.md)).
5. **Confirmado** (DEC-104, ADR-0016): o modelo não escolhe zona, hora nem marcação. No atendimento automático, a frase à cliente é determinística; o LLM interpreta o que o código não cobre e responde a perguntas abertas, com validador.
6. **Confirmado** (DEC-138, ADR-0015, ADR-0016): o Flow é o percurso por ids. O texto livre preenche o mesmo `BookingFrame`. Não há segundo quadro.
7. **Confirmado** (Paulo, conversa de 06/11/2026): as quatro leituras da secção seguinte. Não estão em `docs/product/decisions.md` de `main`. O código que as aplica está em curso no [#580](https://github.com/intentzero/tredane/pull/580). Não assumas que `main` já as cumpre, e não escrevas o contrário.
8. **Proposto** (núcleo determinístico em [`nucleo-deterministico-conversacional.md`](nucleo-deterministico-conversacional.md)): o grafo completo por turno. O actualizador único do quadro ([#579](https://github.com/intentzero/tredane/issues/579)) vive em `src/clinic/ai/apply-booking-update.ts` (#575–#578 + intents PR-D). Ainda há bypasses residuais em `autobook`/`catalog-reply` (gramática compare/mention_only diferida).

## O que o Tredane é

- **Confirmado** ([`docs/MVP.md`](../MVP.md)): SaaS multi-tenant de atendimento para clínicas de estética, com pipeline comercial, agenda própria e assistência por IA.
- **Confirmado** (DEC-009, MVP): o canal é a API oficial do WhatsApp Business. A owner liga a conta da clínica por Embedded Signup, com assistência do Tredane no piloto. Cadastro Tech Provider, modelos reais e autorização Meta continuam gates externos ([`docs/product/pilot-gates.md`](../product/pilot-gates.md)).
- **Confirmado** (MVP; DEC-104 para o atendimento automático): o primeiro recorte de IA é assistivo, com sugestão e revisão humana no painel. Mensagem que sai sozinha no caminho normal é frase do backend. Resposta ou agendamento autónomos ficam fora, salvo o compromisso que a própria cliente confirma no botão da proposta (DEC-060, revista pela DEC-061).

## Onde vive cada dado

**Confirmado** (DEC-038, [ADR-0012](../adr/0012-clinic-durable-object-sqlite.md); campos em [`data-model.md`](data-model.md)):

| Sítio | O que guarda |
| --- | --- |
| D1 central | Tenants, memberships N:N e roles, convites, pedidos e sessões de suporte, auditoria administrativa. |
| SQLite do Durable Object da clínica | Operacional: contactos, conversas, mensagens, pipeline, serviços, recursos, agenda, propostas, deduplicação e outbox. Não é D1. |
| R2 privado | Anexos da clínica, servidos depois de autorização. Metadados operacionais ficam no SQLite da clínica. |

**Confirmado** (ADR-0012): não há transacção única entre D1, SQLite do DO, R2 e provedores. O Worker escolhe a instância do DO pelo id interno do tenant, depois de validar identidade ou integração. Nenhum `tenant_id` livre do cliente concede acesso.

**Em aberto** (ADR-0012): protocolo de revogação D1/DO, migrações por instância e recuperação. Não inventes esse protocolo. O índice que resolve número WhatsApp para tenant, e o sítio das credenciais, continuam **Proposto/Em aberto** no mesmo ADR.

**Confirmado** (ADR-0012): efeito externo em Queue ou Workflow leva o tenant e uma chave idempotente. Não fica isolado por existir um DO por clínica. **Em aberto** ([`overview.md`](overview.md)): se a primeira fatia já corre Workflows. Não acrescentes um motor novo por inferência.

## Identidade

**Confirmado** (DEC-017, [ADR-0006](../adr/0006-clerk-platform-admin.md); contratos em [`identity-and-admin.md`](identity-and-admin.md)):

- Clerk autentica a sessão. Sem Organizations, sem `orgId` e sem impersonação Clerk.
- `privateMetadata.superadmin === true` só o backend consulta. O browser, `publicMetadata` e uma claim antiga não autorizam.
- Membership N:N e role por tenant estão no D1. A flag de superadmin não abre o conteúdo da clínica.
- A pessoa escolhe e troca a clínica activa. Cada pedido e cada WebSocket revalidam o membership vigente. Cache e socket de outro tenant não se reaproveitam (DEC-017, DEC-026).
- A Platform Admin é outra aplicação. O suporte usa sessão própria do Tredane no D1, com actor e subject distintos ([ADR-0007](../adr/0007-support-impersonation.md)). Handoff, retenção e política de mutação do suporte ficam por especificar antes de uso real (MVP).

## Tempo real

**Confirmado** (MVP, DEC-038, ADR-0012): o painel actualiza-se por WebSocket, com hibernação no Durable Object. Há um DO por clínica; essa instância coordena os sockets dela.

**Confirmado** ([`overview.md`](overview.md), ADR-0015): o evento sai depois do commit no SQLite, só para sessões autorizadas daquele tenant. Ao ligar ou religar, o painel relê a API. O WebSocket não é fonte de verdade.

**Confirmado** (DEC-026): revogar um membership corta API e WebSocket desse tenant, incluindo ligações hibernadas, sem encerrar a sessão Clerk nem os outros memberships. **Em aberto** (ADR-0012): o protocolo que prova essa revogação entre D1 e DO. Não o substituas por cache com TTL.

## Conversa

**Confirmado** (DEC-127, [ADR-0015](../adr/0015-estado-persistente-da-conversa.md)): uma conversa tem um `BookingFrame` no SQLite do DO da clínica. A tabela SQL chama-se `schedule_sessions`. Memória, WebSocket e releitura do texto enviado não são a fonte desse quadro.

**Proposto** (DEC-148): a tabela `booking_sessions` no mesmo SQLite é a projecção analítica do funil (opened/ended, `outcome`, `dropStep`). Não substitui o `BookingFrame`. Sem corpo de mensagem. Janela W de abandono **Confirmado** **24 h** (Paulo P4, 07/11/2026; alinhada à DEC-127). **T2:** o evento `ai.turn_decided` liga-se à sessão (`sessionId`), ao `step` do funil e a friction flags mínimas (sem transcript). **T3:** `booking_session.flow` (sent/opened/completed/skipped) + `flowUsed`; `offer_skipped` via outbox; `opened_at` D1 liga-se ao mesmo `sessionId` via Clinic DO. **T4:** leitura operacional via `scripts/booking-session-funnel.mjs` + [runbook](../implementation/runbooks/booking-session-funnel.md) (agregados; sem UI de transcript). **T5:** ritual semanal — amostra N + rótulos humanos + backlog stop/synonym só-lista (`scripts/booking-session-weekly-sample.mjs` + [runbook](../implementation/runbooks/booking-session-weekly-ritual.md)); alinha DEC-141; sem auto-apply.

**Confirmado** (DEC-157): fila «Para revisão» nas Conversas + comando WhatsApp `avaliar`/`feedback` + auto-flag em friction `nao_encontrei`. Corpos ficam nas `messages` do DO; API estável `GET /review/conversations` (pré-requisito MCP). Não pausa a IA (orthogonal a DEC-083).

**Confirmado** (DEC-158, Paulo prefs 10/11/2026): MCP multi-tenant **só leitura** em `POST /api/mcp/review` sobre a API DEC-157 — tools `list_review_conversations`, `get_review_conversation`, `propose_review_diagnosis` (diagnóstico agent-side; servidor não chama LLM nem persiste). Auth = Clerk session Bearer (igual ao painel); `tenantId` obrigatório; membership + `clinic.inbox.read`; sem dump cross-tenant; sem retenção LGPD nova. Desenho: store `docs/review-conversations-mcp.md`.

**Confirmado** (DEC-138, [ADR-0016](../adr/0016-whatsapp-flow-agendamento.md)): o caminho principal de agendar é um WhatsApp Flow por ids (`data_exchange`, quatro passos). O texto livre continua e preenche o mesmo quadro, com o eco da DEC-137. Se o Flow não abrir, o chat assume. O Flow não marca: no fim, o chat envia a proposta, e só o Confirmar marca (DEC-061).

**Proposto** (ADR-0016 §5–§6): o endpoint de `data_exchange` lê catálogo e agenda e devolve o ecrã; a escrita do quadro fica no `nfm_reply`. Não trates o sítio da escrita como decisão fechada. O quadro único é que está fechado (DEC-138).

**Confirmado** (DEC-104): o modelo não escolhe zona, hora nem marcação. A frase automática sai do backend.

**Confirmado** (DEC-142): pedido de listar o catálogo («quais serviços você tem?», «quero outro serviço» e equivalentes) é frase do backend. Sem audiência nesta conversa, lista interativa com as linhas Feminino e Masculino — não é o CTA do Flow nem botão de resposta. Com audiência, texto com os nomes ativos dessa audiência ou qualquer. Não marca.

**Confirmado** (DEC-061): o único commit do horário é o botão Confirmar de uma proposta versionada e ainda válida. Qualquer mudança material pede nova versão; a anterior deixa de valer.

## Quatro leituras de 06/11/2026

**Confirmado** (Paulo, conversa de 06/11/2026). Não revogam DEC-061, DEC-104, DEC-127, DEC-128, DEC-135, DEC-137, DEC-138 nem ADR-0016.

Em `main` @ `0e75888`, `docs/product/decisions.md` ainda não traz estas notas. A implementação está em curso no [#580](https://github.com/intentzero/tredane/pull/580) (issues [#575](https://github.com/intentzero/tredane/issues/575)–[#578](https://github.com/intentzero/tredane/issues/578)). O actualizador único é a [#579](https://github.com/intentzero/tredane/issues/579) e ainda não está feito. Até o #580 entrar em `main`, o código de `main` não cumpre estas leituras.

1. **Confirmado** (opção A, leitura da DEC-137 (1); [#575](https://github.com/intentzero/tredane/issues/575)). Partícula e forma de hora que não nomeiam zona não são zona a mais. Há uma fonte de hora: a forma de hora conta como hora, não como zona por explicar. Zona desconhecida («cotovelo») pergunta, não propõe e não apaga as zonas já nomeadas.
2. **Confirmado** (opção A; [#576](https://github.com/intentzero/tredane/issues/576)). O eco de uma substituição resolvida («Entendi: … Certo?») suspende o Confirmar da proposta anterior. Corrigir devolve essa mesma proposta. Sim não marca: fecha o conjunto novo e segue para proposta nova. Partícula, forma de hora e a pergunta de zona desconhecida não a suspendem.
3. **Confirmado** (opção B; [#577](https://github.com/intentzero/tredane/issues/577)). Hora pedida sem vaga não substitui a oferta aberta nem grava essa hora no quadro. A proposta da hora anterior continua confirmável. A frase diz que essa hora não há.
4. **Confirmado** (opção A; [#578](https://github.com/intentzero/tredane/issues/578)). O extractor só preenche campo vazio com evidência na frase da cliente: a palavra, um sinónimo, ou uma hora que o parser confirma nessa frase. Id de catálogo sozinho não chega. O campo vazio fica vazio. A DEC-104 mantém-se.

## Como medir uma alteração conversacional

**Confirmado** (DEC-139; [metodologia](../implementation/metodologia-avaliacao-conversacional.md)): o atendimento tem testes de diálogo (L1) e um scorecard com linha de base. Quem muda `src/clinic/ai/`, `src/whatsapp/flow/` ou `src/clinic/proposals/`:

1. Corre `npm run eval:scorecard` (o CI também o corre e comenta o veredicto no PR, DEC-146). Só as invariantes INV-01..11 bloqueiam (DEC-108). Qualquer outra regressão assinalada tem de ser explicada ou corrigida no PR (DEC-139).
2. Acrescenta um diálogo L1 por comportamento novo ou corrigido, com o ID da família (`A-`, `FL-`, `CC-`…) e sem renumerar os existentes. Testes unitários não substituem o diálogo: a interação entre rotas só se vê no L1.
3. Não relaxa uma invariante para um caso passar. Uma invariante que o caminho novo desmente corrige-se à parte e com razão escrita (lição G-08 da metodologia).
4. Um defeito conhecido que ainda não se corrige entra como `knownFailure` (o caso tem de falhar até haver correção) e como achado CF no [plano de testes](../implementation/plano-testes-conversacional.md). Copy nova à cliente exige aprovação (DEC-104).
5. `npm run eval:baseline` só depois do merge e com a árvore limpa; recusa corridas parciais ou com falhas.

## O que continua proposto

- **Proposto** ([`nucleo-deterministico-conversacional.md`](nucleo-deterministico-conversacional.md)): o grafo determinístico e o pipeline único por turno. Complementa o [modelo híbrido](conversational-hybrid-model.md). Não é o comportamento do código. Pontos que ainda pedem decisão estão na secção 10 desse documento.
- **Proposto** (análise de 06/11; [#579](https://github.com/intentzero/tredane/issues/579)): `applyBookingUpdate` em `src/clinic/ai/apply-booking-update.ts` é a casa das quatro leituras (#575–#578) e dos intents PR-D (`ask_info`, `select_variants`, `choose_offered`, `commit_flow`). Adaptadores texto/botão/Flow emitem intents; `nfm_reply` recusa Flow stale vs correção no chat (`isStaleFlowVersusChat`). Gramática completa (compare / mention_only / negate além do padrão D3) ainda parcial.

## Fora

Não implementes isto. Não está no recorte e não se infere das propostas.

- **Fora** (DEC-061): marcação por texto livre. «Sim», 👍, «pode ser» ou um pedido completo não criam o compromisso.
- **Fora** (DEC-138, ADR-0016): o Flow marcar, escolher sala ou profissional, ou cobrar Pix. O fecho entrega ids ao quadro; o commit é o Confirmar.
- **Fora** (DEC-104, ADR-0016): o LLM escolher zona, hora ou slot. Pertencer ao catálogo não é escolha da cliente.
- **Fora** deste recorte (opção não escolhida na análise de 06/11; exigiria decisão nova): texto restrito só à pergunta pendente. Partiria o atalho da DEC-137 (4) e a combinação por texto da DEC-135.
- **Fora** deste recorte (opção não escolhida na mesma análise; exigiria decisão nova e revogaria a DEC-138): só o formulário escrever os slots da marcação. O texto livre continua a preencher o mesmo `BookingFrame`.
