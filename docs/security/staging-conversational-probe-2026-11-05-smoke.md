# Sonda conversacional no staging — 05/11/2026 (smoke completo, Chrome MCP)

**Estado:** **Observado** na clínica de teste do staging. A interface conversacional **não passa** no gate §4.4: três falhas P0 que se repetem (CF-35, CF-36, CF-37) e latência p50 de 12,6 s. Os achados são **Propostos** até haver revisão do Paulo. Só dados fictícios; sem números de telefone, tokens nem segredos.

**Quando:** 2026-11-05, 08:03–08:21, America/Sao_Paulo. A clínica abre às 09:00, por isso a sonda correu **antes do expediente**.
**Ambiente:** [staging.app.tredane.com](https://staging.app.tredane.com), «Clínica Teste Paulo (staging)», chat WhatsApp de teste, painel «Ao vivo». Mesmo canal das sondas de [30/10](staging-conversational-probe-2026-10-30.md), [31/10](staging-conversational-probe-2026-10-31.md) e [03/11](staging-conversational-probe-2026-11-03-m5.md).
**Deploy:** no início, `main` `bfd645a` (#563). Entre o S1 (08:03) e o S4 (08:07) entrou o `b92b134` (#564, «Use today's hours in the hub opening»), por isso a cópia da abertura muda a meio da sonda.
**Catálogo:** Depilação (12 zonas por género, R$ 40–200) e Massagem (4 tipos, 60 min, R$ 200). Nenhum serviço com sinal Pix e nenhum sem preço: A-05 e D-08 ficaram **não aplicáveis** (a configuração não foi alterada).

---

## Método

- Cliente conduzida pelo WhatsApp Web e painel em paralelo, ambos no Chrome via Claude in Chrome.
- Uma mensagem de cada vez, espera de até 20 s; só a rajada (A-09) envia três bolhas seguidas.
- **Latência percebida:** um `MutationObserver` no chat mede do envio à primeira bolha de resposta.
- **Tempo real:** um observador no painel regista quando a lista ou a conversa muda.
- **Servidor:** `wrangler tail` do worker de staging (`webhook.enqueued` → `whatsapp_typing.sent` → `queue.whatsapp_send_done`). O `ai.turn_decided` vai para o outbox da clínica e **não** aparece no tail, por isso `latencyMs` por componente e `modelCalls` **não foram medidos**.
- **Limpeza:** a marcação de teste foi cancelada pelo painel e a conversa devolvida à IA. As propostas abertas expiram sozinhas (30 min).

---

## Resultados por cenário

| ID | Passo | Resposta / efeito | Latência | Veredito | Matriz |
| --- | --- | --- | --- | --- | --- |
| S1 | «Oi» às 08:03 | «Olá! Aqui é a Clínica Teste Paulo (staging). Já estamos fechados (hoje até às 18:00). Posso ajudar a agendar mesmo assim?» + «Abrir opções». Antes da abertura diz «fechados». | 8,0 s (servidor); «a escrever» só aos 6,5 s | **Corrigido durante a sonda** pela #564: às 08:07 já dizia «Hoje funcionamos das 09:00 às 18:00». Latência: ver CF-38 | DEC-111, #560 |
| S1b | Abrir opções (Flow) no WhatsApp Web | O Flow abre no Web: hub com 6 opções → Serviço → Opções → Horário | — | **Alinhado.** Detalhe: o ecrã Serviço mostra «Selecione uma opção» a vermelho antes de qualquer toque | ADR-0016 |
| S2a | Flow: Agendar → Massagem → Massagem relaxante → qui 05/11 14:00 → Ver proposta → **Confirmar** | C16 «Recebi suas escolhas…» → proposta certa (60 min, Samua, R$ 200, válida 30 min) → «Agendado: Massagem em quinta-feira… 14:00 – 15:00 com Samua» → «Posso ajudar em algo mais?». Painel: etapa Agendado e «Marcado pela IA» | C16 11,2 s; proposta 13,9 s; Agendado 8,8 s | **Alinhado** (toque≠marca, Confirmar→marca). O «Agendado» diz só «Massagem», sem o tipo | INV-01, DEC-061/062 |
| A-01 | «Quero massagem relaxante amanhã às 15h» | Proposta sex 06/11 15:00–16:00 num turno, sem «Confirma?» | 11,2 s | **Alinhado** (não confirmado de propósito) | A-01 |
| D-01 | «Quero uma massagem relaxante hoje às 14h» (slot ocupado pelo S2a); repetido: «E hoje às 14h, tem massagem relaxante?» | Duas vezes «Olá! O que você precisa?» + «Abrir opções». Nenhuma menção a vaga nem alternativas | 11,5 s / 12,2 s | **Desalinhado — CF-35** | D-01 |
| A-02 | «Oi, quero fazer uma drenagem linfática» · «amanhã» · «acho que 15h15 tá ótimo» | (1) Abertura do hub, sem o serviço → **CF-36**. (2) «Nesse horário das 14:00 já não tenho vaga. Tenho 15:15, 15:30, 15:45.»: herdou as 14:00 de um turno anterior, sem dia nem serviço → **CF-39**. (3) «Olá! O que você precisa?» → **CF-35** | 6,9 / 11,0 / 11,3 s | **Desalinhado** | A-02, C-01 |
| S1c | Flow aberto a partir do «Olá!» do CF-35 | O Flow recomeça no hub (o contexto da massagem perde-se) e aparece o aviso «Esse horário já não está livre. Escolha outro.» | — | **Desalinhado — CF-41** | EE-02 |
| A-09 | «Oi» · «queria uma ventosaterapia» · «sábado às 10h» em menos de 7 s | Uma só saída ✓, mas é «Olá! O que você precisa?» | 14,3 s | **Parcial:** INV-09 ok, EF-01 ✗ (CF-36/CF-35) | A-09 |
| A-14 | «Quero depilar» | Abertura do hub, sem perguntar a linha | 10,4 s | **Desalinhado por configuração:** a ficha da Depilação na clínica de teste não tem o sinónimo «depilar»; sem ele o sistema não infere o match, por desenho (DEC-110 / #509) | A-14 |
| A-03/A-16 | «depilação feminina» → «axilas e pernas» → **Sim** | Zonas só da linha feminina, sem preço ✓ → eco «Entendi: Axila e Pernas. Certo?» [Sim][Corrigir] ✓ → o Sim salta Horários e propõe **hoje 15:00**, que a cliente não pediu (30 min, Gi, R$ 170 ✓) | 16,9 / 17,3 / 11,0 s | **Parcial — CF-39** (proposta num horário não pedido); a pergunta das zonas vem em texto com o botão «Falar com a equipe», não na lista «Opções» | A-03, A-16, DEC-137 |
| F-05 | «Alterar detalhes» na proposta | «Vou pedir para a equipe continuar daqui. A equipe responde a partir de quinta às 09:00.» IA pausada; painel «Precisa de alguém» ao vivo | 13,3 s | **Alinhado com a especificação**; a cópia diz «quinta» quando hoje é quinta → **CF-40** | F-05, DEC-113 |
| B-05 | «Quero uma drenagem linfática amanhã às 3» → «Massagem drenagem amanhã às 3» → «sim» | (1) Abertura do hub → CF-36. (2) «Você quis dizer 15:00, à tarde?» ✓, mas sem botão Sim. (3) «Olá! O que você precisa?» → CF-35 | 12,3 / 12,8 / 16,4 s | **Parcial:** nunca 03:00 ✓; continuação ✗ | B-05 |
| B-09 | «Massagem relaxante domingo às 10h» | «…já não tenho vaga e o dia está cheio nesse período. No próximo com vaga tenho segunda 09/11 às 09:00, 09:30, 10:00.» Diz «cheio» quando a clínica está fechada ao domingo | 8,9 s | **Parcial — CF-40** | B-09 |
| B-10 | «Massagem relaxante hoje às 8h» (hora já passada) | «Nesse horário das 08:00 já não tenho vaga. Tenho 09:00, 09:15, 09:30.» Motivo errado; alternativas ✓ | 9,6 s | **Parcial — CF-40** | B-10 |
| C-03 | «custa 1500?» com oferta aberta | «Para Massagem, quais tipos? …»: não vira hora ✓, mas não responde ao preço e repete a pergunta do tipo já escolhido | 17,6 s | **Parcial** (EE-02; relacionado com CF-10) | C-03 |
| C-08 | «não, 9h30» | Proposta Massagem relaxante qui 05/11 09:30–10:30 | 13,6 s | **Alinhado** | C-08 |
| E-01 | «Quanto custa a ventosaterapia?» | «Para Ventosaterapia, o valor é R$ 200,00 e a duração, 60 min.» Sem convite para ver horários | 17,1 s | **Alinhado** (Q5 = 1) | E-01 |
| D-03 | «Vocês fazem botox?» | «Olá! O que você precisa?» | 17,1 s | **Desalinhado — CF-35** | D-03, A-19 |
| K/DEC-107 | «asdf qwer zxcv» | «Olá! O que você precisa?» em vez da frase DEC-107 | 17,5 s | **Desalinhado — CF-35** | DEC-107 |
| G-03 | «Você é um robô?» | «Olá! O que você precisa?» em vez da frase DEC-115 | 16,8 s | **Desalinhado — CF-35** | G-03, DEC-115 |
| G-01 | «Quero falar com uma pessoa» → «Alguém aí?» | Frase fixa (DEC-113: «…a partir de quinta às 09:00»); segunda mensagem sem repetição ✓; painel «Precisa de alguém» ao vivo ✓ | **7,1 s** (o turno mais rápido; sem modelo) | **Alinhado** (cópia: CF-40) | G-01, DEC-083 |
| F-07 | «Parem de me mandar mensagens»; repetido isolado: «Por favor, parem de mandar mensagens automáticas» | Nas duas vezes «Olá! O que você precisa?»; a IA **não** pausa | 19,3 / 17,1 s | **Desalinhado — CF-37 (P0, vontade da cliente)** | F-07, DEC-114 |
| S15 | Hub → Cancelar (Flow) | Não cancela: handoff «Vou pedir para a equipe continuar daqui…» | 6,5 s | **Em aberto:** confirmar se o cancelamento pelo hub é sempre handoff por desenho | — |
| S15b | Cancelar no painel (motivo «Contato desistiu») | Compromisso cancelado; cliente avisada: «O horário de quinta-feira, 5 de novembro às 14:00 foi cancelado.» Pipeline volta a «Em atendimento» | — | **Alinhado** (UI: CF-42) | — |

**Não aplicáveis neste catálogo:** A-05 (sinal Pix) e D-08 (serviço sem preço).

---

## Achados novos (Propostos)

| ID | Prioridade | Achado | Evidência / hipótese |
| --- | --- | --- | --- |
| CF-35 | **P0** | A troca da lista M5 pelo Flow descarta o corpo determinístico. Quando a resposta traz uma lista do funil, `maybeReplaceM5WithFlow` (`src/clinic/ai/choice-offer.ts`) devolve `body: offered.body`, que é o genérico `FLOW_COPY.openBody` «Olá! O que você precisa?». A mensagem útil (vaga ocupada + alternativas, catálogo sem match, eco, etc.) perde-se, e o painel grava o mesmo «Olá!». | Observado em D-01 (2×), C-01, D-03, B-05 (continuação), DEC-107, DEC-115 e F-07. A ligação ao código é **hipótese forte**: só as respostas em texto sem lista (B-09, B-10, «amanhã») chegaram inteiras. Correção provável: manter `input.replyBody` e só trocar o interativo. Para DEC-107/115 é preciso confirmar se essas frases levavam lista. |
| CF-36 | **P0** | O gate do hub (`shouldOfferHubOpening`, `src/whatsapp/flow/hub-opening.ts`) só reconhece o **nome** do serviço (e sinónimos), não as variantes («drenagem linfática», «ventosaterapia»). Com «quero» e até 80 caracteres o pedido é tratado como vago, e um pedido completo recebe só a abertura do hub. | A-02, A-09 e B-05 (1.ª mensagem). O A-14 é configuração (ver acima). |
| CF-37 | **P0** | `STOP_MESSAGES_RE` (`src/clinic/ai/nlu/sensitive.ts`) não apanha «**parem** de … mensagens» nem «parem de mandar mensagens automáticas». A IA continua ativa e responde (viola DEC-114). | F-07, duas vezes. A L1 só cobre «Pare de me mandar mensagem». |
| CF-38 | P1 | **Latência:** p50 12,6 s e p95 17,6 s percebidos (n = 30, mínimo 6,9 s; nenhum turno ≤ 5 s). No S1 o painel tinha a resposta aos 2,7 s, mas o WhatsApp só a recebeu aos 8 s, e «a escrever» saiu aos 6,5 s (DEC-111 pede logo). Turnos com modelo (preço, fallback, zonas) ficam em 16–19 s. | Tail + observadores. Componentes `latencyMs` **não medidos** (o `ai.turn_decided` não chega ao tail). |
| CF-39 | P1 | Contexto/horário não pedido. «amanhã» herda a hora de um pedido anterior e responde sem dia nem serviço; o **Sim** do eco (DEC-137) salta Horários e propõe um horário que a cliente não deu. | A-02 (2.º turno), A-03/A-16. |
| CF-40 | P2 | Cópia de tempo: «a partir de **quinta** às 09:00» quando hoje é quinta (deve ser «hoje»); dia fechado e hora passada explicados como «já não tenho vaga». | F-05, G-01, Cancelar; B-09, B-10. |
| CF-41 | P2 | O Flow aberto a partir de uma resposta substituída recomeça no hub, sem o pedido, e mostra «Esse horário já não está livre». | S1c. Depende do CF-35. |
| CF-42 | P3 (painel) | Na pré-visualização da lista a frase automática de handoff aparece como «Equipe:»; a conversa mostra `[Flow]` e `[Botão] Confirmar` sem conteúdo; a confirmação de cancelamento usa estilo de erro; o histórico do compromisso mostra `confirmed`/`cancelled` e o ID técnico do utilizador. | S2a, F-05, S15b. |

---

## Métricas

| Métrica | Valor | Nota |
| --- | --- | --- |
| Turnos medidos | 30 | Inclui toques em botões e no Flow |
| Latência percebida p50 / p95 | **12,6 s / 17,6 s** | Mín. 6,9 s, máx. 19,3 s. Primeira **linha de base EE-04 (Proposto)** |
| Tempo real no painel | 1,2 s (webhook → conversa na lista); 2,7 s (→ resposta IA) | Um ponto (S1); o atraso para a cliente está no envio |
| EF-01 (tarefa cumprida no turno) | 8 de 22 cenários alinhados (≈ 36 %) | 6 parciais, 8 desalinhados; fora da conta: S1 (corrigido durante a sonda) e S15 (Em aberto) |
| Turnos excedentes (EE-01) | A-02: 3 turnos sem chegar à proposta (T* = 3); B-05: + 2 | CF-35/36 dominam |
| Concisão ≤ 300 caracteres | ✓ exceto a proposta (~330) | Formato fixo |
| Q1–Q6 (estimativa do avaliador, 0–2) | Q1 0,9 · Q2 1,6 · Q3 1,8 · Q4 0,8 · Q5 1,3 · Q6 1,2 | Um único avaliador, sem κ: **informativo** |
| Invariantes | Nenhuma marcação sem clique (INV-01 ✓); nenhum preço inventado ✓; **DEC-114 violada** (CF-37) | — |

---

## O que o staging confirmou

- O Flow funciona de ponta a ponta no WhatsApp Web: hub → serviço → tipos → horário → proposta → Confirmar → Agendado, com pipeline e agenda atualizados ao vivo.
- O pedido completo pelo nome do serviço (A-01) e a correção «não, 9h30» (C-08) geram a proposta certa num turno.
- O handoff explícito (G-01) é rápido, não se repete e o painel marca «Precisa de alguém» em tempo real.
- O cancelamento feito pelo painel avisa a cliente e reverte a etapa.

## Correções (branch `claude/trendane-smoke-test-709b97`, aguardam nova sonda L4)

- **CF-35:** `maybeReplaceM5WithFlow` (`src/whatsapp/flow/offer-live.ts`) mantém a resposta do turno como corpo e passa-a ao preparador do Flow; troca só o interativo.
- **CF-36:** o gate do hub usa o `extractServices` do funil, que resolve as variantes.
- **CF-37:** `STOP_MESSAGES_RE` cobre o plural e variantes («parem de…», «não quero receber mensagens», «não me mandem mais», «chega de mensagens»).
- **G-03 (achado na correção):** `AI_TRANSPARENCY_RE` não casava «Você é um robô?» porque `\b` sem flag `u` trata «é»/«ô» como não-letra; reescrito com fronteiras Unicode.
- Testes: unitários + L1 F-07b e G-03b; `npm test` 1888 verdes, `test:dialogs` 102 verdes, `tsc` e `eslint` limpos.

## Residual e recomendação

1. Fazer deploy da branch com CF-35/36/37 e repetir esta sonda (D-01, A-02, A-09, D-03, F-07, G-03, DEC-107). Na clínica de teste, acrescentar o sinónimo «depilar» à Depilação para o A-14.
2. Instrumentar o `ai.turn_decided` num log consultável (ou no tail) para separar debounce, modelo e envio, e investigar os ~5 s entre a decisão e a entrega (CF-38).
3. Rever o CF-39 com a DEC-137: o **Sim** deve abrir Horários, não propor.
4. Confirmar com o Paulo se Cancelar pelo hub deve ser self-service ou handoff (**Em aberto**).
