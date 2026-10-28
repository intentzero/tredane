# Épico — Modelo conversacional híbrido (DEC-060)

**Estado:** plano de engenharia **proposto** (28/10/2026). Não altera decisões de produto. Arquitetura: [conversational-hybrid-model.md](../architecture/conversational-hybrid-model.md). Decisão-alvo: DEC-060 ([PR #155](https://github.com/intentzero/tredane/pull/155)). Ordem: 10 passos da [contra-análise](https://tredane-contra-analise-da-arquitetura-xu22.pages.grok.bot/).

**Objetivo:** a IA marca sozinha após confirmação explícita da cliente (DEC-060) sem marcações indevidas, com o backend a validar tudo o que o modelo interpreta.

**Fora do âmbito:** envio automático (não aprovado), cancelamento/remarcação pela IA, prontuário e anamnese, conversas reais em avaliação.

---

## H1 — Contenção temporária com `AI_AUTOBOOK=off`

Se o #155 entrar antes das correções, entra desligado (ou com toque da atendente) até H2–H9 passarem. DEC-060 continua o alvo.

- [ ] Com `AI_AUTOBOOK=off`, nenhuma conversa do conjunto de testes cria compromisso; o rascunho é gerado normalmente.
- [ ] Teste automatizado cobre o kill switch (desligado → zero chamadas à operação de confirmação).
- [ ] O estado da flag em cada ambiente está documentado em `docs/implementation/environments.md`.
- [ ] Documentação diz explicitamente que é contenção temporária, com critério de saída em H10.

## H2 — Contexto factual antes de interpretar

- [ ] O contexto da IA inclui compromissos futuros do contacto, data e hora de cada mensagem e vagas do período pedido.
- [ ] Teste: mensagem «amanhã» enviada às 23:50 e lida às 00:10 resolve para o dia relativo à data da mensagem.
- [ ] Teste: as vagas cobrem todo o expediente do dia pedido (não cortadas no início/fim).
- [ ] Sem dados proibidos por DEC-011 no contexto (telefone, anexos, outras conversas).

## H3 — Intenções distintas

- [ ] Intenção é uma lista fechada: nova marcação, confirmar presença, agradecimento, remarcar, pergunta; outra → humano.
- [ ] Teste: «sim» a lembrete de compromisso existente → confirmar presença; nenhum compromisso novo; o rascunho não diz que o horário «não está livre».
- [ ] Teste: «ok 👍» depois de mensagem de confirmação → agradecimento; nada criado.
- [ ] Teste: «sim» a pergunta lateral («já fez o procedimento?») → nada criado.
- [ ] Teste: pedido de remarcar → não marca (IA não remarca, DEC-060).

## H4 — Propostas identificadas (caminho A) e regras do caminho B

- [ ] Toda proposta de horário da clínica tem id, serviço, dia e horário únicos, estado de entrega e vigência.
- [ ] Teste: «sim» a proposta entregue, vigente e que é a última pergunta → elegível a marcar.
- [ ] Teste: «sim» a proposta não entregue, expirada ou com vários horários → não marca.
- [ ] Teste: «Quero limpeza de pele amanhã às 15h» sem proposta → elegível (caminho B).
- [ ] Teste: «quero massagem amanhã 10h, é pra minha mãe» → não marca no contacto da cliente; passa a humano.
- [ ] Teste: «sim, mas na verdade prefiro massagem» → pergunta, não marca.
- [ ] Prazo de vigência da proposta fixado (Em aberto).

## H5 — Interpretação estruturada com origem e validação no backend

- [ ] O modelo devolve intenção, serviço, data, horário, beneficiária e `proposal_id`, cada campo com id da mensagem e trecho.
- [ ] O backend rejeita campo cujo trecho não existe na mensagem indicada ou cujo valor não corresponde ao trecho.
- [ ] Teste: «pode ser às 3 da tarde» → 15:00; «meio-dia» → 12:00; nunca 03:00.
- [ ] Teste: saída com confiança alta e trecho inventado → rejeitada, nada criado.
- [ ] A confiança só é usada para escolher perguntar / humano / validar (teste de que não altera a decisão de marcar).

## H6 — Execução pelo caminho atual e Pix

- [ ] Só intenção «nova marcação» validada chega à operação de confirmação existente, com revalidação na transação e idempotência.
- [ ] Teste: serviço com sinal → nenhum compromisso nem reserva; segue o fluxo Pix.
- [ ] Teste: conflito surgido entre interpretação e transação → nada criado; rascunho oferece alternativas.
- [ ] Auditoria `appointment.ai_booked` com actor `system:ai-autobook` e a mensagem de confirmação.

## H7 — Comunicação pendente

- [ ] Compromisso marcado pela IA com aviso não enviado mostra «comunicação pendente» na agenda e na conversa.
- [ ] Alerta na fila da equipe após N minutos sem envio (N Em aberto, Paulo).
- [ ] Descartar ou editar a sugestão removendo a marcação pergunta à atendente se mantém ou cancela o compromisso.
- [ ] Falha de envio WhatsApp ou janela de 24 h fechada → alerta e decisão humana; nada automático.
- [ ] Lembretes não saem antes de o aviso de marcação ser enviado (teste).

## H8 — Validação de preços e horários nos rascunhos e saída estruturada

- [ ] Todo preço citado no rascunho existe no catálogo; todo horário oferecido existe nas vagas.
- [ ] Teste: rascunho com preço ou horário fora do catálogo/vagas é bloqueado ou corrigido antes de chegar à atendente.
- [ ] Erro factual que passe a validação é registado como defeito do validador.

## H9 — Conjunto fictício, matriz de modelos e orçamento de latência

- [ ] Conjunto de ~150 conversas fictícias com todos os casos de H3–H6; nenhuma conversa real.
- [ ] Regressão em cada PR: zero marcações indevidas e zero preços/horários fora do catálogo/vagas; falha bloqueia o merge.
- [ ] Matriz comparada nas mesmas conversas (configurações de thinking/effort de Haiku e Sonnet): qualidade, tokens e latência.
- [ ] Latência p95 medida por etapa; meta e timeout definidos a partir da medição (Proposto: 15 s total).
- [ ] Mantém-se Haiku no primeiro rascunho e Sonnet na regeneração até a matriz justificar mudança (provisório).

## H10 — Religar `AI_AUTOBOOK` no piloto e retirar a contenção

- [ ] Ligado só no piloto (quando retomado), com cada marcação da IA revista pela equipe.
- [ ] Contenção retirada após zero marcações indevidas num mínimo de marcações (número Em aberto, Paulo).
- [ ] Qualidade de rascunho reportada por categoria: correção factual, erros críticos, exceções; «sem edição» só como sinal.
- [ ] Envio automático continua desligado; qualquer liberação exige nova decisão explícita do Paulo.

---

## Pontos em aberto

- Vigência da proposta (H4); N minutos do alerta de comunicação pendente (H7); número mínimo de marcações no piloto (H10).
- Escolha final de modelo e configuração de thinking (H9); metas de latência (H9).
- Envio automático: não aprovado; critérios só esboçados.
