# Épico — Follow-up conversacional e atendente virtual (DEC-086 a DEC-089)

**Estado:** especificação de implementação **Confirmada** no desenho (Paulo, 31/10/2026, America/Sao_Paulo; idle refinado no mesmo dia para **30 minutos**). Este documento é o épico. Issue: [#354](https://github.com/intentzero/tredane/issues/354).

**Decisões:** [DEC-086](../product/decisions.md) (pós-agendamento), [DEC-087](../product/decisions.md) (idle 30 min), [DEC-088](../product/decisions.md) (prefixo humano), [DEC-089](../product/decisions.md) (atendente virtual). Mantém DEC-061 (só botão versionado marca), DEC-042 (só a responsável configura), DEC-011 (contexto e retenção da IA), DEC-083 (pausa humana) e a ausência de sexo na ficha do contacto.

**Onde vive o dado:** SQLite do Durable Object da clínica (DEC-038). Nada disto vai para o D1 central. Exemplos só com nomes fictícios (Ana, Carla, clínica Aurora). Sem dados reais de paciente.

**Identificadores.** REQ-097 a REQ-100 e AC-71 a AC-74. Não renumerar DEC/REQ já gravados.

**Ecrã.** Spec de interface em [ux-ui.md](../product/ux-ui.md) (hub da Clínica, Conversas). Quem implementar a UI do atendente virtual actualiza, se mudar mock, o `.dc.html`, o preview, `screens.md` e `ux-ui.md`. React Aria e tokens DEC-041.

---

## Já existe em `main` — não reimplementar

Conferido no código da `main` (schema da clínica na versão 44). As fatias abaixo só acrescentam o follow-up e a persona.

| Já existe | Onde | O que este épico não manda refazer |
| --- | --- | --- |
| Marcação só pelo botão versionado; texto livre não marca. | DEC-061; `handleProposalButtonClick`, `executeProposalConfirmOp` | Não reabrir marcação por texto. O follow-up pós-agendamento é **depois** do sucesso do botão. |
| Etapa terminal **Concluído** (`concluido`) fecha o ciclo; **Perdido** também. | `OPPORTUNITY_STAGES`, `TERMINAL_OPPORTUNITY_STAGES`; migração `0005_pipeline` | **Revisão DEC-086 (31/10/2026):** «Não, obrigado» não move a etapa. Concluído é o fim do horário confirmado, sem outro horário futuro (DEC-094), ou a falta Não compareceu (DEC-092). Não inventar outra etapa de ganho. |
| Botões WhatsApp interactivos (proposta, «Falar com a equipe»). | `sendOutboundMessageOp` com `interactive`; `button_reply` no webhook | Reutilizar o mesmo canal de botões versionados / ids estáveis. |
| Alarme do Durable Object: Pix, comunicação pendente (5 min), outbound stuck, autodraft. | `ClinicDurableObject.alarm` | Estender o alarme (ou o mesmo padrão) para idle 30 min + segundo prazo; não criar Workflow só para isto se o alarme bastar. |
| `clinic_settings` com fuso, Pix, abuse limits, Tempo, IA opt-in; escrita só owner. | migrações `0003`…`0030`; `AutomationLimitsCard` | Acrescentar nome/género do atendente virtual na mesma tabela e no hub owner. |
| Assumir conversa, outbound humano com `authorDisplayName`, pausa da IA (DEC-083). | `assignConversationOp`, `sendOutboundMessageOp`, `human-handoff` | Prefixo `[Nome]` no texto enviado ao WhatsApp quando a conversa está com humano; não no painel como etiqueta separada. |
| Contacto sem sexo. | `contacts` (migração `0001`) | Não gravar sexo da cliente por inferência. |

**O que falta, por fatia:** S1 docs; S2 campos e UI do atendente virtual; S3 prefixo humano; S4 pós-agendamento; S5 idle 30 min + fecho.

---

## Regras Confirmadas (Paulo, 31/10/2026)

### 1. Pós-agendamento bem-sucedido (DEC-086)

Depois de a marcação ficar confirmada pelo botão da proposta (DEC-061), o sistema envia uma mensagem a perguntar se pode ajudar em algo mais, com **dois botões**:

- **«Não, obrigado»** → agradecer e manter a oportunidade em **Agendado**, com a data do horário (revisão DEC-086, 31/10/2026). A frase original, que movia para `concluido` no clique, deixa de valer.
- **«Quero agendar outro serviço»** → continua o fluxo de agendamento na mesma conversa (nova intenção de serviço; a IA ou a equipa retoma o catálogo sem fechar o ciclo).

DEC-061 inalterado: texto livre nunca marca.

### 2. Conversas em aberto — idle 30 min (DEC-087)

**Critério único de «sem progresso útil»:** tempo decorrido desde a **última mensagem inbound ou outbound da conversa**, a que for mais recente. Mensagens `system` do painel **não** reiniciam o relógio. O alarme usa este instante único.

Após **30 minutos** Confirmados sem progresso útil, perguntar se quer **prosseguir** ou **terminar** o atendimento (botões).

**Sem resposta:** segundo prazo **Confirmado = mais 30 minutos** a contar do envio da pergunta de idle (Paulo, 31/10/2026, «ok»). O destino é o do **Terminar** (DEC-087): com horário futuro confirmado a etapa não muda; sem horário, **Perdido**. A frase que fechava em **Concluído** deixa de valer.

**Excepções (Confirmado no desenho da implementação):** conversa com atendente humano activo (DEC-083 / Assumir) **não** recebe o prompt de idle automático enquanto a pessoa estiver responsável; nova mensagem inbound ou outbound cancela o prazo corrente e reinicia a contagem.

### 3. Prefixo do atendente humano (DEC-088)

Quando um atendente (ou owner a actuar como atendente) **assumiu** a conversa, cada mensagem **outbound de texto** que a pessoa envia no WhatsApp é precedida por `[Nome do Atendente]` (nome de apresentação da sessão), para a cliente saber que fala com pessoa. Mensagens de sistema, propostas com botões montadas pelo backend e frases fixas da IA **não** usam este prefixo.

### 4. Atendente virtual (DEC-089)

Campos **opcionais** na clínica: nome do/da atendente virtual e género (`masculino` | `feminino`). Usados na persona/copy da IA (concordância e apresentação). Só a responsável grava (DEC-042). Vazio = copy neutra já usada hoje. Não grava sexo da cliente.

---

## Fora deste épico

Marcação por texto livre. Sexo na ficha do contacto. Inferência de género da cliente. Deploy. Alterar validade da proposta (30 min) ou o alerta de comunicação pendente (5 min). Autonomia conversacional (DEC-084 evolução). Workflow de expurgo de tenant.

---

## Ordem

S1 → S2 → S3 → S4 → S5. Cada fatia é verificável sozinha. S1 não muda comportamento. S2 e S3 podem empilhar em paralelo após S1 se o stack o permitir; S4 e S5 dependem dos botões e do alarme já existentes.

| Fatia | Conteúdo | PR |
| --- | --- | --- |
| S1 | DEC/REQ/AC/épico/issue; resumo no MVP | docs |
| S2 | `clinic_settings` nome+género + API owner + UI hub | código |
| S3 | Prefixo `[Nome]` no outbound humano | código |
| S4 | Follow-up pós-agendamento + botões + `concluido` | código |
| S5 | Idle 30 min + pergunta + fecho no segundo prazo (alarme DO) | código |

---

## S1 — Decisão, aceite e épico

**Comportamento.** O desenho fica em DEC-086 a DEC-089, REQ-097 a REQ-100, AC-71 a AC-74 e neste documento. Nenhuma migração nesta fatia.

**Critérios de aceite.**

- [ ] `docs/product/decisions.md` tem DEC-086…089 com idle **30 min** e segundo prazo **Confirmados**.
- [ ] A etapa de fecho documentada é `concluido` / Concluído.
- [ ] Issue/épico GitHub aponta para este ficheiro.
- [ ] `docs/MVP.md` resume as quatro regras sem duplicar o detalhe.

---

## S2 — Atendente virtual (nome + género)

**Comportamento.** No hub da Clínica (owner), campos opcionais «Nome do atendente virtual» e «Género» (Masculino / Feminino). A API recusa escrita de attendant. O contexto da IA (DEC-011) passa a receber estes campos quando preenchidos, só para copy — sem inventar dados de cliente.

**Dados.** Migração seguinte à 44: `clinic_settings.virtual_attendant_name TEXT NOT NULL DEFAULT ''`, `clinic_settings.virtual_attendant_gender TEXT` com `NULL` ou `masculino`/`feminino`.

**Aceite:** AC-74; REQ-100.

---

## S3 — Prefixo `[Nome]` no outbound humano

**Comportamento.** Em `sendOutboundMessageOp` (ou no ponto único de montagem do body WhatsApp), se a conversa tem `assignee_clerk_user_id` humano (não IA) e o envio é texto livre da equipa, o body enviado e persistido para o canal inclui o prefixo `[Nome] ` uma vez. Idempotência por `clientRequestId` não duplica o prefixo.

**Aceite:** AC-73; REQ-099.

---

## S4 — Pós-agendamento com botões

**Comportamento.** Após `executeProposalConfirmOp` com `status: 'booked'` (e o caminho Pix pago que confirma o horário, quando aplicável sem duplicar), enfileira mensagem interactiva de follow-up. Clique «Não, obrigado» → agradecimento, etapa permanece `agendado` (revisão DEC-086). Clique «Quero agendar outro serviço» → limpa intenção de serviço na sessão da conversa (se houver) e deixa a conversa aberta para novo pedido; não fecha o ciclo.

**Aceite:** AC-71; REQ-097. DEC-061 intacto.

---

## S5 — Idle 30 min + fecho

**Comportamento.** Em cada inbound/outbound de mensagem da conversa, agenda (ou reagenda) o alarme do DO para `last_message_at + 30 min` nas conversas elegíveis (ciclo aberto, sem responsável humano activo). No alarme: se ainda idle, envia pergunta prosseguir/terminar e agenda o segundo prazo (+30 min, Confirmado). **Terminar** e esse silêncio: com horário futuro confirmado agradece e permanece em `agendado`; sem horário futuro agradece e vai para `perdido` (DEC-087).

**Aceite:** AC-72; REQ-098.

---

## Critérios de pronto do épico

- CI verde em cada fatia; merge empilhável a partir de `main`.
- Sem deploy neste trabalho.
- LGPD: sem sexo da cliente; retenção DEC-011; exemplos fictícios.
- React Aria + tokens DEC-041 na UI S2.
