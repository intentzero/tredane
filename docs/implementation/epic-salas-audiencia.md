# Épico — Salas partilhadas e audiência do serviço (DEC-075)

**Estado:** especificação de implementação **Confirmada** no desenho (Paulo, 29/10/2026: «vamos considerar estes casos de uso no sistema, prepara um epico de implementacao»). Este documento é o épico. Issue: [#284](https://github.com/intentzero/tredane/issues/284). Nenhuma fatia está implementada. Não altera código.

**Decisão:** [DEC-075](../product/decisions.md). Revisa só a frase «profissional atende 1 de cada vez» da [DEC-059](../product/decisions.md). Mantém DEC-008 (duração, intervalo, grade de 15 min), DEC-042 (só a responsável configura), DEC-011 (contexto da IA) e DEC-061 (marcação automática só pelo botão).

**Onde vive o dado:** SQLite do Durable Object da clínica (DEC-038). Nada disto vai para o D1 central. Exemplos só com nomes fictícios (Gi, Ana, Bia, Sandra, colega).

---

## Já existe em `main` — não reimplementar a DEC-059

Conferido no código da `main` (schema da clínica na versão 30). O que já está feito continua a valer; as fatias abaixo só acrescentam o que a DEC-075 muda.

| Já existe | Onde | O que a DEC-075 não manda refazer |
| --- | --- | --- |
| Capacidade da sala, inteiro de 1 a 50, padrão 1. Equipamento e profissional devolvem capacidade 1. | Migração `0021_room_capacity`; `resourceCapacity` em `src/clinic/scheduling/occupancy.ts`; teste «valida limites: 1–50, só sala» | Não criar uma segunda capacidade. Não dar capacidade ao equipamento. |
| Pico por bloco de 15 min. Lotado bloqueia. Reduzir a capacidade abaixo do já marcado avisa e não apaga. Sala de 1 lugar não mostra «1/1». | `peakConcurrent`, `listOverCapacitySlots`; testes em `src/clinic/scheduling/capacity.test.ts` | Manter o bloco de 15 min. O que muda, na fatia S3, é contar **pessoas** e não marcações. |
| A mesma profissional não se sobrepõe, mesmo numa sala de capacidade 5. Duas profissionais diferentes já cabem na mesma sala se a capacidade permitir. | Testes «a profissional continua a atender uma pessoa de cada vez» e «capacidade 2: aceita duas pessoas e bloqueia a terceira no pico» | O modo padrão «Cada profissional com a sua cliente» é este comportamento. Não o reescrever como se a sala de capacidade > 1 ainda fosse exclusiva de uma profissional. |
| A sala da marcação vem do serviço (`service_room_requirements`: `none`, `category`, `resource` ou `any`, migração 0023), não da profissional. A profissional não tem sala. | `resolveRooms` em `src/clinic/scheduling/query.ts`; `appointments.room_resource_id` | Passa a faltar: a sala é a da profissional escolhida (S3). O requisito de sala no serviço deixa de escolher a sala da marcação nova. |
| O pico conta intervalos de marcação, não pessoas distintas. Dois serviços da mesma pessoa no mesmo bloco contam hoje como duas vagas. | `peakConcurrent` soma intervalos que se sobrepõem ao bloco | Passa a faltar: a mesma pessoa no mesmo bloco conta 1 (S3). |
| Contato sem sexo: `contacts` tem `id`, `tenant_id`, `wa_id`, `display_name`, `created_at` (migração 0001). | `src/clinic/migrations/0001_clinic_foundation.ts` | Não acrescentar coluna de sexo. |
| Serviço sem audiência. Catálogo da IA: nome, duração, preço e explicação para clientes. | Tabela `services` (migração 0003); `AiCatalogService` em `src/ai/types.ts` | Passa a faltar: audiência (S2) e o filtro de linha (S6). |
| Frase fixa da sala na confirmação WhatsApp, sem número de vagas. A IA não fala de vagas. Sinal Pix por pessoa. Bloco pendente ocupa vaga. | DEC-059; `sharedSpaceNotice` no horário | Manter. As frases novas (S6) também não dizem quantas vagas há. |
| Eventos da agenda já publicados no outbox da clínica: `appointment.confirmed`, `appointment.cancelled`, `appointment.rescheduled`. | `src/clinic/scheduling/booking.ts` | Reutilizar. Não criar outro canal de tempo real. |
| Configuração só pela responsável (`clinic.config.write`, DEC-042). A atendente marca. | Rotas em `src/clinic-config/routes.ts` | Audiência, sala da profissional, modo e mesmo sexo seguem esta escrita. «Permitir os dois» também é só da responsável (S5). |

**O que falta, por fatia:** audiência do serviço (S2); sala na profissional, marcação nessa sala, partilha e contagem por pessoa (S3); modo grupo (S4); mesmo sexo e «Permitir os dois» (S5); frases da agenda, do WhatsApp e da IA (S6).

---

## Fora deste épico

Sexo na ficha da pessoa. Inferir sexo pelo nome, pelo nome do serviço ou por marcações antigas. Terceiro tipo «pessoa a operar máquina» como trava dupla obrigatória. A cliente ou a IA abrirem a mistura de sexos no bloco. Telegram. Anunciar número de vagas (à cliente, no WhatsApp ou na IA). Preferência de audiência gravada na ficha (continua à espera de GATE-04). Marcar, cancelar ou remarcar por texto livre (DEC-061).

---

## Ordem

S1 → S2 → S3 → S4 → S5 → S6. Cada fatia é verificável sozinha com dados fictícios de uma clínica. Os três casos do fim do documento fecham o épico, quando S2 a S6 estiverem feitas. S1 não muda o comportamento de marcação.

---

## S1 — Decisão, aceite e migração que preserva o atual

**Comportamento.** O desenho fica registado em DEC-075. A migração da clínica só grava os padrões que reproduzem o que `main` faz hoje: capacidade que a sala já tem, modo «Cada profissional com a sua cliente», «Mesmo sexo neste horário» desligado, audiência `qualquer` em todas as linhas de serviço, inclusive quando o nome contém «feminino» ou «masculino». Compromissos já gravados mantêm `room_resource_id`. A profissional ainda não passa a escolher a sala nesta fatia: isso é S3.

**Regras.** Não inferir audiência pelo nome. Não ligar mesmo sexo. Não mudar uma sala para «Uma profissional para todas». Não apagar capacidade. Equipamento continua sem estes campos. Contato continua sem sexo.

**Dados por tenant.** No SQLite da clínica, na migração seguinte à versão 30 (conferir `CLINIC_SCHEMA_VERSION` na `main` no momento de implementar; não reutilizar um número que outra migração já tenha ocupado):

- `services.audiencia` `TEXT NOT NULL DEFAULT 'qualquer'`, só `feminino`, `masculino` ou `qualquer`.
- Na sala (`resources.kind = 'room'`): modo de atendimento com padrão `cada_profissional`; mesmo sexo com padrão desligado. Capacidade já existe.
- Nada disto no contato. Nada no D1.

**Tempo real.** Nenhum evento novo. A migração não publica marcação.

**Critérios de aceite.**

- [ ] Um serviço chamado «Bronzeamento feminino», já gravado, fica com audiência `qualquer` depois da migração, até a responsável gravar outro valor.
- [ ] Uma sala que tinha capacidade 4 continua com 4; mesmo sexo desligado; modo «Cada profissional com a sua cliente».
- [ ] A tabela `contacts` não ganha coluna de sexo.
- [ ] Os testes já existentes de capacidade (profissional sem sobreposição, pico de 15 min, equipamento sem capacidade, sala 1–50) passam sem serem reescritos para o modo grupo.

---

## S2 — Audiência do serviço

**Comportamento.** No serviço (M-16), a responsável escolhe **Feminino**, **Masculino** ou **Qualquer**. O padrão, ao criar e nas linhas antigas, é Qualquer. O rótulo descreve o serviço, não a pessoa. A atendente marca qualquer serviço ativo, seja qual for a audiência. A atendente não edita a audiência (DEC-042).

**Regras.** Gravar um nome «Bronzeamento feminino» sem escolher audiência não muda Qualquer. Omitir o campo numa edição mantém o valor já gravado. Valor fora da lista é recusado. Não ler marcações antigas para preencher o campo. Não escrever sexo no contato.

**Dados por tenant.** Coluna da S1, escrita só com `clinic.config.write`, no SQLite da clínica. O catálogo que a IA já recebe passa a incluir a audiência junto do nome, da duração e do preço (DEC-011, REQ-072). O filtro por pedido explícito é a S6: nesta fatia o campo viaja no catálogo e ainda não esconde linhas.

**Tempo real.** A configuração da clínica não tem evento próprio hoje. Outra sessão da mesma clínica vê a audiência na leitura seguinte do serviço (REQ-041). Outra clínica não lê esta linha.

**Critérios de aceite.**

- [ ] Criar «Depilação» sem audiência grava `qualquer`. Renomear para «Depilação feminina» sem mexer na audiência mantém `qualquer`.
- [ ] A responsável grava «Bronzeamento feminino» como Feminino e «Bronzeamento masculino» como Masculino. Os dois ficam ativos.
- [ ] A atendente, na mesma clínica, marca os dois. Não consegue gravar a audiência (a API recusa).
- [ ] O contato da cliente não ganha campo de sexo depois destas marcações.
- [ ] O payload de catálogo inspecionado no teste contém a audiência e continua sem telefone, anexos ou dados de outra clínica.

---

## S3 — Sala da profissional e partilha

**Comportamento.** Cada profissional tem uma sala (M-21). Várias profissionais podem apontar para a mesma sala. A sala não é exclusiva. A marcação nova cai na sala da profissional escolhida. A equipa pode trocar a sala só naquela marcação; as seguintes voltam à sala da profissional. Com capacidade 1 não há perguntas de modo nem de sexo: uma cliente e uma profissional (caso da Gi). Com capacidade maior, o padrão «Cada profissional com a sua cliente» fica visível (o modo grupo é a S4; aqui só se prova o padrão).

**Regras.**

- A profissional trava só a si: no mesmo bloco não atende outra pessoa, nem noutra sala.
- Dois serviços da **mesma pessoa** no mesmo bloco contam como uma pessoa. Duas marcações sem o mesmo contato contam como duas pessoas (na dúvida, não fundir).
- A sala recusa quando o pico de pessoas distintas no bloco de 15 min chega à capacidade.
- Uma profissional não ocupa a vaga da outra.
- O requisito de sala no serviço (`category`, `resource`, `any`) deixa de escolher a sala da marcação nova. Equipamento exigido pelo serviço continua uma vaga, sem capacidade (DEC-059).
- Capacidade 1 não mostra modo nem «Mesmo sexo neste horário».
- Se a migração não conseguir uma sala única e inequívoca para a profissional (os serviços ativos dela não apontam todos para a mesma sala em modo `resource`), a sala fica por preencher e a marcação nova dessa profissional espera a responsável escolher. Compromissos antigos não mudam de sala.

**Dados por tenant.** Na profissional, referência à sala da mesma clínica. Na marcação, `room_resource_id` continua a ser a sala daquele compromisso (a da profissional, ou a troca pontual). Contagem por `contact_id` dentro do bloco; sem contato, cada marcação é uma pessoa. Isolado por `tenant_id`.

**Tempo real.** Confirmar, cancelar, reagendar ou trocar a sala da marcação reutiliza `appointment.confirmed`, `appointment.cancelled` e `appointment.rescheduled`. Duas sessões da clínica vêem a mudança; a outra clínica não. Horário que enche deixa de aparecer no Agendar pela mesma reconciliação já usada (DEC-057, REQ-041).

**Critérios de aceite.**

- [ ] Gi tem a sala Depilação (capacidade 1). A colega tem a sala Massagem (capacidade 1). Depilação é feita pela Gi; massagem, pela Gi e pela colega. Massagem com a Gi usa a sala da Gi. Massagem com a colega usa a sala de Massagem.
- [ ] Gi em depilação às 9h não massaja às 9h. A colega massaja às 9h na sala dela.
- [ ] A equipa troca a sala só numa marcação da Gi. A marcação seguinte da Gi volta à sala Depilação.
- [ ] Ana e Bia apontam para a mesma sala, capacidade 2, modo «Cada profissional com a sua cliente». Às 9h cada uma tem uma cliente. A terceira pessoa não entra. Ana não fica com a cliente da Bia, nem o contrário.
- [ ] A mesma cliente com dois serviços da Ana no mesmo bloco ocupa uma pessoa, e a Bia ainda cabe na capacidade 2.
- [ ] Sala de capacidade 1 não mostra as duas escolhas nem «Mesmo sexo neste horário».
- [ ] Equipamento continua a recusar uma segunda marcação sobreposta, sem campo de capacidade.

---

## S4 — Modo grupo

**Comportamento.** Sala com capacidade maior que 1 mostra duas escolhas. O padrão continua «Cada profissional com a sua cliente» (S3). A outra é «Uma profissional para todas»: a mesma profissional ocupa várias vagas naquela sala, até à capacidade, e não está noutra sala no mesmo bloco.

**Regras.** Contagem de pessoas da S3. A profissional no modo grupo pode ter N pessoas distintas na sala dela e zero noutra sala nesse bloco. Não se exige uma segunda profissional. Não se cria capacidade à parte na profissional. Capacidade 1 não oferece esta escolha. Equipamento não tem modo.

**Dados por tenant.** O modo fica na sala, no SQLite da clínica. Padrão `cada_profissional` (S1). Escrita só pela responsável.

**Tempo real.** Mudar o modo não abre canal novo. A agenda da outra sessão da mesma clínica passa a oferecer ou recusar horários na leitura seguinte e nos eventos de marcação já existentes. Outra clínica não vê o modo.

**Critérios de aceite.**

- [ ] Sala da Sandra, capacidade 4, «Uma profissional para todas». A Sandra tem quatro clientes distintas sobrepostas nessa sala. A quinta é recusada.
- [ ] Com uma vaga ainda livre, a marcação não é recusada por «falta outra profissional».
- [ ] A Sandra com uma cliente nessa sala às 9h não marca noutra sala às 9h.
- [ ] A mesma cliente com dois serviços da Sandra no mesmo bloco conta uma pessoa: cabem mais três clientes, não duas.
- [ ] Voltar o modo para «Cada profissional com a sua cliente» faz a Sandra voltar a travar só a si. As marcações já feitas não são apagadas (o aviso de capacidade da DEC-059 mantém-se se a sala ficar acima do marcado).

---

## S5 — Mesmo sexo e «Permitir os dois»

**Comportamento.** «Mesmo sexo neste horário» aparece só com capacidade maior que 1, desligado por padrão. Ligado, o bloco — a sobreposição naquela sala — fica com o sexo da primeira audiência **feminino** ou **masculino**. As marcações seguintes de audiência feminino ou masculino têm de coincidir e de ter vaga. Quando a sala fica livre, o bloco seguinte pode ser o outro sexo. A responsável pode «Permitir os dois» naquele bloco, com confirmação explícita, e isso fica auditado. A atendente não tem a ação. A cliente não tem. A IA não tem.

**Regras.**

- Audiência `qualquer` não fixa o sexo do bloco e não o quebra: entra se houver vaga.
- A primeira marcação do bloco cuja audiência do serviço é feminino ou masculino fixa o sexo. A ordem estável é o início e, em empate, o identificador da marcação.
- Audiência oposta no mesmo bloco é recusada enquanto houver sobreposição, salvo «Permitir os dois» já confirmado para aquele intervalo.
- «Permitir os dois» vale só para o bloco confirmado (sala e intervalo). Não muda o padrão da sala e não passa para o bloco seguinte, depois de a sala ficar livre.
- «Não há mais agendamentos» não é regra do sistema: a responsável decide fora do produto.
- Não ler sexo do contato, do nome ou de marcações antigas. A audiência vem do serviço (S2).
- Capacidade 1 não mostra o interruptor.

**Dados por tenant.** Interruptor na sala, padrão desligado (S1). A exceção grava, no SQLite da clínica, sala, início e fim do bloco, responsável que confirmou e instante. Ação de auditoria `room.allow_both_sexes`, com ator, sala e intervalo — sem sexo da cliente e sem dados de outra clínica. Escrita da exceção só com papel de responsável.

**Tempo real.** A exceção e uma marcação recusada ou aceite seguem os eventos de agenda já existentes para as sessões da mesma clínica. Não há evento para a cliente nem para outra clínica.

**Critérios de aceite.**

- [ ] Sala da Sandra, capacidade 4 ou 5, «Uma profissional para todas», mesmo sexo ligado. Bronzeamento feminino com audiência feminino e bronzeamento masculino com audiência masculino.
- [ ] A primeira marcação feminina às 9h fixa o bloco. Uma marcação masculina que se sobrepõe é recusada. Uma de audiência qualquer no mesmo bloco entra se houver vaga, e o bloco continua feminino.
- [ ] Com a sala cheia, a próxima pessoa é recusada mesmo com o sexo certo.
- [ ] A responsável confirma «Permitir os dois» nesse bloco. A marcação masculina sobreposta passa a caber, se houver vaga. A confirmação fica na auditoria com o ator responsável. A atendente e um pedido da IA não gravam a exceção.
- [ ] Depois de a sala ficar sem sobreposição, uma marcação masculina abre bloco novo, sem herdar «Permitir os dois».
- [ ] Capacidade 1 não mostra «Mesmo sexo neste horário» nem «Permitir os dois».

---

## S6 — Textos da agenda, do WhatsApp e da IA

**Comportamento.** A recusa que a equipa vê diz o motivo, em texto fixo do backend. A confirmação pelo WhatsApp continua com a frase fixa da sala, sem número de vagas (DEC-059, DEC-053). A IA recebe a audiência no catálogo (S2). Se a cliente pede em texto uma linha feminina ou masculina, o catálogo usado naquela interpretação fica nessa audiência mais os serviços `qualquer`. Pedido dos dois sexos, pedido ambíguo ou pedido sem linha não filtra e não grava preferência. A IA não diz quantas vagas há, não oferece «Permitir os dois» e não marca sozinha: a marcação automática continua só pelo botão da proposta versionada (DEC-061).

**Regras.** Textos fixos, sem número de lugares:

- Sala cheia: «Esse horário nesta sala já está cheio.»
- Profissional já noutra sala: «A profissional já está noutra sala nesse horário.»
- Sexo do bloco: «Nesse horário a sala está só para o público feminino.» ou «…masculino.»
- Não dizer que falta outra profissional quando a sala ainda tem vaga (modo grupo).
- Corrida em que o horário desaparece entre a lista e a confirmação pode manter «Esse horário acabou de ser ocupado. Nada foi reservado.»
- O modelo não redige estas recusas. Não anunciar «resta 1 vaga» nem «2 de 4» à cliente, no WhatsApp ou na sugestão.

**Dados por tenant.** Nenhum dado novo de pessoa. A preferência de linha não é gravada no contato. O filtro aplica-se ao catálogo daquela chamada, na clínica da sessão.

**Tempo real.** A lista de horários da equipa continua a atualizar pelos eventos de agenda (DEC-057). Não se empurra vaga nem sexo do bloco para o WhatsApp da cliente como contagem.

**Critérios de aceite.**

- [ ] Sala cheia devolve a frase de sala cheia, sem quantidade.
- [ ] Profissional ocupada noutra sala devolve a frase da outra sala, e não a frase de sala cheia, quando a sala de destino ainda tem vaga.
- [ ] Sexo oposto devolve a frase do público feminino ou masculino, sem quantidade e sem «Permitir os dois» no texto enviado à cliente ou à IA.
- [ ] Catálogo com depilação `qualquer`, bronzeamento feminino e bronzeamento masculino: a frase «quero o bronzeamento feminino» deixa o feminino e a depilação; tira o masculino. «Quero bronzeamento» sem linha, ou com as duas linhas, não filtra.
- [ ] Nenhuma destas frases grava sexo ou preferência no contato.
- [ ] Texto livre da cliente não cria marcação (DEC-061). O botão da proposta é que confirma, e o clique revalida sala, modo e sexo no mesmo caminho da marcação manual.

---

## Casos de aceite do épico

Nomes fictícios. Os três têm de passar com S2–S6 feitas. Não substituem os critérios de cada fatia.

### 1. Gi — capacidade 1 e duas salas

Sala Depilação, capacidade 1, da Gi. Sala Massagem, capacidade 1, da colega. Depilação: Gi, audiência qualquer. Massagem: Gi e colega, audiência qualquer. Massagem com a Gi usa a sala da Gi. Com a colega, a sala de massagem. Gi em depilação às 9h não massaja às 9h. A colega pode. A equipa troca a sala numa marcação; a seguinte da mesma profissional usa de novo a sala dela.

### 2. Salão partilhado

Ana e Bia na mesma sala, capacidade 2 ou mais, «Cada profissional com a sua cliente». Às 9h cada uma tem uma cliente. A terceira espera. Uma não ocupa a cadeira da outra.

### 3. Sandra — grupo e mesmo sexo

Uma profissional, capacidade 4 ou 5, «Uma profissional para todas», mesmo sexo ligado. Bronzeamento feminino e masculino com essas audiências. O primeiro horário fixa o sexo. O outro sexo no mesmo bloco é recusado até «Permitir os dois». Vaga esgotada recusa. Depois de a sala ficar livre, o outro sexo pode abrir bloco novo. Dois serviços da mesma pessoa no mesmo bloco contam como uma pessoa.

---

## O que este épico não fecha

Valores reais da clínica piloto. Revisão jurídica antes de dados reais (GATE-04). Implementação: fica para PRs seguintes, um por fatia, a partir deste documento. Este PR não contém migração, ecrã nem regra de ocupação.
