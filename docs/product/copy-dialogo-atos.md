# Copy: atos de diálogo determinísticos (M4 / #414)

**Estado:** **Proposto** — frases para aprovação do Paulo (DEC-104). Não entram em produção sem ok explícito. **O «ok» de copy de 01/11/2026 não cobriu este catálogo** (DEC-121): cobriu só as 5 frases do #442. Este catálogo espera a leitura e a aprovação do Paulo, que bloqueiam a [#448](https://github.com/intentzero/tredane/issues/448). As frases já fixadas por DEC (DEC-083, DEC-077, DEC-086, DEC-107, DEC-113–115) **não** mudam aqui.

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

## Fora deste pedido

- Persona com nome próprio (DEC-089) — Paulo **não** pediu na It. 1.
- Listas/botões WhatsApp (#415 / M5).
- Retirar o texto livre do LLM do funil: só depois destas frases aprovadas e do validador único ligado.

## Como aprovar

O Paulo lê este documento e responde «ok» (ou pede alterações por ato). A aprovação fica registada numa DEC nova e o cabeçalho passa a **Confirmado**. Só depois a engenharia liga as redações aos fluxos (#448). Até lá, o catálogo está **Proposto** (DEC-121).
