# Épico — Bloco Tempo no serviço (DEC-077)

**Estado:** especificação de implementação **Confirmada** no desenho (Paulo, 29/10/2026: «ok, vamos criar um epico para isto, considerando os elementos de ui necessarios»). Este documento é o épico. Issue: [#301](https://github.com/intentzero/tredane/issues/301). Nenhuma fatia está implementada. Não altera código.

**Decisão:** [DEC-077](../product/decisions.md). Mantém DEC-008 (duração, intervalo, grade de 15 min, fuso da clínica), DEC-042 (só a responsável configura), DEC-011 (contexto da IA), DEC-061 (marcação automática só pelo botão) e DEC-075 (sala, capacidade, modo, audiência e mesmo sexo ficam de fora deste bloco).

**Onde vive o dado:** SQLite do Durable Object da clínica (DEC-038). Nada disto vai para o D1 central. Exemplos só com serviços fictícios (bronzeamento, depilação). Sem dados reais de clínica ou de paciente.

**Identificadores.** REQ-089 a REQ-093 e AC-61 a AC-67. REQ-085 a REQ-088 e AC-57 a AC-60 estão nomeados na issue [#293](https://github.com/intentzero/tredane/issues/293) (variantes de serviço), que não está na `main`. Este épico não os reutiliza e não renumera DEC nem REQ já gravados.

**Ecrã.** A spec de interface está em [ux-ui.md](../product/ux-ui.md) (M-16, hub da Clínica, TEL-05 e a frase da proposta). Este PR não altera mocks `.dc.html`, previews PNG nem `docs/design/screens.md`, no mesmo precedente do [épico das salas](epic-salas-audiencia.md). Quem implementar uma tela e mudar o mock atualiza juntos o `.dc.html`, o preview, `screens.md` e `ux-ui.md`.

---

## Já existe em `main` — não reimplementar a agenda

Conferido no código da `main` (schema da clínica na versão 31, migração `0031_service_audience`). As fatias abaixo só acrescentam o tempo. A busca de vaga, a confirmação e a proposta continuam as que já existem.

| Já existe | Onde | O que a DEC-077 não manda refazer |
| --- | --- | --- |
| Grade de 15 min no fuso da clínica, duração + intervalo, expediente, bloqueio, profissional e sala. Leitura que não cria reserva. | `queryAvailability` em `src/clinic/scheduling/query.ts` | Não criar uma segunda grade. O filtro automático entra nesta consulta, com um modo para a marcação manual (S5). |
| Confirmação na transação. | `confirmAppointmentInTransaction` e `confirmAppointmentOp` em `src/clinic/scheduling/booking.ts` | A marcação manual continua a confirmar. O tempo, nesse caminho, é aviso, não recusa (S6). |
| Proposta versionada, texto fixo, botões Confirmar e Alterar detalhes. No clique, revalida com `queryAvailability` e pode recusar a vaga. | `src/clinic/proposals/render.ts` (`renderProposalResultBody`), `execute-confirm.ts` | Não criar outro canal de WhatsApp. A recusa de tempo usa frase própria, não a frase de horário ocupado (S5). |
| Contexto da IA com vagas dos próximos dias, já lidas de `queryAvailability`. | `buildScheduleContext` em `src/clinic/ai/schedule-context.ts` (`freeSlots`) | Quando a consulta filtrar, estas vagas já saem filtradas. A S7 só impede o payload do provedor e junta a frase do motivo quando fizer falta. |
| Fuso por clínica, padrão `America/Sao_Paulo`. | `clinic_settings.timezone`; `clinicDayBounds` | Não criar outro fuso. A hora avaliada é o início do compromisso neste fuso. |
| Endereço em texto livre, só no cartão «Sugestões com IA», e só com o interruptor ligado. | `clinic_settings.clinic_address`; `AiAssistCard` | Não usar este parágrafo como local da previsão. DEC-011 mantém o endereço fora do conjunto mínimo confirmado. |
| Configuração só pela responsável (`clinic.config.write`, DEC-042). | Rotas em `src/clinic-config/routes.ts` | Local e bloco Tempo seguem esta escrita. A atendente marca; não grava o bloco. |
| Audiência, capacidade, modo e mesmo sexo. | DEC-075 | Não entram na avaliação do tempo. Não há tabela genérica de restrições. |

**O que falta, por fatia:** colunas com padrão «Tanto faz» (S1); local da clínica (S2); bloco no serviço (S3); adaptador e avaliador (S4); filtro, proposta e clique (S5); aviso na marcação manual (S6); frase no contexto da IA, sem payload (S7).

---

## Regra

O bloco vem **desligado**: céu e temperatura em **Tanto faz**. Isso é ausência de restrição. Só a responsável liga (DEC-042).

**Céu:** Tanto faz | Sol | Chuva. Uma opção.

- **Sol.** Na hora de início, o símbolo da previsão é céu limpo, pouco nublado ou parcialmente nublado, e não há chuva. Não serve: muito nublado, encoberto, garoa, chuva, trovoada, nevoeiro.
- **Chuva.** A hora tem de estar chuvosa: chuva, garoa ou trovoada. Céu limpo, nublado ou nevoeiro sem esses fenómenos não servem.

A clínica não vê percentagem de precipitação. Se o provedor só entregar percentagens ou códigos, o adaptador traduz para estes símbolos. O corte numérico fica na spec técnica do adaptador (S4), não na interface.

**Temperatura:** Tanto faz | Acima de X °C | Abaixo de X °C. X é inteiro definido pela responsável. Não os dois ao mesmo tempo. **Acima de X** exige temperatura inteira estritamente maior que X. **Abaixo de X** exige estritamente menor. O valor igual a X não serve em nenhum dos dois.

Céu e temperatura são independentes. Os dois podem estar ligados. A hora tem de cumprir os dois. Um serviço que «precisa de chuva» ou de frio usa só o campo que importa. Depilação fica em Tanto faz. Bronzeamento de exemplo: Sol e, se a responsável quiser, Acima de 24 °C.

**Quando se avalia.** A hora de início do compromisso, no fuso da clínica, no local da clínica (cidade ou coordenadas, gravado uma vez). Não se avalia o fim, o intervalo nem o bloco inteiro. A hora do provedor é a que contém esse início, no fuso da clínica; o detalhe dessa escolha fica na spec do adaptador.

**Sem local ou sem previsão.** O caminho automático não oferece o horário. A frase fixa diz que não deu para confirmar o tempo. Não se inventa um símbolo.

**Caminho automático** (vagas que a IA vê, montagem da proposta, clique no botão): hora que não serve ou que não se conseguiu confirmar não é oferecida. No clique (DEC-061) a mesma função corre outra vez. Se falhar, a proposta falha fechada: não nasce compromisso nem cobrança, e a cliente recebe a frase fixa. Não se usa a frase «Horário já não está livre», que continua a ser a de ocupação.

**Marcação manual.** A atendente pode escolher a hora. O painel mostra o aviso e a confirmação segue. Reagendar à mão é este caminho.

**Já marcado.** Mudança de tempo não cancela o compromisso. Não há varredura que o apague.

**IA.** Recebe horários já filtrados e, se precisar explicar uma hora pedida que caiu, a frase fixa do motivo. Não recebe o payload do provedor, nem percentagem, nem códigos. Não escolhe céu nem temperatura. Não grava o bloco.

---

## Fora deste épico

Audiência, sala, capacidade, modo de atendimento e mesmo sexo (DEC-075). Registo genérico de restrições. Sexo ou preferência na ficha. Percentagem de chuva na interface, no WhatsApp ou na sugestão. A cliente ou a IA configurarem o bloco. Cancelar ou remarcar sozinho porque a previsão mudou. Local da cliente. Página nova de configuração. Escolher o provedor de previsão nesta documentação (fica na S4, como detalhe do adaptador).

---

## Ordem

S1 → S2 → S3 → S4 → S5 → S6 → S7. Cada fatia é verificável sozinha com uma clínica fictícia. S1 não muda os horários que a agenda já oferece. S4 não liga o filtro às vagas: isso é S5. Até S5, um serviço com Sol continua a oferecer a grade de hoje.

---

## S1 — Decisão e migração que preserva o atual

**Comportamento.** O desenho fica em DEC-077. A migração grava «Tanto faz» em céu e temperatura, sem X, e local nenhum. Serviços e compromissos já gravados não mudam de horário. Nomes como «Bronzeamento» não ligam Sol.

**Regras.** Não inferir o bloco pelo nome do serviço. Não preencher a cidade a partir de `clinic_address`. Não apagar audiência nem capacidade (DEC-075).

**Dados por tenant.** No SQLite da clínica, na migração seguinte à versão 31 (conferir `CLINIC_SCHEMA_VERSION` na `main` ao implementar; em 29/10/2026 está em 31, `0031_service_audience`; não reutilizar esse número):

- No serviço: `tempo_ceu` `tanto_faz` | `sol` | `chuva`, padrão `tanto_faz`. `tempo_temperatura` `tanto_faz` | `acima` | `abaixo`, padrão `tanto_faz`. `tempo_celsius` inteiro nulo.
- Na clínica (`clinic_settings`): tipo de local `nenhum` | `cidade` | `coordenadas`, padrão `nenhum`; cidade nula; latitude e longitude nulas.
- Nada disto no contato, no compromisso nem no D1. O compromisso não guarda a previsão.

**Tempo real.** Nenhum evento novo. A migração não publica marcação.

**Critérios de aceite.** AC-61.

- [ ] «Bronzeamento» e «Depilação», já gravados, ficam com céu e temperatura em `tanto_faz` e sem graus.
- [ ] A clínica fica sem local de previsão. `clinic_address` não é copiado para esse local.
- [ ] A grade que `queryAvailability` devolve para esses serviços é a mesma de antes da migração.
- [ ] A tabela de contatos não ganha coluna de tempo. `audiencia` (DEC-075) permanece.

---

## S2 — Local da clínica

**Comportamento.** No início da Clínica (hub, M-15), a responsável grava o local uma vez: **Cidade** ou **Coordenadas**. Sem página nova. O bloco fica visível com as sugestões de IA ligadas ou desligadas. Sem este local, um serviço que saia de «Tanto faz» não tem caminho automático (a regra de falha fecha na S5; aqui só se grava e se lê o local).

**Regras.** Cidade é texto (exemplo fictício: «Campinas»). Coordenadas são latitude de −90 a 90 e longitude de −180 a 180. Os dois modos não ficam preenchidos ao mesmo tempo: gravar um limpa o outro. Texto vazio ou número fora do intervalo é recusado. Omitir o campo numa edição que não fala de local mantém o valor. A atendente não grava (DEC-042). O endereço livre do cartão de IA não muda e não serve de local.

**Dados por tenant.** Colunas da S1, escrita só com `clinic.config.write`. Outra clínica não lê esta linha.

**Tempo real.** A configuração não tem evento próprio hoje. Outra sessão da mesma clínica vê o local na leitura seguinte (REQ-041).

**Critérios de aceite.** AC-62.

- [ ] A responsável grava a cidade «Campinas». A ficha mostra Cidade e esse texto. Latitude e longitude ficam vazias.
- [ ] Trocar para coordenadas válidas apaga a cidade. Valor 91 na latitude é recusado e o local anterior permanece.
- [ ] A atendente, na mesma clínica, não grava o local (a API recusa).
- [ ] Com as sugestões de IA desligadas, a responsável ainda vê e grava o local. `clinic_address` continua independente.

---

## S3 — Campos no serviço

**Comportamento.** No serviço (M-16), a responsável vê o bloco **Tempo**: céu e temperatura, como em [ux-ui.md](../product/ux-ui.md). Os dois em Tanto faz são o estado vazio («Sem restrição de tempo»). X só aparece em Acima de ou Abaixo de, e é obrigatório aí. A atendente não edita. A agenda ainda não filtra: isso é S5.

**Regras.** Valor fora das listas é recusado. Acima e Abaixo juntos são recusados. Grau não inteiro, vazio ou ausente com Acima/Abaixo é recusado. Voltar a Tanto faz limpa X. Omitir o bloco numa edição mantém o que já estava. Não ler o nome «Bronzeamento» para preencher Sol. Não escrever previsão no compromisso.

**Dados por tenant.** Colunas da S1, escrita só com `clinic.config.write`. O catálogo que a IA recebe **não** ganha céu nem temperatura: a IA não escolhe o tempo (S7).

**Tempo real.** Igual à S2: a outra sessão lê o serviço de novo. Sem evento novo.

**Critérios de aceite.** AC-63.

- [ ] Criar «Depilação» sem tocar no bloco grava céu e temperatura `tanto_faz` e graus nulos. A ficha diz «Sem restrição de tempo».
- [ ] A responsável grava «Bronzeamento» com Sol e Acima de 24. Os dois ficam gravados. A ficha não mostra percentagem.
- [ ] Acima de sem grau, ou com 24,5, é recusado. Pedir Acima e Abaixo no mesmo serviço é recusado.
- [ ] Voltar a temperatura para Tanto faz apaga o 24. O céu Sol permanece.
- [ ] A atendente não grava o bloco (a API recusa). O payload de catálogo da IA não traz `tempo_ceu` nem graus.

---

## S4 — Adaptador e avaliador

**Comportamento.** Uma função avalia o serviço numa hora de início. Entrada: restrição do serviço, fuso, local, instante de início. Saída: serve, não serve (céu, temperatura ou os dois) ou indisponível (sem local, sem previsão, símbolo desconhecido, erro ou tempo esgotado). Não oferece horário e não confirma nada: quem chama é a S5 e a S6.

O adaptador fala com o provedor e devolve só símbolo de céu e temperatura inteira, ou falha. A spec técnica do adaptador, nesse PR, regista o provedor, o mapa dos códigos para os símbolos desta decisão, o corte quando só houver percentagem, como um decimal vira inteiro e qual amostra horária contém o início no fuso da clínica. Esse corte não aparece na interface nem nesta decisão.

**Regras.**

- Sol serve com céu limpo, pouco nublado ou parcialmente nublado, sem chuva. Não serve com muito nublado, encoberto, garoa, chuva, trovoada ou nevoeiro.
- Chuva serve com chuva, garoa ou trovoada.
- Acima de 24 não serve com 24 nem com menos. Abaixo de 18 não serve com 18 nem com mais.
- Tanto faz nos dois não chama o provedor e devolve serve.
- Sem local, com local que o adaptador não resolve, ou com falha de leitura: indisponível. Não se escolhe o símbolo mais próximo.
- O corpo da resposta do provedor não é gravado no SQLite da clínica nem devolvido a quem chamou. A função devolve o resultado, não o payload.
- Clínica B não usa o local da clínica A.

**Dados por tenant.** Nenhum dado novo. Leitura do serviço e do local no SQLite da clínica.

**Tempo real.** Nenhum.

**Critérios de aceite.** AC-64.

- [ ] Teste com previsão fictícia, sem rede: céu limpo sem chuva e 25 °C serve a Sol e a Acima de 24. 24 °C não serve a Acima de 24. Céu encoberto não serve a Sol. Garoa serve a Chuva e não serve a Sol.
- [ ] Nevoeiro não serve a Sol nem a Chuva. Trovoada serve a Chuva.
- [ ] Muito nublado sem chuva não serve a Sol.
- [ ] Serviço em Tanto faz / Tanto faz devolve serve sem chamada ao adaptador.
- [ ] Sem local, erro do adaptador, símbolo desconhecido ou percentagem que o adaptador não mapeia: indisponível. O teste não vê o corpo do provedor na saída.
- [ ] A spec do adaptador (comentário ou nota junto do código dessa fatia) contém o corte numérico. Nenhuma frase de [ux-ui.md](../product/ux-ui.md) contém percentagem.

---

## S5 — Filtro na disponibilidade, proposta e revalidação do botão

**Comportamento.** O caminho automático usa a função da S4. Hora que não serve ou está indisponível não entra nas vagas da IA nem numa proposta nova. A grade da equipe (TEL-05) continua a mostrar a hora, com aviso: isso é a S6. No clique do botão, a mesma função corre outra vez dentro da revalidação que já existe. Se não servir ou estiver indisponível, a proposta falha fechada, com a frase de [ux-ui.md](../product/ux-ui.md), e não nasce compromisso nem Pix.

**Regras.**

- `queryAvailability` ganha um modo. O modo automático (IA, criar proposta, clique) omite a hora. O modo da equipe devolve a hora e o aviso, para a S6. O modo automático é o padrão, para quem já chama a função não passar a oferecer hora que não serve.
- O clique não reutiliza a leitura feita ao montar a proposta. Corre de novo.
- Falha de tempo não usa o texto de horário ocupado (`slot_refused` de ocupação permanece para sala, profissional e capacidade).
- Serviço em Tanto faz não muda a lista.
- Serviço com restrição e sem local: o automático não oferece hora nenhuma desse serviço. Depilação em Tanto faz, na mesma clínica, oferece como hoje.
- Sinal (DEC-047): a recusa de tempo acontece antes da cobrança. Nada fica reservado.
- Texto livre continua sem marcar (DEC-061).

**Dados por tenant.** Nenhum. A proposta não guarda payload. Isolado por `tenant_id`.

**Tempo real.** Sem canal novo. A lista automática da outra sessão muda na leitura seguinte e nos eventos de agenda que já existem (DEC-057, REQ-041). Não se empurra previsão para o WhatsApp da cliente como número.

**Critérios de aceite.** AC-65.

- [ ] Bronzeamento com Sol e Acima de 24, local em Campinas, previsão fictícia de céu limpo e 25 °C às 15h: a vaga automática inclui 15h. Com 22 °C ou céu encoberto, 15h sai da lista automática e não nasce proposta para as 15h.
- [ ] A mesma hora, no modo da equipe, continua na resposta, com aviso (o texto visível é a S6).
- [ ] Proposta criada com tempo que servia. No clique, a função devolve não serve ou indisponível: nenhum compromisso, nenhuma cobrança, frase «Nesse horário o tempo não serve para este serviço. A equipe envia outra opção em breve.» ou «Não deu para confirmar o tempo nesse horário. A equipe envia outra opção em breve.». A frase não diz percentagem nem número de vagas.
- [ ] Clique com horário ocupado de verdade continua «Horário já não está livre…», distinto da frase de tempo.
- [ ] Depilação em Tanto faz, sem local na clínica, continua a oferecer horários.
- [ ] Bronzeamento com Sol e clínica sem local: a lista automática desse serviço vem vazia.

---

## S6 — Aviso na marcação manual

**Comportamento.** No Agendar (TEL-05, no celular e no painel ao lado da conversa, DEC-074), a hora que não serve ou que não se confirmou continua selecionável. O aviso de [ux-ui.md](../product/ux-ui.md) aparece ao escolher a hora e outra vez na revisão. **Revisar e confirmar** grava o compromisso. O servidor devolve o mesmo aviso e não recusa.

**Regras.**

- Sol não cumprido: «Sol fraco neste horário».
- Chuva não cumprida: «Sem chuva neste horário».
- Acima de X não cumprido: «Abaixo de X °C neste horário», com o X gravado (exemplo: «Abaixo de 24 °C neste horário»).
- Abaixo de X não cumprido: «Acima de X °C neste horário».
- Sem local ou sem previsão: «Não deu para confirmar o tempo». Esta frase substitui as outras: não se diz «Sol fraco» quando não houve leitura.
- Céu e temperatura a falhar juntos: as duas frases de não cumprimento, e a confirmação segue.
- Reagendar à mão usa este aviso. O compromisso antigo permanece até o novo ser confirmado (TEL-06).
- A confirmação manual não chama o caminho de falha fechada da S5.

**Dados por tenant.** O compromisso não ganha coluna de previsão. O aviso não é histórico.

**Tempo real.** Confirmar reutiliza `appointment.confirmed`. A outra sessão da clínica vê o compromisso. Não vê um evento de previsão.

**Critérios de aceite.** AC-66.

- [ ] Na grade da equipe, 15h de bronzeamento com sol fraco aparece, com «Sol fraco neste horário». Confirmar cria o compromisso. A resposta da API traz o aviso.
- [ ] Sem previsão, o aviso é «Não deu para confirmar o tempo» e o compromisso também é criado.
- [ ] Sol e temperatura a falhar: as duas frases, um compromisso.
- [ ] O mesmo confirmar, feito pelo clique da proposta, não cria compromisso (S5). Os dois caminhos chamam a função da S4.
- [ ] Um compromisso já confirmado permanece se, noutro teste, a previsão fictícia dessa hora passar a não servir. Nada o cancela sozinho.

---

## S7 — Contexto da IA

**Comportamento.** `freeSlots` só tem horas que o modo automático devolveu. Se a interpretação pede uma hora que a função recusou, o contexto leva a frase fixa do motivo (a do WhatsApp, não o aviso interno da equipe) e não leva o payload. A sugestão pode repetir essa frase. Não cita percentagem, código de símbolo nem uma hora que a lista não tenha. A IA não preenche céu nem temperatura.

**Regras.** O catálogo continua sem o bloco Tempo. Telefone, anexos e dados de outra clínica continuam de fora (DEC-011, REQ-072). O modelo não redige a recusa da proposta: o texto do clique é o de `renderProposalResultBody`, estendido na S5.

**Dados por tenant.** Nenhum dado novo de pessoa. A frase é calculada na clínica da sessão.

**Tempo real.** Nenhum.

**Critérios de aceite.** AC-67.

- [ ] Inspecionando o pedido ao modelo num teste: as horas de bronzeamento são só as que serviram; não há JSON do provedor, percentagem nem `tempo_ceu`.
- [ ] Hora pedida que não serviu: o contexto tem a frase fixa e não tem essa hora em `freeSlots`.
- [ ] Rascunho que cita «40%» de chuva ou uma hora filtrada não chega à atendente como sugestão utilizável.
- [ ] Depilação em Tanto faz não acrescenta frase de tempo.
- [ ] Texto livre não marca (DEC-061).

---

## Casos de aceite do épico

Serviços fictícios. Os três têm de passar com S2 a S7 feitas. Não substituem os critérios de cada fatia.

### 1. Bronzeamento com sol e calor

Serviço «Bronzeamento», Sol e Acima de 24 °C. Clínica com cidade. Às 15h, céu limpo e 25 °C: a proposta pode oferecer 15h. Céu encoberto ou 24 °C: a proposta não oferece, o clique falha fechado se a proposta já existia, e a atendente ainda marca à mão com «Sol fraco neste horário» ou «Abaixo de 24 °C neste horário».

### 2. Serviço que precisa de chuva ou de frio

«Banho de chuva» fictício só com Chuva, temperatura em Tanto faz. Hora com garoa entra no automático. Hora de céu limpo não entra; à mão, «Sem chuva neste horário», e a confirmação segue. Outro serviço, só Abaixo de 18 °C, ignora o céu.

### 3. Depilação e falha de leitura

«Depilação» permanece em Tanto faz e oferece horários mesmo sem local e mesmo com o adaptador em erro. «Bronzeamento» com Sol, sem local ou com o adaptador em erro, não oferece horário automático; a frase é «Não deu para confirmar o tempo». Um bronzeamento já marcado às 15h continua marcado quando a previsão muda.

---

## O que este épico não fecha

Qual provedor de previsão e o corte numérico (spec do adaptador, na S4). Valores reais da clínica piloto. Revisão jurídica antes de dados reais (GATE-04). Implementação: PRs seguintes, um por fatia. Este PR não contém migração, ecrã nem chamada a provedor.

**Aceite por fatia:** S1 AC-61; S2 AC-62 (REQ-089); S3 AC-63 (REQ-090); S4 AC-64 (REQ-091); S5 AC-65 (REQ-092); S6 AC-66 (REQ-092); S7 AC-67 (REQ-093). Jornadas: JRN-03, JRN-08, JRN-17.
