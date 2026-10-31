# Sonda conversacional no staging — 31/10/2026

**Estado:** **Observado** na Clínica Teste Paulo (staging). Não é imunidade, não fecha o piloto e não substitui uma DEC. Dados fictícios. O telefone não é repetido: na ficha do contato aparece mascarado; no Agendar da conversa apareceu completo.

**Ambiente:** [staging.app.tredane.com](https://staging.app.tredane.com), tenant `tenant_b40dc579540c30130840b9ac`, sessão `pauloramires@gmail.com`, clínica **Clínica Teste Paulo (staging)**, «Ao vivo». WhatsApp Web, só o chat **Teste Tredane Whatsapp**. Nenhum outro chat foi aberto nem recebeu texto. Nenhuma ficha de serviço foi gravada.

**Quando:** sábado 31/10/2026, cerca de 17:07–17:33 (fuso da clínica). A clínica estava fechada (sábado só até 12:00). A janela de 24 h abriu com a primeira mensagem, às 17:07. Antes da sonda, o painel já mostrava dados operacionais repostos; a agenda de segunda a quinta estava vazia. Esta sonda não carregou nesse botão.

Continua a [sonda de 30/10](staging-conversational-probe-2026-10-30.md). O roteiro pedido era: marcar depilação, remarcar, marcar um segundo serviço, remarcar esse, cancelar, e ver o Acompanhar.

## Catálogo lido, sem alteração

- **Depilação.** Audiência masculino, sem sinal, intervalo 15 min, tempo sem restrição, qualquer dia com profissional livre. Tipo no singular e no plural, os dois gravados como «Zonas». Variantes: Axila masculina 15 min R$ 50; Axila feminina 15 min R$ 40; Pernas masculinas 30 min R$ 140; Pernas femininas 30 min R$ 120. Quem faz: **Gi** (Sandra desmarcada). Sala: **Sala Depilação**. Sem explicação para a IA. Sem combos.
- **Brinzeamento.** Opção única, 60 min + intervalo 15 min, R$ 150, audiência qualquer, sem sinal, tempo **Sol**, qualquer dia com profissional livre. Quem faz: **Sandra**. Sala: **Espaço Bronzeamento** (partilhada; a grade mostrou «4 de 4» lugares livres). Sem explicação.
- Expediente, Gi e Sandra: seg–sex 09:00–12:00 e 13:00–18:00, sábado 09:00–12:00, domingo fechado. Sem folga futura.
- Sugestões da IA ligadas. Limites de proteção desligados. Pausa de marcações automáticas por botão desligada.

## Método

Uma mensagem de cada vez, só nesse chat. Esperar a resposta e cruzar Conversas, Acompanhar e Agenda com «Ao vivo», sem recarregar à força. Horários escolhidos depois de ler a agenda: segunda 02/11 14:00, terça 03/11 10:00, quarta 04/11 14:00, quinta 05/11 10:00. Texto livre não devia marcar. Remarcar e cancelar deviam pausar a IA (DEC-083) e a equipe concluía no painel.

## Marcação da depilação

| Mensagem | Resposta | Veredito |
| --- | --- | --- |
| «Oi, quero marcar depilação masculina de axila na segunda-feira, 2 de novembro, à tarde.» (17:07) | «Oi, Paulo! Na segunda (02/11) à tarde tenho 13:00, 14:00 ou 15:30 para a depilação de axila. Qual fica melhor pra você?» Botão **Falar com a equipe**. | Dia, tarde e almoço **alinhados**. Três horários, sem inventar. Não citou preço, duração, Gi, sala nem o género. A zona já tinha sido dita e mesmo assim voltou a ser pedida no turno seguinte. |
| «Pode ser às 14:00.» (17:07) | «Para fechar às 14:00, me diga as Zonas: Axila, Pernas. Pode ser mais de uma.» (17:08) | **Divergente.** Ignorou «axila» e «masculina» do primeiro turno. O plural «Zonas» está no cadastro (singular e plural iguais). Sem botão de equipe nesta frase. Nada marcado. |
| «Só a axila masculina.» (17:09) | «Vou pedir para a equipe continuar daqui.» | **Divergente.** Não era pedido de pessoa, remarcar, cancelar nem assunto fora. O alerta ficou «A mensagem saiu do agendamento. A IA ficou pausada.» Lista: **Precisa de alguém**. Sem proposta. |
| «Axila.» (17:11), depois de **Devolver à IA** com o alerta ainda aberto | Silêncio no WhatsApp. A pausa voltou. «Lida por Responsável». | **Alinhado** a não repetir a frase com o alerta aberto. **Divergente** no efeito: a resposta de agendamento não saiu. |
| Depois de **Assumir** (encerrou o alerta) e **Devolver à IA**: «Quero a axila masculina na segunda, 2 de novembro, às 14:00.» (17:13) | Proposta 17:13. **Confirmar** às 17:14. | **Alinhado** à DEC-061. |

Proposta: beneficiária Paulo, Depilação · Axila, segunda 02/11/2026 14:00–14:15 (America/Sao_Paulo), 15 min, Gi, R$ 50,00, validade 30 min, botões Confirmar, Alterar detalhes e Falar com a equipe. Sem sala e sem a palavra «masculina»; o preço é o da variante masculina. O fim 14:15 não inclui o intervalo de 15 min.

Resultado do botão: «Agendado: Depilação em segunda-feira, 02 de novembro de 2026 às 14:00 – 14:15 (America/Sao_Paulo) com Gi.» Compromisso `apt_e58e40345c60419a`, Confirmado, Gi, Sala Depilação, «Marcado pela IA», ator `system:ai-autobook` às 17:14:12. A ficha não mostra preço nem género.

A seguir: «Posso ajudar em algo mais?» com **Não, obrigado** e **Quero outro serviço**. O rótulo confirmado em REQ-097 / DEC-086 é «Quero agendar outro serviço». Não se tocou em **Não, obrigado**.

Acompanhar: coluna Agendado 1, Paulo, seg. 02/11 14:00, sem responsável, filtro Gi 1. Histórico: Novo contato (Sistema) → Em atendimento (IA, primeira resposta) → Agendado (IA, «Compromisso confirmado pelo botão do WhatsApp»). A lista de Conversas continuou em **Em atendimento**, com responsável «Você» porque a conversa tinha sido assumida. O cabeçalho da conversa e o quadro diziam **Agendado**.

## Remarcar a depilação

«Remarca meu horário de segunda para terça, 3 de novembro, às 10:00.» (17:15) teve resposta da IA, sem pausa e sem **Precisa de alguém**: «Para remarcar o mesmo atendimento, Paulo: para qual dia você prefere?» com **Falar com a equipe**. O dia e a hora já estavam na mensagem. O compromisso de segunda ficou intacto. **Divergente** da DEC-083, que põe remarcar na pausa com a frase fixa. A frase que saiu não está no código deste repositório.

**Reagendar** no compromisso abriu `/agenda/agendar` como marcação nova: sem o Paulo, serviço por defeito Brinzeamento, dia sábado 31. Nada foi gravado. O mesmo defeito da sonda de 30/10.

O Agendar da conversa, ligado ao Paulo, enviou proposta de terça 03/11 10:00–10:15, Depilação · Axila, Gi, R$ 50. A revisão no painel dizia «Depilação · 15 min», Gi, ter 03/11 10:00–10:15, Sala Depilação, e omitiu zona, género e preço. O texto do WhatsApp trouxe Axila e R$ 50. **Confirmar** às 17:19 criou `apt_c9fbe9dc586643d8`, ator `system:ai-autobook` às 17:19:38. A segunda continuou Confirmada até ser cancelada no painel às 17:21:55, motivo «Contacto remarcou». O WhatsApp não recebeu aviso de cancelamento. O Acompanhar passou a apontar terça 03/11 10:00. O histórico de etapas não ganhou linha nova.

## Segundo serviço (Brinzeamento)

**Quero outro serviço** (17:22) manteve o ciclo. Resposta: «Claro! Qual serviço gostaria de agendar?»

| Mensagem | Resposta | Veredito |
| --- | --- | --- |
| «Quero brinzeamento na quarta-feira, 4 de novembro, à tarde.» (17:23) | «Paulo, para o brinzeamento na quarta à tarde não deu para confirmar o tempo nesse horário. A equipe envia outra opção em breve.» | Reconheceu o nome do catálogo. **Divergente:** não havia hora escolhida, não ofereceu outra hora e não abriu alerta. A frase fixa da DEC-077 foi parafraseada. |
| «Então na quinta-feira, 5 de novembro, de manhã.» (17:24) | A mesma ideia para «quinta de manhã», e «Se preferir outro dia ou período, me diga que eu vejo o que está livre pra você.» | **Divergente.** Convida a repetir um pedido que o tempo não confirma. Sem pausa. |

Na grade da equipe, quarta 04/11 tinha inícios de 15 em 15 min, cada um com «4 de 4» (lugares livres na sala partilhada). A revisão de 14:00 mostrou o aviso «Não deu para confirmar o tempo», Sandra, 14:00–15:00, Espaço Bronzeamento, R$ 150, e mesmo assim **Enviar proposta**. A proposta no WhatsApp (17:26) não trazia o aviso nem a sala. **Confirmar** devolveu a frase fixa «Não deu para confirmar o tempo nesse horário. A equipe envia outra opção em breve.» Nenhum compromisso de Brinzeamento nasceu. Quarta ficou vazia.

Por isso o resto do roteiro — segunda remarcação e cancelamento — correu sobre a depilação que ainda existia (terça), não sobre um segundo serviço marcado.

## Segunda remarcação e cancelamento

«Remarca a depilação de terça para quinta-feira, 5 de novembro, às 10:00.» (17:28) repetiu «para qual dia você prefere?». Sem pausa. A equipe enviou proposta de quinta 05/11 10:00–10:15, Axila, Gi, R$ 50. **Confirmar** às 17:31 criou `apt_287d0cec73094d17`, ator `system:ai-autobook` às 17:31:18. A terça foi cancelada às 17:32:01, motivo «Contacto remarcou». Sem aviso no WhatsApp. Saiu de novo «Posso ajudar em algo mais?»; **Não, obrigado** não foi tocado.

«Cancela o horário de quinta.» (17:32) recebeu uma vez «Vou pedir para a equipe continuar daqui.» Alerta: «Pedido que a IA não cumpre (remarcar, cancelar, terceiro ou profissional fora do serviço).» Lista: **Precisa de alguém**. IA pausada. **Alinhado** à DEC-083 no cancelar. O mesmo verbo de remarcar, dois minutos antes, não tinha pausado.

Cancelamento no painel às 17:33:19, motivo «Contacto desistiu». «Compromisso cancelado. Recursos liberados.» O WhatsApp não avisou. A última mensagem da cliente continuou a ser o pedido de cancelamento; por cima dela permanece o «Agendado…» das 17:31.

## Acompanhar depois de tudo cancelado

Agenda: segunda 02/11, terça 03/11, quarta 04/11 e quinta 05/11 com «Nenhum horário marcado». Gi 0 e Sandra 0 nesses dias.

O quadro continuou com 1 em andamento na coluna **Agendado**, Paulo, «qui., 05 de nov., 10:00», sem responsável, filtro Gi 1. O vínculo e «Próximo compromisso» ainda mostram a quinta 10:00 já cancelada. O histórico parou em Agendado, na confirmação do primeiro botão. O mesmo desvio da sonda de 30/10, ainda **Proposto** em [followup-conversa-painel.md](../product/followup-conversa-painel.md).

## O que o staging confirmou

Texto livre não marcou. O **Confirmar** de proposta válida de depilação criou compromisso com a Gi, a Sala Depilação, R$ 50 e o ator `system:ai-autobook`. O Acompanhar foi para Agendado com o horário. «Quero outro serviço» não fechou o ciclo. Cancelar por texto não mexeu na agenda e, desta vez, pausou a IA com a frase fixa uma vez. Cancelar no painel exige motivo e liberta o horário. Brinzeamento com o tempo por confirmar não vira compromisso no clique.

## O que divergiu

- Pedir a zona outra vez, com «Zonas», depois de «axila masculina» e de uma oferta de horários.
- «Só a axila masculina» pausou como se a mensagem tivesse saído do agendamento. Com o alerta aberto, «Axila.» ficou sem resposta e a pausa voltou. **Devolver à IA** não tirou o alerta; **Assumir** tirou. Logo a seguir a lista ainda contava **Precisa de alguém**.
- Remarcar por texto não pausa e pergunta o dia que já foi dito. Cancelar pausa. Os dois estão na mesma regra da DEC-083.
- **Reagendar** abre visita nova, sem o Paulo, no serviço e no dia errados. O caminho que move é uma proposta nova mais o cancelamento do horário antigo. Dois compromissos coexistem até esse cancelamento.
- A revisão da depilação omite zona, género e preço. A do Brinzeamento mostra o preço. Nenhuma proposta de WhatsApp mostra a sala. O intervalo não entra no fim mostrado.
- Brinzeamento: a IA não oferece outro horário, promete a equipe e não abre alerta. A equipe consegue enviar a proposta com o aviso de tempo; o texto enviado à cliente não leva o aviso; o **Confirmar** recusa e nada marca.
- A lista diz **Em atendimento** enquanto o quadro e o cabeçalho dizem **Agendado**. A oportunidade fica «Sem responsável» com a conversa atribuída a uma pessoa.
- O recibo de leitura diz «Lida por Responsável», o papel, não o nome.
- Cancelar no painel não avisa o WhatsApp. O Acompanhar fica em Agendado com a data já cancelada. REQ-033 e o acompanhamento do cancelamento continuam **Proposto**.
