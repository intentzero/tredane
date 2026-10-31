# Avaliação de impacto do sistema de IA

**Estado:** **Proposto** (30/10/2026). Primeiro resultado do processo descrito no [manual](aims.md) §5 e §6. Repete-se quando mudar o que a IA vê, o que ela pode causar, ou o fornecedor do modelo. Não é parecer jurídico.

**Retenção deste resultado:** fica neste ficheiro enquanto o sistema estiver no âmbito do manual. O prazo formal de retenção acompanha a revisão do GATE-04 (NC-03, NC-05). Não se apaga a avaliação anterior: uma revisão nova acrescenta data e o que mudou.

## Funções avaliadas

1. **Sugestão e resumo** para a equipe. A sugestão é identificada. Quem envia o texto à cliente está em aberto (NC-01).
2. **Proposta de horário com botão.** O modelo interpreta; o backend monta a proposta; a marcação só ocorre no toque em Confirmar (DEC-061). Serviço com sinal não reserva horário antes do Pix (DEC-047).

## Pessoas

| Quem | O que pode correr mal | Controle já decidido | O que continua aberto |
| --- | --- | --- | --- |
| Cliente da clínica | Recebe preço, horário ou descrição errados; uma sugestão parece orientação de saúde; um horário é marcado sem o toque certo | DEC-046 (preço e explicação só do cadastro; pergunta de saúde sem mérito); DEC-061 (botão, versão, 30 min, revalidação); DEC-067 (imagem fora da IA); quotas e pausa | NC-01 (envio da sugestão). O clique não é consentimento LGPD. Informar no WhatsApp que houve IA: **Em aberto**. |
| Atendente | Confia na sugestão sem ler; o resumo é usado como se fosse a conversa | Rótulo de sugestão; resumo é interno; falha da IA não bloqueia a resposta manual | Competência sem registo de formação (NC-06). |
| Quem a audiência do serviço exclui (DEC-075) | Um horário é oferecido fora da audiência do serviço | A audiência descreve o serviço, não a pessoa; o contato não ganha sexo (DEC-075) | A avaliação não mediu um caso real. Dados reais continuam bloqueados. |
| Profissional sem login | A pergunta de saúde é encaminhada à equipe e não chega a quem atende | DEC-046 manda encaminhar | O caminho da equipe até a profissional não está definido. |

Mensagem de estética pode citar gravidez, medicamento ou condição de saúde. Tratar isso como dado pessoal sensível está **Em aberto** no [dossiê jurídico](../product/legal-review-brief.md). Este ficheiro não responde. O controle de produto, enquanto o parecer não chega, é não responder o mérito (DEC-046) e não mandar a imagem à IA (DEC-067).

## Impacto societal

O sistema atende a conversa comercial de uma clínica. Não pontua pessoas, não usa biometria e não decide crédito, emprego ou acesso a um serviço público. O efeito que passa do atendimento individual é a sugestão parecer orientação de saúde, e muitas marcações automáticas encherem a agenda. O primeiro está limitado pela DEC-046. O segundo está limitado pelas quotas e pela pausa da responsável; a qualidade dessas marcações no piloto (H10) continua **Em aberto**. A.5.5 permanece aplicável: este parágrafo é o registo, não uma exclusão.

## O que esta avaliação não conclui

Os controles da tabela mitigam. Não significam que o risco acabou. NC-01, NC-02, NC-03 e NC-04 continuam abertas no [registo](aims-register.md). Dados reais continuam bloqueados por esses gates.

## Adendo — evolução autónoma, 31/10/2026

**Confirmado:** DEC-084 aprova a direção arquitetural. **Proposto:** a avaliação de impacto acrescenta o risco de uma alteração ruim alcançar muitas conversas, reduzir acesso humano ou expor dados através de avaliação/telemetria. Clientes, equipe e clínicas podem sofrer efeito em escala mesmo se cada resposta parecer aceitável isoladamente. Controles propostos: população limitada, invariantes protegidas, métricas por segmento, orçamento, controlador independente e recuperação. A comparação de frustração pode produzir rótulos incorretos; não usar esses rótulos para discriminar clientes ou restringir atendimento.

Riscos e evidências exigidas estão no [modelo de ameaças](evolucao-autonoma-threat-model.md). EA-G01–06 permanecem **Em aberto**; não foi observada eficácia desses controles nesta análise. NCs e gates de dados reais permanecem aplicáveis. Este adendo preserva a avaliação anterior e não declara liberação da autonomia.
