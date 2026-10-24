# Conceito da landing page — Tredane

**Estado:** conceito documentado para orientar design e redação; publicação e implementação não realizadas.
**Data:** 23/10/2026.
**Origem:** conversa de definição com Paulo, seguida do pedido explícito “Vamos documentar no repo o conceito da landing page”.

**Confirmado:** registrar o conceito nesta documentação e respeitar o público, fluxo e limites do [MVP](../MVP.md).
**Proposto:** posicionamento, textos, estrutura, direção visual e jornada de demonstração abaixo.
**Em aberto:** abertura do piloto, CTA definitivo, identidade visual final, formulário e operação de captação. O pedido de documentação não transforma essas escolhas condicionais em decisões aprovadas nem altera DEC-001–038.

> **Atualização (24/10/2026):** depois deste conceito, o responsável pelo produto confirmou decisões para a landing page em [DEC-044](decisions.md), detalhadas em [landing.md](landing.md), que **prevalecem** onde divergem deste documento:
> - **Visual:** design system do painel (azul `#2F5BD3`, Inter), e não marfim, grafite e verde profundo.
> - **Captação:** contato por e-mail, **sem formulário**, até haver política de privacidade; o formulário da seção 7 fica sem efeito por ora.
> - **CTA:** “Quero participar do piloto”.
> - **Pagamentos:** o sinal por Pix passou a fazer parte do MVP (DEC-047); os demais pagamentos continuam fora.
> - **Vocabulário:** “Acompanhamento” no lugar de pipeline (DEC-045).
>
> Continuam válidas e foram levadas para [landing.md](landing.md) como pontos **Em aberto**: indicar o estágio do produto (“em desenvolvimento”), marcar as interfaces como “prévia conceitual” e citar clínicas de depilação no público.

## 1. Objetivo e público

**Proposto:** a primeira landing apresenta o Tredane e capta interesse de donos e responsáveis por clínicas de estética e depilação. Deve abrir conversas com potenciais clínicas piloto, conforme disponibilidade real do programa.

A equipe de recepção é o usuário operacional mostrado na demonstração. A mensagem dirige-se a quem organiza o atendimento e precisa acompanhar conversas, interesses e horários.

A página deve ajudar o visitante a entender:
- Para quem o Tredane está sendo desenvolvido.
- Como o atendimento poderá seguir da mensagem ao agendamento.
- Qual será o próximo passo ao manifestar interesse.

O fluxo é coerente com a primeira fatia descrita no MVP: WhatsApp → atendimento → oportunidade → agendamento confirmado. A landing não amplia esse escopo.

## 2. Conceito e posicionamento

**Conceito central proposto:** “Do primeiro ‘oi’ ao horário confirmado.”

**Ideia de posicionamento proposta:** “Clareza para a equipe, continuidade para o cliente.”

A mensagem deve partir de uma rotina reconhecível: alguém pede o preço, outra pessoa pergunta sobre horários, uma conversa é transferida entre atendentes e a equipe precisa saber quem aguarda resposta e qual é o próximo passo.

Essas situações são hipóteses de comunicação baseadas no fluxo do produto, não conclusões de pesquisa com clínicas. Validar a linguagem com a clínica piloto.

A proposta de valor a demonstrar é a continuidade do atendimento, conectando:
1. Conversa e histórico.
2. Interesse do cliente e acompanhamento.
3. Disponibilidade e confirmação do horário.
4. Visibilidade compartilhada pela equipe.

IA aparece como apoio dentro dessa jornada, com sugestão editável e resumo. A equipe continua responsável pelo envio e pelas decisões.

## 3. Primeira tela — redação proposta

**Identificação:** Tredane · Atendimento para clínicas de estética e depilação

**Título:**
> Do primeiro “oi” ao horário confirmado.

**Texto de apoio:**
> Acompanhe quem pediu informações, quem aguarda uma resposta e quem está pronto para agendar. O Tredane conecta WhatsApp, acompanhamento de clientes e agenda para sua equipe dar continuidade a cada atendimento.

**Estado do produto visível:**
> Em desenvolvimento. Cadastre seu interesse para acompanhar o lançamento.

Esse texto é uma proposta de comunicação para um produto em desenvolvimento; não anuncia módulos já disponíveis. Reavaliar a indicação de estágio antes de publicar, conforme o estado real da entrega.

### CTA e destino

| Situação | Recomendação proposta | Destino e expectativa |
| --- | --- | --- |
| Recrutamento do piloto efetivamente aberto | **Quero participar do piloto** | Formulário de interesse; informar que haverá contato para avaliar participação, sem garantir vaga ou acesso imediato |
| Piloto ainda não aberto | **Quero conhecer o Tredane** | Cadastro de interesse para acompanhar o lançamento; não prometer inscrição em programa indisponível |
| Navegação secundária | **Veja como funciona** | Âncora para a demonstração conceitual do fluxo na própria página |

A abertura do piloto e o CTA final são **Em aberto**, sob responsabilidade de Paulo, antes de publicar a página. Não anunciar teste gratuito, preços, datas de lançamento ou condições comerciais ainda não definidos.

## 4. Uma jornada visual que percorre a página

**Proposto:** usar uma única cliente e clínica fictícias, identificadas como exemplo ilustrativo, para conectar as seções.

1. A cliente envia uma pergunta sobre depilação pelo WhatsApp.
2. A equipe visualiza a mensagem na caixa de entrada compartilhada, com histórico e responsável.
3. Uma sugestão de IA pode ajudar a preparar a resposta; uma pessoa revisa e envia.
4. A equipe acompanha o interesse no pipeline e identifica o próximo passo.
5. Consulta disponibilidade considerando profissional e sala/equipamento necessários.
6. Confirma o horário; a oportunidade e a agenda refletem o atendimento.

A mesma história deve reaparecer nas interfaces demonstradas, sem cartões de funcionalidades desconectados. Nomes, horários e mensagens serão fictícios; não apresentar a sequência como caso real ou resultado de cliente.

**Composição proposta:** texto à esquerda e prévia do produto à direita no desktop; texto e CTA antes da prévia no celular. Identificar interfaces ainda não implementadas como **“Prévia conceitual”**. Usar passos estáticos legíveis quando não houver animação.

## 5. Estrutura proposta da página

| Ordem | Seção e mensagem | Conteúdo a demonstrar |
| --- | --- | --- |
| 1 | **Do primeiro “oi” ao horário confirmado.** | Público, benefício central, estágio do produto, CTA e prévia conceitual |
| 2 | **Quem ficou esperando uma resposta?** | Situações de conversas por acompanhar, negociação de horários e transferência de atendimento |
| 3 | **Cada conversa com um próximo passo.** | Visão da jornada inteira: mensagem → atendimento → acompanhamento → agendamento |
| 4 | **Sua equipe acompanha a mesma conversa.** | Caixa de entrada compartilhada, histórico e responsável pelo atendimento |
| 5 | **Saiba em que ponto cada cliente está.** | Oportunidades e próximos passos; nomes de etapas ilustrativos, sujeitos às regras finais |
| 6 | **Confirme horários considerando os recursos da clínica.** | Disponibilidade de profissional e sala/equipamento necessários |
| 7 | **Uma ajuda para responder. Sua equipe decide.** | Sugestão de resposta editável, resumo e ação humana explícita de envio |
| 8 | **Conheça o Tredane desde o início.** | Repetição do CTA coerente com o estágio e formulário de interesse |

As seções 4–7 aprofundam a mesma jornada. Na execução visual, podem ser agrupadas para manter a página concisa, sem perder as mensagens essenciais.

## 6. Direção visual e tom

**Proposto:**
- Estética clara, acolhedora e precisa.
- Fundo marfim, texto grafite e verde profundo como cor principal.
- Tipografia limpa, títulos com personalidade e leitura confortável.
- Espaçamento generoso e interfaces em tamanho suficiente para entender o atendimento.
- Animações discretas ligando conversa, oportunidade e agenda, com alternativa estática e respeito à preferência de movimento reduzido.
- Português brasileiro, frases curtas e vocabulário da recepção.
- Preferir “acompanhamento de clientes” à exposição de jargão como pipeline quando a explicação simples for suficiente.

A personalidade deve vir da demonstração do produto e da linguagem da equipe. A paleta é direção inicial; logotipo, fontes, cores exatas e componentes ainda não estão definidos.

Não incluir detalhes de Cloudflare, D1, SQLite, Durable Objects, Clerk ou impersonação no argumento principal da landing. São decisões de engenharia documentadas separadamente.

## 7. Captação e limites de comunicação

**Formulário proposto inicialmente:** nome, clínica, WhatsApp e e-mail. Obrigatoriedade e eventual redução dos campos ficam em aberto para minimizar fricção e coleta.

Antes de implementar/publicar, definir destino dos dados, responsável pelo retorno, informação de privacidade, retenção e tratamento de falha. Não criar integração de CRM, envio automático ou lista de contatos apenas por este documento.

Na implementação futura:
- Sucesso só é mostrado após confirmação de recebimento pelo destino escolhido.
- Falha deve permitir nova tentativa sem perder os campos preenchidos.
- A confirmação explica o próximo passo sem prazo ou vaga garantidos.
- Demonstrações usam dados fictícios e distinguem proposta de funcionalidade disponível.
- Depoimentos, logotipos de clientes, números de adesão e resultados exigem evidência e autorização apropriada antes de uso.
- Não prometer aumento de receita, agenda cheia, ausência absoluta de falhas ou prevenção garantida de toda perda de oportunidade.

**Fora do MVP, conforme especificação:** prontuário, pagamentos, estoque, campanhas em massa, integração com agendas externas, respostas/agendamentos autônomos e relatórios avançados. A landing não deve apresentá-los como capacidades da primeira entrega.

## 8. Revisão antes de implementação

| Verificação | Critério |
| --- | --- |
| Clareza da primeira tela | Identifica clínicas de estética/depilação, benefício de continuidade e estágio do produto |
| Coerência com o MVP | Conversa, acompanhamento, agenda e IA assistiva correspondem ao escopo documentado |
| Jornada visual | Mesma cliente fictícia e atendimento conectam as prévias; nenhuma prévia é apresentada como produto já disponível |
| Conversão | CTA e confirmação correspondem ao programa realmente aberto |
| Leitura mobile | Texto, CTA e interfaces são compreensíveis; navegação/formulário funcionam por teclado e têm rótulos claros |
| Evidência | Nenhuma métrica, prova social ou promessa de resultado é inventada |
| Captação | Destino, privacidade, responsável pelo retorno e estados de sucesso/erro definidos antes de recolher dados |

**Em aberto, sem nova rodada automática de perguntas:** CTA/piloto, identidade final, formulário/destino e redação final. A próxima entrega possível é um layout conceitual baseado neste documento; este registro não constitui implementação ou publicação.

## Referências de produto

- [Escopo do MVP](../MVP.md)
- [Atores e permissões](actors-permissions.md)
- [Jornadas de atendimento](journeys.md)
- [Requisitos](requirements.md)
- [Decisões aprovadas e questões abertas](decisions.md)
- [Épico de definição #1](https://github.com/intentzero/tredane/issues/1)
