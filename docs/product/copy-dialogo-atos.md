# Copy: atos de diálogo determinísticos (M4 / #414)

**Estado:** **Leva 1 Confirmada** (Paulo, 02/11/2026, DEC-122): 15 atos e 41 redações, na versão corrigida de 02/11/2026. **Leva 2 Proposta** (secção «Leva 2», funil de marcação): a aguardar aprovação do Paulo. As frases já fixadas por DEC (DEC-083, DEC-077, DEC-086, DEC-107, DEC-113–115) **não** mudam aqui. Qualquer frase nova ou alterada exige aprovação no PR (DEC-104).

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

### oferecer_horarios

1. `Para {assunto}, {quando}tenho {lista}. Qual fica melhor?`
2. `Os próximos horários para {assunto} são {lista}. Algum serve?`
3. `Tenho {lista} para {assunto}. Qual prefere?`
4. `Perfeito, {assunto}. Os próximos horários são {lista}. Algum serve?`

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

### esclarecer

1. `Pode me dizer de outro jeito, ou prefere falar com a equipe?`
2. `Não peguei bem — prefere reformular ou chamar a equipe?`

### fallback (DEC-107 — **Confirmado**, não alterar)

1. `Não consegui entender bem. Pode me dizer de outro jeito, ou prefere falar com a equipe?`

## Leva 2: funil de marcação (**Proposta**, a aprovar pelo Paulo)

**Estado:** **Proposto**. Não está aprovada nem ligada a nenhum fluxo. Cobre as frases do funil de marcação que o código ainda escreve à mão (inventário abaixo), para a [#448](https://github.com/intentzero/tredane/issues/448) as poder retirar.

**Como ler:** *(atual)* = o texto que o código já envia hoje, sem alterações; só precisa de um olhar rápido. *(novo)* = redação nova; é nestas que deves parar. Onde o texto atual tinha defeito, aparece em «Substitui».

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

1. *(atual)* `Às {hora} da tarde seria {hora24}. É esse horário?`

### sem_horario_periodo

1. *(atual)* `Para {assunto}, {período} não tenho horário livre. Quer ver outro período?`
2. *(novo)* `{período} não tenho nada livre para {assunto}. Prefere outro período?`

### sem_horario_dia

1. *(atual)* `Para {assunto}, em {dia} não tenho horário livre. Quer ver outro dia?`
2. *(novo)* `Em {dia} não tenho horário livre para {assunto}. Prefere outro dia?`

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

1. *(atual)* `Juntas, ficam {preço} e {duração} min de atendimento.`
2. *(novo)* `Somando tudo, ficam {preço} e {duração} min de atendimento.`

### recusar_mistura

1. *(novo)* `Não dá para juntar masculino e feminino na mesma visita. Quer escolher só um dos dois?`
2. *(novo)* `Masculino e feminino não entram na mesma visita. Qual dos dois prefere?`

Substitui: `Masculino e feminino não entram na mesma visita. Escolha um conjunto compatível — opções que sirvam para os dois também valem.` e a variante com «ambos» do funil de zonas.

### servico_inexistente

1. *(atual)* `Não encontrei esse procedimento por aqui. Quer ver as opções que temos?`
2. *(novo)* `Esse serviço eu não encontrei por aqui. Quer ver o que a clínica oferece?`

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
| Remarcação (DEC-091) | `Para remarcar o mesmo atendimento…`, `Quer ver outro dia?`, `Anotei o pedido de remarcar {serviço} para {dia} às {hora}. A equipe confirma em seguida.` | O texto «Para remarcar o mesmo atendimento» é um **marcador interno** que a lógica lê (CF-22). Mexer na frase exige antes um estado estruturado (M2, #412) |
| Pausa da owner / envio da proposta falhou | `Perfeito, {nome}! Para garantir {serviço} … a clínica pede um sinal por Pix …`, `Perfeito, {nome}! Anotei {serviço} … A equipe confirma o horário em seguida.`, `Quase lá, {nome}! Vou confirmar {serviço} … com a equipe e já te retorno.` | Estados raros; pedem decisão sobre «Anotei» e «Quase lá», que se podem ler como reserva |
| Pedido para outra pessoa | `Para agendar para outra pessoa, a equipe precisa continuar este atendimento.` | Provável duplicado da frase de handoff da DEC-083 («Vou pedir para a equipe continuar daqui.»). Convém usar uma só; decisão a tomar com a #448 |

## Fora deste pedido

- Persona com nome próprio (DEC-089) — Paulo **não** pediu na It. 1.
- Listas/botões WhatsApp (#415 / M5).
- Retirar o texto livre do LLM do funil: só depois destas frases aprovadas e do validador único ligado.

## Como aprovar

O Paulo aprovou o catálogo em 02/11/2026 (DEC-122), depois de ler e de ver as correções. Para os atos em falta, o processo é o mesmo: o PR traz a secção «Copy para aprovação do Paulo»; a aprovação fica registada numa DEC nova; só depois a engenharia liga as redações aos fluxos (#448).
