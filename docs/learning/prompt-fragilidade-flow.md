# Prompt — fragilidade da conversa de agendamento e Flow

**Estado:** anexo de contexto (**Confirmado** nos factos de produto citados DEC/DEC-138; recomendações de desenho Flow detalhado ficam **Proposto** até o Paulo aceitar).  
**Não inventa** métricas nem dados reais de pacientes; sonda referida é de clínica de teste.  
**Uso:** material-fonte / briefing — **não** é especificação que substitui MVP; **não** implementar código a partir deste texto enquanto o Paulo não aceitar a forma do Flow.  
**Índice:** [README.md](README.md) · síntese em [licoes-arquitectura-tredane.md](licoes-arquitectura-tredane.md).

Copia o bloco abaixo para outro agente ou para uma decisão de produto.

---

És um responsável de produto e de arquitetura do Tredane (SaaS multi-tenant para clínicas de estética: WhatsApp Business Cloud API, painel, agenda própria, núcleo determinístico de conversa). O Paulo pediu análise, não implementação.

## O que está frágil

O caminho feliz por toques chega a marcar: linha (Feminina/Masculina) → lista Opções de uma zona → lista Horários → proposta versionada → botão Confirmar. Texto livre «sim» não marca (DEC-061). O relógio mostrado à cliente é o da clínica, sem nome de fuso (DEC-098/copy). Indicador de digitação da Meta existe (DEC-136). Escolhas interativas estão sempre ligadas (DEC-133). Combinação de zonas é texto livre; a lista é um toque só (DEC-135). Depois do texto, o bot ecoa «Entendi: Axila e Pernas. Certo?» com Sim/Corrigir antes de Horários; Sim só confirma zonas (DEC-137).

Isto partiu na sonda real de Novembro de 2026 (clínica de teste, WhatsApp):

- A sessão antiga saltava para horários. «Terminar» não limpava o frame; só apagar o contacto limpava.
- «Quero depilar» não encontrava Depilação.
- Com Feminina já escolhida, «Axila» e «Axila e pernas» acusavam mistura de masculino e feminino (homónimos). Corrigido depois no código.
- «Axilas e pernas» ofereceu horário só de Pernas, sem dizer que Axila tinha caído.
- O eco DEC-137 passou: «Axilas e pernas» → «Entendi: Axila e Pernas» → Sim → Horários das duas, com dia da semana no texto.
- O toque na linha «11-03 17:00» não abriu proposta. O bot perguntou «qual dia fica melhor?». O título da lista está em mês-dia; o texto da mensagem está em dia/mês (`03/11`). O id da linha tem de ser a hora oferecida. Relêr o título perde o dia.
- Um Confirmar chegou depois de o horário expirar.
- Quando o catálogo não casa, a resposta despeja um link Google e «falar com a equipe», sem dizer o que faltou.

A cliente acredita que pediu as duas zonas ou aquela hora. O bot avança com um quadro incompleto. Esse é o defeito central. Mais frases no chat não o resolvem.

## Sequência que o Paulo quer para agendar

1. Serviço. Se a clínica só tem um serviço agendável, saltar.
2. Género, só se esse serviço tiver mais do que um sexo definido (feminino e masculino). Uma linha só segue direto.
3. Variantes dessa linha, em multi-seleção (várias zonas na mesma visita, mais «Todas»). Serviço sem variantes salta.
4. Horário livre calculado pela agenda da clínica (profissional, sala, intervalo, grade de 15 minutos), no relógio da clínica, com dia da semana.

O Flow não marca, não escolhe sala, não cobra Pix. No fim, o chat envia a proposta versionada. Só o botão Confirmar cria o compromisso (DEC-061).

Texto livre («axila e pernas sexta às 10») continua, preenche o mesmo quadro e passa pelo eco. Se o Flow não abrir, o chat atual é recurso, não o caminho principal.

## Flow (caminho estruturado)

Um WhatsApp Flow com `data_exchange`: cada ecrã pede dados ao backend da clínica, porque as horas dependem das zonas. Catálogo estático dentro do JSON do Flow não serve. Custo real: Flow publicado na WABA, chave pública, endpoint cifrado, webhook `nfm_reply`, mais uma superfície de teste. CheckboxGroup para variantes. Horas são as nossas, não o calendário genérico da Meta.

Não meter no Flow: agenda completa, profissional, sala, preço editável, Pix, nem um «marcar» que fure a DEC-061.

## Além do Flow — práticas que continuam obrigatórias

O Flow não substitui isto. Adota cada uma mesmo que o Flow entre.

1. **Limiar de confiança.** Só preenche um campo (serviço, linha, zona, hora) com correspondência única na lista da clínica. Se sobrar uma palavra ou houver dois candidatos, pergunta. Nunca oferece horário com uma zona a menos.
2. **Id, não o título.** O toque numa lista ou num Flow traz o id do horário oferecido. O título é só rótulo. Não voltar a interpretar «11-03 17:00» como frase.
3. **Uma forma de data para a cliente.** Dia da semana e dia/mês no relógio da clínica (`terça 03/11 17:00`). Sem fuso. Sem mês-dia. Cabe no limite de 24 caracteres do título, ou o título encurta e a descrição leva o texto completo (DEC-134).
4. **O mesmo quadro para todos os caminhos.** Toque, Flow, texto e correção escrevem os mesmos campos: serviço, linha, variantes, início. A proposta lê esse quadro. Não há um segundo parser na confirmação.
5. **Recomeçar limpa o frame.** «Começar de novo», «outra coisa» e o fim da conversa apagam serviço, linha, zonas e hora pendente. A cliente não depende de apagar o contacto no painel.
6. **Uma pergunta, a do campo que falta.** Se a linha já está escolhida, não perguntar o género. Se a hora já veio no texto e as zonas estão confirmadas, não perguntar o dia.
7. **Corrigir volta ao campo certo.** Corrigir zonas reabre zonas. Corrigir a hora reabre horas. Não recomeça a conversa nem abre o passo seguinte por engano.
8. **Validade visível.** A proposta e a lista de horas dizem até quando valem. Horário passado não aparece. Confirmar fora da validade explica e oferece outras horas, sem marcar.
9. **Atalho de texto com eco.** Quem escreve tudo numa frase cai no quadro e vê «Entendi: … Certo?» antes de Horários ou da proposta. Sim desse eco não marca.
10. **Passar à equipe com o quadro.** O handoff leva serviço, zonas e hora entendidas. Não substitui uma falha de leitura por um link externo.
11. **Sinónimos e plural só na linha já escolhida.** «Depilar» → Depilação. «Axilas» → Axila feminina se a linha é feminina. Sem cruzar masculino e feminino.
12. **Medir o estrago, não o tom.** Em cada conversa de teste: a marcação acabou no que foi pedido? Quantas zonas pedidas entraram? Quantas vezes a pessoa corrigiu? Quantas voltas até ao Confirmar? A sonda manual e o harness L2/L3 contam isto.

## O que não fazer

Não alargar o modelo de linguagem para escolher zona, hora ou marcar. Não construir um menu de dez níveis. Não duplicar a agenda dentro do Flow. Não aceitar «sim» escrito como confirmação de horário.

## Pedido a quem receber este prompt

Escreve uma recomendação de decisão (problema, opções, recomendação, o que fica de fora, como testar), em português, sem código. A recomendação esperada, sujeita ao Paulo, é: o caminho principal de agendar é o Flow com a sequência acima; as doze práticas ficam no núcleo e no texto livre. Não abras pull request. Não alteres produção.
