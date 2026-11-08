# Copy: atos de diálogo determinísticos (M4 / #414)

**Estado:** **Confirmado** (Paulo, 02/11/2026). **Leva 1** (DEC-122): 15 atos e 41 redações, na versão corrigida. **Leva 2** (DEC-123): 17 atos e 32 redações, mais 1 redação num ato da leva 1, na versão revista de 02/11/2026. A **leva 3** está decidida: pedido para outra pessoa (DEC-124), pausa da owner/envio falhado/sinal Pix (DEC-125) e remarcação (DEC-129). As frases já fixadas por DEC (DEC-083, DEC-077, DEC-086, DEC-107, DEC-113–115, DEC-130) **não** mudam aqui. Qualquer frase nova ou alterada exige aprovação no PR (DEC-104).

**Técnicas (núcleo §3.5):** eco do entendido; 3–5 redações por ato, escolhidas por hash estável da conversa; primeiro nome só no 1.º contacto; uma pergunta por mensagem; plural do tipo em minúsculas; sem jargão INV-05.

## Alterações de 02/11/2026 (pedido do Paulo: «A, aplica as correções»)

Defeitos corrigidos (impediam a aprovação):

| Ato | Antes | Depois |
| --- | --- | --- |
| `sem_vaga_alternativas` n.º 2 | `As {hora} já estão ocupadas. Posso {lista}.` (sem crase, «Posso» errado) | `Às {hora} já está ocupado. Tenho {lista}. Qual fica melhor?` |
| `informar_quem_faz` n.º 2 | `{pessoas} fazem esse atendimento.` («Ana fazem») | `Esse atendimento é feito por {pessoas}.` |
| `abrir` n.º 1 | `Sou a assistente da clínica.` (género fixo; a persona pode ser masculina, DEC-089) | `Aqui é o atendimento virtual da clínica.` |
| `informar_local` | nenhuma redação levava o link do Google Business (DEC-120) | novo ato `informar_local_link` (endereço + `Para chegar: {link}`), usado quando há link |

Melhorias aplicadas:

- `perguntar_linha` n.º 1: sem o formato de formulário («{serviço}: …»).
- `perguntar_variantes` n.º 2: sem o imperativo seco («Me diga as {tipo}…»).
- `acolher_adiamento` n.º 3: «Combinado.» saiu (lê-se como confirmação de horário).
- **Eco**: nova redação em `perguntar_variantes` e em `oferecer_horarios` («Perfeito, {assunto}. …»), que a técnica prometia e nenhum ato fazia.

Ficam por escrever (segunda leva, a aprovar depois): perguntar o dia, perguntar o horário, perguntar o serviço, recusar a mistura masculino/feminino, serviço inexistente e vários serviços. Sem estes atos a [#448](https://github.com/intentzero/tredane/issues/448) não consegue retirar todas as frases literais do código.

## Atos e redações propostas

Placeholders: `{nome}`, `{serviço}`, `{tipo}`, `{assunto}`, `{quando}`, `{lista}`, `{hora}`, `{preço}`, `{duração}`, `{endereço}`, `{link}`, `{abertura}`, `{pessoas}`, `{explicação}`.

**Regra de seleção:** uma redação só é usada se todas as suas variáveis estiverem preenchidas (o eco `{assunto}` e o `{link}` ficam de fora quando faltam). Nunca sai uma frase com buraco.

### abrir

1. `Oi{, nome}! Aqui é o atendimento virtual da clínica. Quer agendar algum serviço?`
2. `Oi{, nome}! Em que posso ajudar — marcar um horário ou tirar uma dúvida?`
3. `Oi{, nome}! Posso te ajudar a marcar ou a ver preços e horários.`

### perguntar_linha

1. `Para {serviço}, prefere a opção feminina ou masculina?`
2. `Para {serviço}, é na versão feminina ou masculina?`
3. `Claro. {serviço} feminina ou masculina?`

### perguntar_variantes

1. `Quais {tipo}? Temos {lista}. Pode ser mais de uma.`
2. `Quais {tipo} você quer? {lista}. Pode ser mais de uma.`
3. `Para {serviço}, quais {tipo}? {lista}.`
4. `Perfeito, {assunto}. Quais {tipo}? Temos {lista}. Pode ser mais de uma.`

**Nota DEC-145 (modo `uma`):** o catálogo M4 permanece plural (máx. 5 redações). Em modo `uma` o código usa a pergunta singular directa `Para {serviço}, qual {tipo} você quer? Temos {lista}.` (e com hora: `Para fechar às {hora}, qual {tipo} você quer? Temos {lista}.`), sem «Pode ser mais de uma». Ato dedicado no catálogo fica fora deste corte.

### oferecer_horarios

1. `Para {assunto}, {quando}tenho {lista}. Qual fica melhor?`
2. `Os próximos horários para {assunto} são {lista}. Algum serve?`
3. `Tenho {lista} para {assunto}. Qual prefere?`
4. `Perfeito, {assunto}. Os próximos horários são {lista}. Algum serve?`
5. `Os horários disponíveis para {dia} são {lista}. Algum serve?` — **Confirmado** (Paulo, 08/11/2026): só quando a cliente já pediu o dia/weekday e a oferta ficou nesse dia; sem «próximos… para {serviço}». `{dia}` = `hoje` / `amanhã` / `quarta 11/11`; `{lista}` = só as horas.

### sem_vaga_alternativas

1. `Nesse horário das {hora} já não tenho vaga. Tenho {lista}. Qual fica melhor?`
2. `Às {hora} já está ocupado. Tenho {lista}. Qual fica melhor?`
3. `Nesse horário das {hora} já não tenho vaga e o dia está cheio nesse período. No próximo com vaga tenho {lista}. Qual fica melhor?`

### informar_preco

1. `{preço}, {duração} min. Quer que eu veja horários?`
2. `Fica {preço} e dura {duração} min. Quer ver horários?`
3. `O valor é {preço} ({duração} min). Posso te mostrar horários?`

### informar_preco_sem_cadastro

1. `A equipe confirma o valor.`

### informar_duracao

1. `{duração} min.`
2. `A sessão dura {duração} min.`

### informar_expediente

1. `Funcionamos assim:\n{lista}`
2. `Nosso horário:\n{lista}`
3. `Abrimos assim:\n{lista}`

### informar_local

1. `Ficamos em {endereço}.`
2. `O endereço é {endereço}.`
3. `Estamos em {endereço}.`

### informar_local_link

1. `Ficamos em {endereço}. Para chegar: {link}`
2. `O endereço é {endereço}. Para chegar: {link}`

### informar_quem_faz

1. `Quem atende: {pessoas}.`
2. `Esse atendimento é feito por {pessoas}.`
3. `Nesse serviço, quem atende é {pessoas}.`

### informar_explicacao

1. `{explicação}`
2. `Sobre isso: {explicação}`

### acolher_adiamento

1. `Sem problema. Quando quiser, é só chamar.`
2. `Tudo bem! Fico por aqui quando você decidir.`
3. `Fica à vontade. Qualquer coisa, me chama.`

### Hint mid-funnel (DEC-152 — Confirmado, Paulo 08/11/2026)

Frase fixa one-shot (não é acto do catálogo M4): `Se quiser parar, diga terminar.` Acrescentada ao fim do corpo quando a sessão de marcação já está aberta e o turno não avança o quadro. Não na oferta permanente de slots (P5 adiado).

### esclarecer

1. `Pode me dizer de outro jeito, ou prefere falar com a equipe?`
2. `Não peguei bem — prefere reformular ou chamar a equipe?`

### fallback (DEC-107 — **Confirmado**, não alterar)

1. `Não consegui entender bem. Pode me dizer de outro jeito, ou prefere falar com a equipe?`

## Leva 2: funil de marcação (**Confirmada**, DEC-123)

**Estado:** **Confirmado** (Paulo, 02/11/2026, DEC-123), depois de ler a leva e de ver a revisão dos cinco defeitos abaixo. Ainda **não está ligada a nenhum fluxo**: isso é a [#448](https://github.com/intentzero/tredane/issues/448). Cobre as frases do funil de marcação que o código escrevia à mão (inventário abaixo).

**Como ler:** *(atual)* = o texto que o código já envia hoje, sem alterações; só precisa de um olhar rápido. *(novo)* = redação nova; é nestas que deves parar. Onde o texto atual tinha defeito, aparece em «Substitui».

**Variáveis novas:** `{variante}`, `{período}` («de manhã», «à tarde», «à noite»), `{hora24}` e `{dia}`. O fluxo passa `{dia}` **já com a preposição** («na sexta (06/11)», «no sábado (07/11)», «hoje», «amanhã»), para a frase nunca dizer «em sexta».

**Revisão antes da tua decisão (02/11/2026).** Ao reler a leva encontrei cinco defeitos meus e corrigi-os: (1) uma frase começava em minúscula quando abria por uma variável («de manhã não tenho…»), e agora **toda** a frase começa em maiúscula; (2) «em sexta 06/11» → a preposição vem no `{dia}`; (3) «Às 1 da tarde» sem crase → `Você quis dizer {hora24}, à tarde?`; (4) «Juntas» fixava o género → «No total»; (5) «o que a clínica oferece» → «o que oferecemos».

### Redação nova num ato já aprovado

- `perguntar_variantes` *(novo)*: `Para fechar às {hora}, quais {tipo}? Temos {lista}. Pode ser mais de uma.` — substitui o texto atual `Para fechar às {hora}, me diga as {tipo}: {lista}. Pode ser mais de uma.` (imperativo seco).

### perguntar_dia

1. *(novo)* `Para {serviço}, qual dia fica melhor?`
2. *(novo)* `Qual dia você prefere para {serviço}?`

Substitui: `Me diga o dia para {serviço}.`.

### perguntar_horario

1. *(atual)* `Qual horário fica melhor para {serviço}?`
2. *(novo)* `Para {serviço}, qual horário você prefere?`

### perguntar_servico

1. *(atual)* `Qual serviço você quer? Temos {lista}.`
2. *(novo)* `Claro! Qual serviço? Temos {lista}.`
3. *(atual)* `Qual serviço você gostaria de agendar?`

### confirmar_servico

1. *(atual)* `É {serviço} que você quer agendar?`
2. *(novo)* `Seria {serviço}?`

### confirmar_hora_ambigua

1. *(novo)* `Você quis dizer {hora24}, à tarde?`

Substitui: `Às {hora} da tarde seria {hora24}. É esse horário?` (dava «Às 1 da tarde», sem a crase).

### sem_horario_periodo

1. *(atual)* `Para {assunto}, {período} não tenho horário livre. Quer ver outro período?`
2. *(novo)* `{período} não tenho nada livre para {assunto}. Prefere outro período?`

### sem_horario_dia

1. *(novo)* `Para {assunto}, {dia} não tenho horário livre. Quer ver outro dia?`
2. *(novo)* `Não tenho horário livre para {assunto} {dia}. Prefere outro dia?`

Substitui: `Para {assunto}, em {dia} não tenho horário livre…` (dava «em sexta 06/11»); agora o fluxo passa `{dia}` já com a preposição («na sexta (06/11)», «amanhã»).

### sem_horario_semana

1. *(atual)* `Para {assunto}, no momento não tenho horário livre. Quer que eu veja outra data?`
2. *(novo)* `No momento não tenho horário livre para {assunto}. Quer que eu veja outra data?`

### sem_vaga_sem_alternativa

1. *(atual)* `Nesse horário das {hora} já não tenho vaga. Quer que eu veja outro horário?`
2. *(novo)* `Às {hora} já está ocupado e não tenho outra opção nesse dia. Quer que eu veja outro dia?`

### informar_preco_variante

1. *(atual)* `{variante} custa {preço} e dura {duração} min.`
2. *(novo)* `Para {variante}, o valor é {preço} e a duração, {duração} min.`

### informar_preco_soma

1. *(novo)* `No total, ficam {preço} e {duração} min de atendimento.`
2. *(novo)* `Somando tudo, ficam {preço} e {duração} min de atendimento.`

Substitui: `Juntas, ficam {preço} e {duração} min de atendimento.` («Juntas» fixa o feminino, mas o tipo da variante é texto livre, DEC-079).

### informar_preco_tabela

Tabela de preços do serviço já aberto (ex. «Quanto custa?» / «valores» a meio da pergunta de zonas). `{lista}` é uma linha por variante (`Nome — R$ … (N min)`); `{pergunta}` reabre a escolha sem repetir só os nomes.

1. `Para {serviço}:\n{lista}\n{pergunta}`
2. `Valores de {serviço}:\n{lista}\n{pergunta}`
3. `Para {serviço} temos:\n{lista}\n{pergunta}`

### recusar_mistura

1. *(novo)* `Não dá para juntar masculino e feminino na mesma visita. Quer escolher só um dos dois?`
2. *(novo)* `Masculino e feminino não entram na mesma visita. Qual dos dois prefere?`

Substitui: `Masculino e feminino não entram na mesma visita. Escolha um conjunto compatível — opções que sirvam para os dois também valem.` e a variante com «ambos» do funil de zonas.

### servico_inexistente

1. *(provisória, DEC-151)* `Não entendi bem esse pedido. Quer ver as opções que temos?`
2. *(provisória, DEC-151)* `Não entendi esse pedido por aqui. Quer ver as opções que temos?`

**Confirmado (DEC-151, Paulo 08/11/2026):** o tom admite mal-entendido (não cumprimento «Olá!…» do hub). Frases acima são **provisórias** até Paulo fechar o wording exacto; alternativas no PR.

**#512 / prática 10:** quando o catálogo não casa, o backend (1) substitui o dêitico «esse pedido» / «esse procedimento» / «Esse serviço» pelo termo pedido entre aspas (eco factual, sem frase de marketing nova — DEC-104) e (2) acrescenta `perguntar_servico` com `{lista}` real da clínica. O link Google só sai em `informar_local*`.

### varios_servicos

1. *(atual)* `Neste momento marcamos um serviço de cada vez. Qual você quer primeiro?`
2. *(novo)* `Marcamos um serviço de cada vez. Por qual quer começar?`

### historico_indisponivel

1. *(atual)* `Não tenho o detalhe da sua visita anterior aqui. Qual serviço você quer agora?`
2. *(novo)* `Não consegui ver a sua visita anterior por aqui. Qual serviço você quer agora?`

### catalogo_mudou

1. *(atual)* `Nossas opções mudaram. Pode dizer de novo qual serviço e opção você quer?`

### nao_consegui_fechar

1. *(atual)* `Não consegui fechar {serviço} às {hora} agora. A equipe confirma em seguida.`

### Ainda fora (leva 3, a escrever e a aprovar)

Estas frases literais continuam no código e **não** estão nesta leva:

| Fluxo | Frase atual | Porque fica de fora |
| --- | --- | --- |
| Remarcação (DEC-091) | **Decidido (DEC-129, Paulo, 02/11/2026)**, seis frases fixas sem marcador e sem nome: (1) `Claro, vamos remarcar. Para qual dia você prefere?`; (2) `Na {dia} tenho {horas}. Algum serve para remarcar?`; (3) `Na {dia} não tenho horário livre. Quer ver outro dia?`; (4) `Às {hora} na {dia} já não tenho vaga. Tenho {alternativas}. Qual fica melhor?`; (5) `Não consegui enviar a confirmação da remarcação para {dia} às {hora}. Ainda não está remarcado: a equipe vai te responder em seguida.`; (6) `Recebi seu pedido de remarcar {serviço} para {dia} às {hora}. Ainda não está remarcado: a equipe confirma e já te retorna.`; (6b, DEC-131) quando o nome do serviço tem termo proibido: `Recebi seu pedido de remarcar. Ainda não está remarcado: a equipe confirma e já te retorna.` | O marcador «Para remarcar o mesmo atendimento» (CF-22) sai: a deteção passa a ler `phase = remarcando` do frame (M2). `{dia}` leva a preposição |
| Pausa da owner / envio da proposta falhou | **Decidido (DEC-125, Paulo, 02/11/2026)**, três frases fixas, sem nome e sem «Anotei»/«Quase lá»: (1) sinal Pix: `Para garantir {serviço} {dia} às {hora}, a clínica pede um sinal de {valor} por Pix. O horário só fica reservado depois do pagamento, e o Pix chega aqui na conversa.` (sem valor, omite «de {valor}»); (2) pausa da owner: `Recebi seu pedido de {serviço} {dia} às {hora}. Ainda não está marcado: a equipe confirma o horário e já te retorna.`; (3) envio falhado: `Não consegui enviar a confirmação de {serviço} {dia} às {hora}. Ainda não está marcado: a equipe vai te responder em seguida.` | `{dia}` leva a preposição («na sexta (06/11)»). Implementação em `autobook.ts` (3 pontos) com teste de que nenhuma afirma reserva (DEC-061) |
| Pedido para outra pessoa | **Decidido (DEC-124, Paulo, 02/11/2026):** usa só a frase da DEC-083, «Vou pedir para a equipe continuar daqui.», com as regras dela (uma vez enquanto o alerta seguir aberto, sem modelo; DEC-113 fora do expediente). A frase própria `Para agendar para outra pessoa, a equipe precisa continuar este atendimento.` **não** entra no catálogo | Duplicava a frase de handoff da DEC-083. Sem ato novo |

## Fora deste pedido

- Persona com nome próprio (DEC-089) — Paulo **não** pediu na It. 1.
- Listas/botões WhatsApp (#415 / M5).
- Retirar o texto livre do LLM do funil: só depois destas frases aprovadas e do validador único ligado.

## Como aprovar

O Paulo aprovou a leva 1 (DEC-122) e a leva 2 (DEC-123) a 02/11/2026. Para a leva 3, o processo é o mesmo: o PR traz a secção «Copy para aprovação do Paulo»; a aprovação fica registada numa DEC nova; só depois a engenharia liga as redações aos fluxos (#448).

## Copy #511 (validade visível / Confirmar expirado) — Confirmado

**Estado:** **Confirmado** (Paulo, DEC-104, 03/11/2026, ok no [#523](https://github.com/intentzero/tredane/pull/523)). Relógio da clínica; sem fuso IANA.

**Nota (06/11/2026, Paulo — Confirmado):** tirou o rodapé `Esta lista vale por 24 horas.` da oferta de horários; a lista fica só com as horas. A validade de 24 h do `pending` / `lastOffer` no backend (DEC-127) mantém-se; não se reabre a DEC-127. A validade da proposta (`Válida até {hora}.`) e o Confirmar não mudam.

| Onde | Texto confirmado |
| --- | --- |
| Rodapé da lista Horários | *(removido 06/11/2026 — ver nota acima; antes: `Esta lista vale por 24 horas.`)* |
| Cartão da proposta (30 min após o envio) | `Válida até {hora}.` |
| Confirmar depois da validade, com alternativas | `Essa proposta já não está válida. Para {serviço}, tenho {lista}. Qual fica melhor?` |
| Confirmar depois da validade, sem alternativas | `Essa proposta de {serviço} em {quando} já não está válida. Quer que eu veja outros horários?` |
| Horário já ocupado no Confirmar, com alternativas | `Horário já não está livre para {serviço} em {quando}. Tenho {lista}. Qual fica melhor?` |
| Horário já ocupado no Confirmar, sem alternativas | `Horário já não está livre para {serviço} em {quando}. Quer que eu veja outro horário?` |

`{lista}` no formato da oferta (`sexta 06/11 às 14:00, 16:00`). `{hora}` = `HH:MM` no relógio da clínica.

## Rótulos fixos do M5 (listas e botões) — Confirmado

**Estado:** os cinco rótulos fixos estão **Confirmados** (Paulo, 03/11/2026, DEC-134). Entraram no código com o #479 (M5). A DEC-133 (revisão 03/11/2026) liga as escolhas interativas de forma permanente — sem flag de ambiente — por isso Feminina, Masculina, Opções, Todas e Horários chegam à cliente no funil. O corte em 24 caracteres no título da linha está **Confirmado** (opção A: truncar; nome completo na descrição quando disponível). O texto da pergunta que acompanha a lista ou os botões é o das levas 1 e 2 (já aprovado); só mudam os rótulos abaixo.

| Onde | Rótulo proposto | Limite Meta (a confirmar na documentação vigente) | Observação |
| --- | --- | --- | --- |
| Botão da pergunta da linha | `Feminina` | título ≤ 20 | usa a palavra do cadastro das variantes |
| Botão da pergunta da linha | `Masculina` | título ≤ 20 | idem |
| Lista de variantes: botão que abre a lista | `Opções` | ≤ 20 | o tipo da variante (zona, área…) é texto livre da owner; `Opções` é neutro |
| Lista de variantes: linha que escolhe tudo | `Todas` | linha ≤ 24 | |
| Lista de horários: botão que abre a lista | `Horários` | ≤ 20 | |
| Eco das zonas no texto livre (DEC-137) | `Entendi: Axila e Pernas. Certo?` | — | nomes do catálogo; duas zonas «A e B»; três ou mais «A, B e C» |
| Botão do eco | `Sim` | título ≤ 20 | confirma o conjunto e só então abre Horários; não marca (DEC-061) |
| Botão do eco | `Corrigir` | título ≤ 20 | volta à pergunta das zonas (Opções + texto livre) |
| Zona citada sem match (#509 / prática 1) — **Confirmado** (Paulo 07/11/2026) | `Não encontrei {palavra} nas opções. Quer {lista}?` | — | `{palavra}` = token que sobrou; `{lista}` = nomes do âmbito (linha travada). Sem «ou outra?» — a lista já tem todas as variantes. Sem acto no catálogo; frase fixa em `zoneNotFoundAskReply` (DEC-104). |
| Lista de horários: título de cada linha | dinâmico, `terça 03/11 17:00` | linha ≤ 24 | dia da semana + `DD/MM` + hora (DEC-138 / #507), relógio da clínica, sem fuso IANA e sem mês-dia. Se o título cortar, a descrição leva o texto completo (DEC-134 opção A). O toque usa o id `YYYY-MM-DDTHH:MM`, não o título |
| Lista de variantes: título de cada linha | dinâmico, o nome da variante | linha ≤ 24 | cortado em 24 caracteres; um nome longo pode perder o fim |

**Confirmado (corte, Paulo 03/11/2026, opção A / DEC-134):** aceitar o truncamento Meta em 24 caracteres no título da linha; nome completo na descrição quando disponível.

## Consulta de catálogo (DEC-142) — Confirmado (Paulo, 06/11/2026)

**Estado:** **Confirmado** (Paulo, chat de 06/11/2026, America/Sao_Paulo). Wording fechado neste chat. Uma redação por frase (DEC-104): o modelo não escreve esta lista nem escolhe o serviço. Exemplos de nomes abaixo são fictícios.

À cliente, só «feminino» e «masculino». Este fluxo não diz «linha», «versão» nem «para mulher/homem». No código e na DEC o campo continua audience / audiência.

Não marca. Não mexe no Confirmar da proposta (DEC-061).

| Onde | Texto confirmado |
| --- | --- |
| Corpo da lista, quando a audiência ainda não está nesta conversa | `Feminino ou masculino?` |
| Botão que abre essa lista (Cloud API, não é reply button nem título de linha) | `Escolher` |
| Linha da lista | `Feminino` |
| Linha da lista | `Masculino` |
| Audiência já conhecida e marcação a meio, feminino | `Continuo no feminino. Para ver o masculino, diga “serviços masculinos”.` |
| Audiência já conhecida e marcação a meio, masculino | `Continuo no masculino. Para ver o feminino, diga “serviços femininos”.` |
| Nomes, com audiência conhecida (um nome por linha, como no cadastro) | `Temos:\nDepilação\nLimpeza de pele profunda\nQual você quer?` |
| Filtro sem serviço ativo | `Não tenho serviços no feminino.` |
| Filtro sem serviço ativo | `Não tenho serviços no masculino.` |

A frase «Continuo…» sai só quando a audiência já está na conversa e havia marcação a meio (serviço, variantes, oferta ou proposta). O toque na lista, a primeira lista de nomes e a troca («serviços masculinos» / «serviços femininos») não a repetem: mandam os nomes, ou a frase vazia, do lado escolhido.

`Depilação` e `Limpeza de pele profunda` no exemplo são nomes gravados, não minúsculas de frase corrida. Noutro catálogo, cada linha é o nome ativo cuja audiência é a da conversa ou qualquer. Sem nenhum, sai só a frase vazia — sem inventar serviço e sem link.

