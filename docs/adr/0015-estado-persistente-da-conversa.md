# ADR-0015 — Estado persistente da conversa (BookingFrame)

- **Estado:** **Confirmado** (Paulo, chat Project 02/11/2026, opção A — promover o ADR). A [DEC-127](../product/decisions.md) (Confirmada, 02/11/2026, PR [#463](https://github.com/intentzero/tredane/pull/463)) fixa as regras de produto; este ADR fixa o desenho de engenharia. A **implementação** da M2 ([#412](https://github.com/intentzero/tredane/issues/412)) está no código (migração `0049_booking_frame`, `BookingFrame` / `getBookingFrame`, cutover L1).
- **Origem:** [núcleo determinístico §3.3](../architecture/nucleo-deterministico-conversacional.md); [plano de testes](../implementation/plano-testes-conversacional.md) CA-02, CF-21, CF-22; épico [#401](https://github.com/intentzero/tredane/issues/401) / issue [#412](https://github.com/intentzero/tredane/issues/412); DEC-127.
- **Complementa:** [ADR-0012](0012-clinic-durable-object-sqlite.md) (SQLite nativo no Durable Object da clínica). Não altera DEC-061 (só o botão marca), DEC-079 (nada sobre a pessoa), DEC-083, DEC-086 nem DEC-104.
- **Escopo:** decisão de arquitetura e plano de migração. **Não** é implementação, migração executada, deploy nem frase nova à cliente.

## Problema

Hoje o funil de marcação combina três fontes incompletas (CA-02):

1. **`schedule_sessions`** (migrações [0044](../../src/clinic/migrations/0044_schedule_session.ts) e [0048](../../src/clinic/migrations/0048_schedule_session_memory.ts); API em [`schedule-session.ts`](../../src/clinic/ai/schedule-session.ts)) — uma linha por `(tenant_id, conversation_id)` com serviço, linha, `day_label` relativo, período, variantes e `clock_time`.
2. **Releitura do histórico** (20–40 mensagens, regex em vários sítios) para descobrir o que a cliente já disse.
3. **Releitura do texto enviado pela clínica** para descobrir o que foi oferecido.

Isto produz três classes de falha:

| Achado | Sintoma | Evidência no código (`main` @ tip com DEC-127) |
| --- | --- | --- |
| **CF-21** | `day_label` guarda «amanhã» / «quinta» e só é resolvido no turno seguinte. Se a conversa atravessa a meia-noite, a proposta pode sair no dia errado. | [`autobook.ts:463–464`](../../src/clinic/ai/autobook.ts) resolve `session.dayLabel` com `clinicCivilDateFromUtc` da mensagem actual; [`reschedule.ts:204–205`](../../src/clinic/ai/reschedule.ts) resolve `session.dayLabel` com `today` quando há oferta prévia. Coluna e CHECK em `0044_schedule_session.ts`. |
| **CF-22** | A oferta é inferida do texto outbound. Mudar a redação quebra a lógica. | [`zonesOfferedToClient`](../../src/clinic/ai/schedule-choice.ts) (`schedule-choice.ts:105`) lido em [`autobook.ts:836`](../../src/clinic/ai/autobook.ts); marcador `RESCHEDULE_OFFER_MARKER` em [`reschedule.ts:32`](../../src/clinic/ai/reschedule.ts) e deteção em `reschedule.ts:143`. |
| Perguntas fechadas | «o das 14», «a segunda», «👍», «sim» não têm `pending.options` estruturado; o interpretador não tem âncora estável. | Núcleo §3.2; matriz C-05/C-06; DEC-127 (3). |

**Confirmado (produto):** as regras de validade, ambiguidade e migração de dados abertos estão na DEC-127. **Confirmado (este ADR, Paulo, chat Project 02/11/2026):** o desenho de engenharia abaixo (escolha de tabela, contrato, limpeza, isolamento, migração e rollout). A implementação M2 está no código (migração 0049 / cutover L1).

## Opções consideradas

| Opção | Resumo | Prós | Atenção |
| --- | --- | --- | --- |
| **(a) Estender `schedule_sessions`** | Evoluir a tabela actual (PK já é 1 linha/conversa): data absoluta, `pending`, `lastOffer`, `proposal`, `phase`, `catalogVersion`, proveniência; retirar `day_label`. Tipo TypeScript `BookingFrame`. | Alinha com DEC-127 (migração de campos das sessões abertas); reutiliza 0044/0048; ALTER incremental no padrão do repo; menor superfície na sombra (mesma linha). | CHECK antigo de `day_label`; colunas JSON; risco de deixar código a ler o modelo parcial antigo. |
| **(b) Tabela nova `booking_frames`** | Criar tabela com o contrato §3.3; copiar sessões; desactivar `schedule_sessions`. | Nome e schema limpos; sombra com dual-write explícito. | Duas fontes durante a transição; cópia + drop por DO; mais passos de rollback. |
| **(c) Derivar do histórico** | Continuar a reconstruir o estado a cada turno (CA-02). | Sem migração de esquema. | Não fecha CF-21/CF-22; regex frágil; perguntas repetidas; **descartada**. |

### Escolha (**Confirmado**)

**Opção (a) — estender `schedule_sessions` até ao contrato `BookingFrame` do §3.3.**

Motivo: a cardinalidade e a chave já estão correctas; a DEC-127 descreve o destino das sessões abertas campo a campo (descartar só o dia relativo); as migrações do DO já evoluem esta tabela por ALTER (0048); o risco médio da M2 fica no *shape* dos dados e no cutover do interpretador, não numa segunda topologia de persistência. No código, o tipo e os acessores passam a chamar-se `BookingFrame` / `getBookingFrame`. A tabela SQL **mantém** o nome `schedule_sessions`; **não** renomear na migração 49 nem depois como requisito da M2. A opção (b) fica descartada para este recorte.

A opção (c) fica **fora**.

## Decisão — formato `BookingFrame`

**Confirmado:** uma linha por conversa no SQLite do Durable Object da clínica ([ADR-0012](0012-clinic-durable-object-sqlite.md) / DEC-038), gravada **na mesma transação SQLite** que a mensagem de saída (e a intenção/outbox associados a esse turno). Memória, WebSocket e releitura de texto **não** são fonte de verdade do frame.

Contrato alinhado ao [núcleo §3.3](../architecture/nucleo-deterministico-conversacional.md) (confirmação face ao código actual: hoje existem `service_id`, `audience_line`, `day_label`, `period`, `variant_ids`, `clock_time`, `updated_at` — faltam fase, data absoluta, `pending`, `lastOffer`, `proposal`, preferência de profissional, `catalogVersion` e proveniência):

```ts
type BookingFrame = {
  phase: 'idle' | 'coletando' | 'ofertado' | 'proposto' | 'pix_pendente' | 'remarcando' | 'pausado'
  serviceId: string | null
  line: 'feminino' | 'masculino' | null
  variantIds: string[] | null
  professionalPref: string | null
  date: string | null // data civil absoluta no fuso da clínica (YYYY-MM-DD); corrige CF-21
  period: 'manha' | 'tarde' | 'noite' | null
  time: string | null // HH:MM no fuso da clínica
  pending: {
    slot: string
    options: Array<{ key: string; label: string }>
    messageId: string
  } | null
  lastOffer: {
    slots: Array<{ startsAt: number; professionalId: string }>
    messageId: string
  } | null // corrige CF-22
  proposal: { id: string; version: number } | null
  rescheduleAppointmentId: string | null
  catalogVersion: string // mudança de catálogo → revalidar ids
  provenance: Record<string, { messageId: string; source: 'regra' | 'botao' | 'llm' }>
}
```

### Interpretador

**Confirmado:** a resposta do turno seguinte é lida **primeiro** contra `pending.options` (ordinal, hora citada, 👍 com uma opção, sim/não), como no núcleo §3.2. Só depois entram parsers de data/hora e o extrator LLM restrito (M6 / DEC-109), quando existirem.

### Regras de produto (DEC-127) — copiar, não reabrir

**Confirmado** (Paulo, 02/11/2026, «A» nas quatro perguntas do guia da [#412](https://github.com/intentzero/tredane/issues/412)):

1. **Validade:** `pending` e `lastOffer` valem até uma nova oferta as substituir ou até **24 horas** sem mensagem da cliente, o que vier primeiro; depois a resposta não tem contexto e o sistema pergunta de novo com horários actuais.
2. **«a segunda»:** se a leitura por dia da semana e a leitura por ordem na lista apontam para a **mesma** opção, aceita; se apontam para opções **diferentes**, o sistema pergunta de volta com as opções fechadas, **sem** escolher.
3. **👍, «sim», «pode ser», «fechado»:** com **uma** só opção pendente escolhem essa opção e o sistema envia a proposta; com **várias** não escolhem e o sistema pergunta qual; depois de proposta enviada não fazem nada além de lembrar o botão (**DEC-061**).
4. **Migração de dados abertos:** descarta só o dia relativo (`day_label`) das sessões abertas e mantém serviço, linha, variantes, período e hora; a cliente é perguntada **uma vez** sobre o dia.

Opções de produto já descartadas na DEC-127: validade de 4 h ou sem prazo; o dia da semana ou a ordem ganharem sempre; 👍 nunca escolher ou escolher a primeira de várias; resolver o dia pela data de início do funil ou descartar a sessão inteira.

### Limpeza do frame

**Confirmado** (alinhado ao §3.3 e às DECs citadas):

| Evento | Efeito |
| --- | --- |
| Troca de serviço | Limpa linha, variantes, hora (e `pending` / `lastOffer` / `proposal` / `professionalPref` ligados ao funil antigo); mantém a chave da conversa. |
| Marcação concluída / DEC-086 («Quero agendar outro serviço» ou fim do pós-agendamento conforme a DEC) | Frame limpo ou volta a `idle` sem slots preenchidos do funil anterior. |
| Nova versão de proposta (DEC-061 / DEC-116) | `proposal` aponta para a versão nova; a anterior deixa de autorizar; `pending`/`lastOffer` reconciliados com a oferta que sustentou a versão nova. |
| `catalogVersion` diverge do catálogo compilado do DO | Revalidar `serviceId` / `variantIds` / preferência; ids inválidos são limpos e o funil pergunta de novo o que faltar — **sem** inventar substituto. |

Nenhuma frase nova à cliente é introduzida por este ADR. **Confirmado** (Paulo, chat Project 02/11/2026): a pergunta única de dia pós-migração (DEC-127.4) **reusa** o acto `perguntar_dia` já aprovado (DEC-122/123 / [copy-dialogo-atos.md](../product/copy-dialogo-atos.md)). Sem frase nova e sem DEC-104 adicional.

## Isolamento, retenção e exclusão

Segue [AGENTS.md](../../AGENTS.md) e o ADR-0012: um DO por clínica **não** isola sozinho os outros serviços.

| Superfície | Regra (**Confirmado**) |
| --- | --- |
| API | Autorização com membership do tenant activo; o Worker só encaminha ao DO cujo id interno coincide com o tenant (ADR-0012). |
| SQLite do DO | `BookingFrame` leva `tenant_id` + `conversation_id`; consultas e gravações só dentro da instância da clínica. |
| WebSockets | No MVP há evento dedicado `booking_frame.updated` quando o frame muda (padrão `entity.action` do outbox/realtime, cf. `conversation.updated`, `message.created`). Só membros do tenant/clínica da conversa; troca de clínica activa não reutiliza socket nem cache (DEC-017). |
| Queues / Workflows | Mensagens e jobs carregam tenant + ids estáveis; sem fan-out cross-tenant. |
| R2 | O frame **não** guarda anexos; R2 continua privado e autorizado à parte. |
| D1 central | Sem cópia canónica do frame; D1 mantém tenants/memberships/suporte. |
| Retenção / exclusão | Segue DEC-011 / DEC-099: exclusão do contacto apaga a conversa e o frame associado; purge do tenant remove o SQLite da clínica; não há sexo nem atributo da pessoa no frame (**DEC-079**). |
| Impersonação / suporte | Sem alargar capacidades; actor/subject continuam nas regras de suporte já Confirmadas. |

## Migração por Durable Object

**Baseline Confirmada no código:** `CLINIC_SCHEMA_VERSION = 49` ([`src/clinic/constants.ts`](../../src/clinic/constants.ts)), com `schedule_sessions` criada em 0044, memória em 0048 e BookingFrame em [`0049_booking_frame.ts`](../../src/clinic/migrations/0049_booking_frame.ts).

**Confirmado** (implementado na M2 / [#412](https://github.com/intentzero/tredane/issues/412)):

1. **Plano:** migração `0049_booking_frame` que:
   - adiciona colunas do `BookingFrame` (data absoluta, phase, pending JSON, lastOffer JSON, proposal JSON, professional_pref, catalog_version, provenance JSON, reschedule_appointment_id, etc.);
   - para cada linha existente: copia `service_id`, `audience_line` → `line`, `variant_ids`, `period`, `clock_time` → `time`; **não** copia `day_label` (DEC-127); `date` fica `NULL` até a cliente responder ao pedido de dia (uma vez);
   - remove ou deixa de usar `day_label` (DROP COLUMN se o SQLite do DO permitir no caminho de migração adoptado; senão coluna órfã ignorada pelo código novo);
   - regista a nova versão de schema **só** no fim bem-sucedido (padrão ADR-0012: falha bloqueia uso).
2. **Idempotência:** reexecutar a migração numa instância já em 49 é no-op; upgrade a partir de qualquer versão ≤ 48 percorre a cadeia existente até 48 e depois 49.
3. **Rollback:** se a 49 falhar a meio, a instância permanece bloqueada na versão anterior (não expõe schema a meio — critério ADR-0012). Rollback de *produto* (voltar a ler `day_label`) **não** é objectivo: o cutover só acontece depois dos testes abaixo. Em sombra, o caminho antigo continua a ler as colunas antigas até à troca.
4. **Teste obrigatório:** upgrade automatizado a partir de um fixture na **última** versão de schema lida do código no PR de implementação (hoje 48; se `main` avançar, o fixture acompanha). Casos: sessão só com serviço; sessão com linha+variantes+período+hora e `day_label='amanhã'` → `date IS NULL` e resto preservado; conversa sem sessão → sem linha de frame.

## Rollout

**Confirmado** (épico #401 + núcleo §8; gate de cutover Paulo, chat Project 02/11/2026). A execução (sombra, cutover, código) permanece trabalho da M2:

1. **Sombra:** o pipeline novo calcula o frame e a próxima acção **sem** enviar à cliente pelo caminho novo; compara com o caminho actual; regista divergências.
2. **Troca** quando passarem: **B-13, A-07, A-08, C-05, C-06, C-07, C-08, J-06**, mais o fecho observável de **CF-21** e **CF-22**. **C-08** entra no aceite de cutover da M2 junto com a lista da [#412](https://github.com/intentzero/tredane/issues/412) (não fica só na fatia M1c / #410).
3. **Propriedades** (núcleo §6 / aceite #412):
   - nenhuma pergunta sobre um slot já preenchido no frame;
   - replay do mesmo turno (mesmo input + mesmo frame + mesmo catálogo) produz a mesma saída.

## Decisões desta revisão (Paulo, chat Project 02/11/2026)

| # | Pergunta | Decisão | Estado |
| --- | --- | --- | --- |
| 1 | Nome da tabela SQL | Manter `schedule_sessions`; tipo/acessores TS `BookingFrame` / `getBookingFrame`. Não renomear na migração 49 nem como requisito da M2. | **Confirmado** |
| 2 | C-08 no gate M2 | **Sim** — C-08 no aceite de cutover com B-13, A-07, A-08, C-05, C-06, C-07, J-06 (+ CF-21/CF-22). | **Confirmado** |
| 3 | Evento WebSocket do frame | **Sim** no MVP: `booking_frame.updated` quando o frame muda; só membros do tenant/clínica da conversa. | **Confirmado** |
| 4 | Copy pós-migração (DEC-127.4) | Reusar acto `perguntar_dia` (DEC-122/123). Sem frase nova. | **Confirmado** |
| 5 | Estado do ADR | Opção A — promover o ADR inteiro a **Confirmado**. | **Confirmado** |

Não restam perguntas Em aberto deste ADR. A implementação M2 (código, migração 49, sombra, cutover) está entregue no PR de #412; com cutover activo, `zonesOfferedToClient` e `RESCHEDULE_OFFER_MARKER` **deixam de autorizar** (só o frame: `lastOffer` / `pending` / `date`); o marker pode permanecer na copy outbound e na sombra. **Same-TX implementada:** o frame (e `booking_frame.updated`) grava-se na mesma `transactionSync` que a mensagem de saída e o outbox (`SendOutboundInput.afterPersist` / `DeferredBookingFrame`); `pending.messageId` / `lastOffer.messageId` são o id da mensagem outbound desse turno.

## Consequências e riscos

| Item | Estado | Nota |
| --- | --- | --- |
| Desbloqueia implementação M2 (#412) | **Confirmado** | Desenho aprovado; código/migração/cutover/same-TX entregues. |
| Elimina `day_label` relativo como SoT | **Confirmado** | Corrige CF-21; data absoluta no frame. |
| Elimina regex sobre texto outbound como SoT da oferta | **Confirmado** | Corrige CF-22; `zonesOfferedToClient` / `RESCHEDULE_OFFER_MARKER` deixam de autorizar escolha após cutover. |
| Migração por DO (risco médio) | **Confirmado** | Upgrade schema 48→49 testado; tabela continua `schedule_sessions`. |
| Same-TX frame + mensagem + outbox | **Confirmado** (implementado) | `afterPersist` em `sendOutboundMessageOp`; testes de commit e rollback. |
| Sessões abertas perdem o dia relativo | **Confirmado** (DEC-127) | Uma pergunta de dia via `perguntar_dia`; resto preservado. |
| Dual-path durante sombra | **Confirmado** (plano de rollout) | Custo de manutenção temporário; cortar o path antigo no cutover. |
| Evento WS `booking_frame.updated` | **Confirmado** | MVP; isolamento por tenant/clínica. |
| Copy «pedir o dia» pós-migração | **Confirmado** | Acto `perguntar_dia` (DEC-122/123); sem DEC-104 nova. |

## Critérios de aceite deste ADR (documentação)

- Estado **Confirmado** no cabeçalho (Paulo, chat Project 02/11/2026); DEC-127 citada sem reabrir as quatro respostas de produto.
- Quatro perguntas da revisão Paulo + promoção do ADR fechadas como **Confirmado**.
- Opções (a)(b)(c) registadas; escolha (a) Confirmada e nome SQL estabilizado.
- Contrato `BookingFrame` alinhado ao §3.3; evidências CF-21/CF-22 com ficheiro+linha actuais.
- Plano de migração a partir do schema **48**, com idempotência, rollback e teste de upgrade (execução fora deste PR).
- Rollout sombra → troca com B-13, A-07, A-08, C-05–C-08, J-06 e propriedades de slot/replay.
- Isolamento por superfície; DEC-079 respeitada; evento WS nomeado.
- Implementação M2 e merge de código **fora** deste PR; este ADR não executa migração nem cutover.

## Referências

- Issue [#412](https://github.com/intentzero/tredane/issues/412); épico [#401](../implementation/epic-nucleo-conversacional.md)
- [Núcleo determinístico](../architecture/nucleo-deterministico-conversacional.md) §3.3, §3.4, §8 (M2), §10
- [Plano de testes](../implementation/plano-testes-conversacional.md) — CA-02, CF-21, CF-22
- [DEC-061](../product/decisions.md), [DEC-079](../product/decisions.md), [DEC-083](../product/decisions.md), [DEC-086](../product/decisions.md), [DEC-104](../product/decisions.md), [DEC-122](../product/decisions.md), [DEC-123](../product/decisions.md), [DEC-127](../product/decisions.md); acto [`perguntar_dia`](../product/copy-dialogo-atos.md)
- [ADR-0012](0012-clinic-durable-object-sqlite.md)
- Código: [`schedule-session.ts`](../../src/clinic/ai/schedule-session.ts), [`autobook.ts`](../../src/clinic/ai/autobook.ts), [`reschedule.ts`](../../src/clinic/ai/reschedule.ts), [`schedule-choice.ts`](../../src/clinic/ai/schedule-choice.ts), migrações 0044 e 0048
