# Épico — Modelo conversacional híbrido (DEC-060)

**Estado:** plano de engenharia **proposto** (28/10/2026). Não altera decisões de produto. Arquitetura: [conversational-hybrid-model.md](../architecture/conversational-hybrid-model.md). Decisão-alvo: DEC-060 ([PR #155](https://github.com/intentzero/tredane/pull/155)). Ordem: 10 passos da [contra-análise](https://tredane-contra-analise-da-arquitetura-xu22.pages.grok.bot/).

**Reconciliação SEG-IA (28/10/2026):** a direção do [épico #171](https://github.com/intentzero/tredane/issues/171) — confirmação **só pelo botão do WhatsApp** numa proposta montada e versionada pelo backend — está formalizada em [DEC-061](../product/decisions.md) (**Decidido em 28/10/2026, Paulo, registo D-20261028-200500-CUR**). Texto livre deixa de marcar. Critérios marcados **[substituído por Sx]** abaixo não devem ser implementados como estão; os restantes mantêm-se. Nenhuma tarefa é fechada por esta documentação.

**Valores Decididos (Paulo, 28/10/2026):** proposta válida 30 min · alerta de pendente 5 min · 20 marcações revistas no piloto. **Em aberto (S7):** limites de abuso e janela de quotas.

**Nova ordem:** S1 (#172) → S2 (#173) / S3 (#174) / S6 (#177) / S8 (#179) → S4 (#175) → S5 (#176) → S7 (#178) → S9 (#180).

| H | Entra em | Efeito |
| --- | --- | --- |
| H1 #158 | S2, S7 | Mantido; desligado por padrão |
| H2 #159 | S8 | Mantido (contexto mínimo, DEC-011) |
| H3 #160 | S6 | Mantido para interpretar; não autoriza |
| H4 #161 | S3 | Caminhos A/B substituídos por proposta versionada com botão |
| H5 #162 | S6 | Mantido para interpretar; não autoriza |
| H6 #163 | S5 | Execução a partir do clique |
| H7 #164 | S4 | Pendente cobre envio determinístico; N = 5 min |
| H8 #165 | S6, S4 | Mantido |
| H9 #166 | S9 | Mantido; acresce segurança |
| H10 #167 | S9 | Mínimo = 20 marcações |

**Objetivo:** a IA marca sozinha após confirmação explícita da cliente (DEC-060) sem marcações indevidas, com o backend a validar tudo o que o modelo interpreta.

**Fora do âmbito:** envio automático (não aprovado), cancelamento/remarcação pela IA, prontuário e anamnese, conversas reais em avaliação.

---

## H1 — Contenção temporária com `AI_AUTOBOOK=off`

Mapeado para S2 (#173) e S7 (#178). Se o #155 entrar antes das correções, entra desligado (ou com toque da atendente) até H2–H9 passarem. DEC-060 continua o alvo.

- [ ] Com `AI_AUTOBOOK=off`, nenhuma conversa do conjunto de testes cria compromisso; o rascunho é gerado normalmente.
- [ ] Teste automatizado cobre o kill switch (desligado → zero chamadas à operação de confirmação).
- [ ] O estado da flag em cada ambiente está documentado em `docs/implementation/environments.md`.
- [ ] Documentação diz explicitamente que é contenção temporária, com critério de saída em H10.

## H2 — Contexto factual antes de interpretar

Mapeado para S8 (#179). Mantido.

- [ ] O contexto da IA inclui compromissos futuros do contacto, data e hora de cada mensagem e vagas do período pedido.
- [ ] Teste: mensagem «amanhã» enviada às 23:50 e lida às 00:10 resolve para o dia relativo à data da mensagem.
- [ ] Teste: as vagas cobrem todo o expediente do dia pedido (não cortadas no início/fim).
- [ ] Sem dados proibidos por DEC-011 no contexto (telefone, anexos, outras conversas).

## H3 — Intenções distintas

Mapeado para S6 (#177). Mantido para interpretar e decidir se há proposta; não autoriza marcação.

- [ ] Intenção é uma lista fechada: nova marcação, confirmar presença, agradecimento, remarcar, pergunta; outra → humano.
- [ ] Teste: «sim» a lembrete de compromisso existente → confirmar presença; nenhum compromisso novo; o rascunho não diz que o horário «não está livre».
- [ ] Teste: «ok 👍» depois de mensagem de confirmação → agradecimento; nada criado.
- [ ] Teste: «sim» a pergunta lateral («já fez o procedimento?») → nada criado.
- [ ] Teste: pedido de remarcar → não marca (IA não remarca, DEC-060).

## H4 — Propostas identificadas (caminho A) e regras do caminho B

Mapeado para S3 (#174). **Caminhos A/B substituídos:** a proposta é persistida, versionada, com expiração de 30 min e confirmada só por botão.

- [x] Toda proposta de horário da clínica tem id opaco, versão, serviço, dia e horário únicos, estado (prep/envio/vigência/consumo) e vigência de 30 min a partir do envio — persistida no SQLite do Clinic DO (`appointment_proposals`, migração 28). **Confirmado** no código S3; envio WhatsApp = S4; clique = S5.
- [ ] ~~Teste: «sim» a proposta entregue, vigente e que é a última pergunta → elegível a marcar.~~ **[substituído por S3/S5: só o clique no botão da proposta válida é elegível; «sim» em texto → não marca]**
- [x] Teste (S3): proposta substituída, expirada, id fabricado ou cruzado entre clínicas/conversas → não autoriza clique. (O «sim» em texto continua a não marcar — S2.)
- [ ] ~~Teste: «Quero limpeza de pele amanhã às 15h» sem proposta → elegível (caminho B).~~ **[substituído por S2/S3: gera proposta com botão; não marca]**
- [ ] Teste: «quero massagem amanhã 10h, é pra minha mãe» → não marca no contacto da cliente; passa a humano. (Interpretação S6; S3 só persiste beneficiária `terceiro` quando o backend montar a proposta.)
- [ ] Teste: «sim, mas na verdade prefiro massagem» → pergunta, não marca.
- [x] Prazo de vigência da proposta fixado: **30 minutos** (Decidido, Paulo, 28/10/2026).

## H5 — Interpretação estruturada com origem e validação no backend

Mapeado para S6 (#177). Mantido; a interpretação validada só prepara a proposta.

- [ ] O modelo devolve intenção, serviço, data, horário, beneficiária e `proposal_id`, cada campo com id da mensagem e trecho.
- [ ] O backend rejeita campo cujo trecho não existe na mensagem indicada ou cujo valor não corresponde ao trecho.
- [ ] Teste: «pode ser às 3 da tarde» → 15:00; «meio-dia» → 12:00; nunca 03:00.
- [ ] Teste: saída com confiança alta e trecho inventado → rejeitada, nada criado.
- [ ] A confiança só é usada para escolher perguntar / humano / validar (teste de que não altera a decisão de marcar).

## H6 — Execução pelo caminho atual e Pix

Mapeado para S5 (#176).

- [ ] **[alterado por S5]** Só o clique autenticado numa proposta válida (antes: intenção «nova marcação» validada) chega à operação de confirmação existente, com revalidação na transação e idempotência.
- [ ] Teste: serviço com sinal → nenhum compromisso nem reserva; segue o fluxo Pix.
- [ ] Teste: conflito surgido entre interpretação e transação → nada criado; rascunho oferece alternativas.
- [ ] Auditoria `appointment.ai_booked` com actor `system:ai-autobook` e a mensagem de confirmação.

## H7 — Comunicação pendente

Mapeado para S4 (#175): proposta e resultado são mensagens determinísticas do sistema; o pendente cobre falha ou atraso desse envio.

- [ ] Compromisso marcado pela IA com aviso não enviado mostra «comunicação pendente» na agenda e na conversa.
- [ ] Alerta na fila da equipe após **5 minutos** sem envio (Decidido, Paulo, 28/10/2026).
- [ ] Descartar ou editar a sugestão removendo a marcação pergunta à atendente se mantém ou cancela o compromisso.
- [ ] Falha de envio WhatsApp ou janela de 24 h fechada → alerta e decisão humana; nada automático.
- [ ] Lembretes não saem antes de o aviso de marcação ser enviado (teste).

## H8 — Validação de preços e horários nos rascunhos e saída estruturada

Mapeado para S6 (#177) e S4 (#175). Mantido.

- [ ] Todo preço citado no rascunho existe no catálogo; todo horário oferecido existe nas vagas.
- [ ] Teste: rascunho com preço ou horário fora do catálogo/vagas é bloqueado ou corrigido antes de chegar à atendente.
- [ ] Erro factual que passe a validação é registado como defeito do validador.

## H9 — Conjunto fictício, matriz de modelos e orçamento de latência

Mapeado para S9 (#180); o conjunto passa a incluir prompt injection, replay e abuso.

- [ ] Conjunto de ~150 conversas fictícias com todos os casos de H3–H6; nenhuma conversa real.
- [ ] Regressão em cada PR: zero marcações indevidas e zero preços/horários fora do catálogo/vagas; falha bloqueia o merge.
- [ ] Matriz comparada nas mesmas conversas (configurações de thinking/effort de Haiku e Sonnet): qualidade, tokens e latência.
- [ ] Latência p95 medida por etapa; meta e timeout definidos a partir da medição (Proposto: 15 s total).
- [ ] Mantém-se Haiku no primeiro rascunho e Sonnet na regeneração até a matriz justificar mudança (provisório).

## H10 — Religar `AI_AUTOBOOK` no piloto e retirar a contenção

Mapeado para S9 (#180).

- [ ] Ligado só no piloto (quando retomado), com cada marcação da IA revista pela equipe.
- [ ] Contenção retirada após zero marcações indevidas em **20 marcações revistas** (Decidido, Paulo, 28/10/2026).
- [ ] Qualidade de rascunho reportada por categoria: correção factual, erros críticos, exceções; «sem edição» só como sinal.
- [ ] Envio automático continua desligado; qualquer liberação exige nova decisão explícita do Paulo.

---

## Pontos em aberto

- ~~Vigência da proposta (H4); N minutos (H7); mínimo do piloto (H10)~~ → Decididos (Paulo, 28/10/2026): 30 min, 5 min, 20 marcações.
- Revisão da DEC-060 por botão: DEC-061 **Decidido — 28/10/2026, registo D-20261028-200500-CUR**.
- Limites de abuso por contato/clínica e janela de quotas (S7, #178) — Em aberto (Paulo).
- Escolha final de modelo e configuração de thinking (H9); metas de latência (H9).
- Envio automático: não aprovado; critérios só esboçados.
