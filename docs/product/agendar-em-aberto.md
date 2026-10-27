# Agendar horário (TEL-05) — questões em aberto

**Estado:** todas as questões abaixo estão **Em aberto**. **Decisor:** Paulo (responsável pelo produto). **Data:** 27/10/2026. **Origem:** pedido de redesenho mobile do «Agendar horário» (Paulo, via Afonso). As recomendações são **nossas** (equipe de implementação), marcadas como **Recomendação**, e não são decisões. Nada aqui altera DEC/REQ anteriores.

O redesenho visual (cartões de serviço, botões de profissional, grade de dias e horários, rodapé fixo, revisão em folha inferior, sucesso com estado do aviso, variante de sinal) é **Proposto** por Paulo e aprovado para staging; ver [ux-ui.md](ux-ui.md) §TEL-05 e mocks M-04/M-34.

## Evidência no código (main @ d5b1041)

- `queryAvailability` **já aceita** duração substituta: `durationMinutesOverride` (`src/clinic/scheduling/query.ts:128`), exposta em `GET …/availability?durationMinutes=` (`src/scheduling/routes.ts:143`). Hoje só `ReservarBlocoSheet` envia esse parâmetro.
- `confirmAppointmentInTransaction` aceita `durationMinutesOverride` (`booking-types.ts:29`), mas a rota `POST /api/tenants/:id/appointments` **não** repassa duração (`routes.ts:257–300`); só a conversão de bloco usa (`holds.ts:360`).
- Conflitos de compromissos confirmados recalculam a ocupação pela **duração + buffer do serviço** (`occupancy.ts:71`), ignorando `occupies_until`/`ends_at` gravados. Um compromisso com duração própria seria subcontado na checagem de conflito. **Risco a confirmar por teste** antes de qualquer duração personalizada (inclusive a de blocos).
- O compromisso grava `ends_at` e `occupies_until` (migração 0009), mas não guarda a duração padrão do serviço no momento da marcação.
- O serviço só tem `duration_minutes`, `buffer_minutes`, `price_cents` e campos de sinal; **não existe** campo «duração ajustável». DEC-042 trata só de quem configura (owner), não de duração ajustável.
- Sinal percentual = `price_cents × percent` do serviço (`AgendarScreen.tsx`, `signalAmountCents`). O sinal é DEC-047/049; DEC-046 trata de preço nas respostas da IA.
- `RescheduleAppointmentInput` não tem duração (`booking-types.ts:41`): reagendar volta à duração do serviço.
- Contexto da IA lista o catálogo com a duração padrão (`src/ai/prompt.ts:36`).
- Confirmar com `opportunityId` só grava `linked_appointment_id`; **não muda a etapa** (`booking.ts`, `linkOpportunityIfPresent`).
- Confirmar não envia WhatsApp (nenhum consumidor de `appointment.confirmed` envia mensagem). O envio existente é `POST …/inbox/conversations/:id/messages`, com `messagingWindow.open` na conversa.
- Dias: `upcomingCivilDates(…, 7)` (sete dias fixos). Não há endpoint de «próximo livre»; a consulta é por dia.
- Cada horário traz `roomResourceName`; a tela atual mostra a sala em cada botão.
- Atualização dos horários: polling de 15 s (`AgendarScreen.tsx`), não WebSocket; [ux-ui.md](ux-ui.md) pede marcação imediata.

## DEC-051 — Duração personalizada no Agendar

**Pergunta:** a atendente pode mudar a duração ao agendar? **Bloqueia:** qualquer controle de duração no Agendar (mock a07 fica só como variante). Não bloqueia o restante do redesenho.

| Sub | Opções | Recomendação (nossa) |
| --- | --- | --- |
| a. Onde | (1) só blocos (hoje); (2) todos os serviços; (3) só serviços marcados pela owner como «duração ajustável» (novo campo; configuração continua só da owner, DEC-042) | (3) |
| b. Limites | livre; múltiplos de 15 min entre mínimo e máximo do serviço; lista fixa (30/45/60/90) | múltiplos de 15 min (DEC-008), mín/máx definidos pela owner |
| c. Buffer | somar o buffer do serviço; sem buffer; proporcional | sempre somar o buffer do serviço depois da duração aplicada |
| d. Disponibilidade | recalcular com `durationMinutes` (já suportado); só validar na confirmação | recalcular a grade ao mudar a duração |
| e. Preço e sinal | preço fixo; proporcional; owner define | preço e sinal do serviço sem mudança no MVP |
| f. Reagendar | volta ao padrão; mantém a aplicada; pergunta | manter a aplicada |
| g. Registro | só `ends_at`; gravar padrão e aplicada | gravar `default_duration_minutes` e `applied_duration_minutes` no compromisso e no histórico, e corrigir `occupancy.ts` para usar `occupies_until` |
| h. IA | vê só o padrão; vê também a aplicada | só o padrão do catálogo (sem mudança em DEC-011) |
| i. Agenda | bloco com o comprimento aplicado; com marcador | comprimento aplicado + rótulo «duração ajustada» |

## DEC-052 — Etapa «Agendado» ao confirmar

Opções: (1) não mudar etapa (comportamento atual); (2) mover automaticamente para «Agendado»; (3) perguntar na revisão. DEC-040(a) só define o sentido inverso (mudar etapa nunca cria compromisso). **Recomendação:** (2), com evento no histórico. **Bloqueia:** qualquer mudança de etapa a partir do Agendar; até decidir, a tela não altera etapa.

## DEC-053 — Aviso por WhatsApp: padrão e fora da janela de 24 h

Opções do padrão: ligado ou desligado. Fora da janela (DEC-040(d) já proíbe texto livre): (1) desligar o aviso com explicação; (2) oferecer o modelo «confirmação de horário» (cadastro confirmado em [whatsapp-templates-draft.md](whatsapp-templates-draft.md), ainda sem aprovação Meta). **Recomendação:** ligado dentro da janela quando há conversa; fora dela, (1) até o modelo estar aprovado, depois (2). **Bloqueia:** o padrão definitivo do interruptor e o envio por modelo. **Padrão seguro no staging:** desligado; fora da janela o interruptor fica indisponível com explicação.

## DEC-054 — «Ver calendário» além de 7 dias

Opções: 7 dias; 30 dias; 60 dias; horizonte definido pela owner. **Recomendação:** 60 dias no MVP, configurável depois. **Bloqueia:** o horizonte final do calendário. **Padrão no staging:** calendário até 60 dias, marcado como Em aberto.

## DEC-055 — Critério e horizonte do «Próximo livre»

Opções de critério: mesmo profissional escolhido; qualquer profissional. Horizonte: 7, 14 ou 30 dias. **Recomendação:** respeitar a escolha atual (profissional escolhido, ou qualquer se «Qualquer»), primeiro horário mais cedo, até 14 dias; depois endpoint no servidor. **Padrão no staging:** esse mesmo, calculado no cliente dia a dia (até 14 consultas).

## DEC-056 — Sala na grade ou só na revisão

Opções: mostrar sala em cada horário (spec atual, ux-ui.md tabela «Lista de horários»); só na revisão; na grade só quando houver mais de uma sala possível. **Recomendação:** só na revisão e no rodapé, mantendo a grade de 4 colunas legível. **Padrão no staging:** sala na revisão e no rodapé; horários repetidos com salas diferentes aparecem uma vez (primeira opção devolvida pela API).

## DEC-057 — Horários ocupados em tempo real

Opções: polling (15 s, atual); evento WebSocket `appointment.*` invalidando a grade; ambos. **Recomendação:** WebSocket com polling de reserva. **Bloqueia:** o critério «marcado como indisponível imediatamente» de ux-ui.md; até decidir mantém-se polling + recheque antes de confirmar.
