# Estados e eventos do MVP

**Estado:** proposta para revisão. Este documento transforma as [jornadas](journeys.md) em regras de estado observáveis; não define tabelas nem formato de API. Valide transições com uma clínica piloto antes de implementá-las como regras definitivas.

## Princípios

- Clínica, contato, conversa, oportunidade, mensagem e agendamento são conceitos distintos. Uma mudança em um deles não deve alterar outro silenciosamente.
- Toda entidade e evento pertence a uma clínica. Identificadores externos de WhatsApp são únicos apenas no contexto de integração/tenant apropriado.
- Estado confirmado vem da persistência; evento WebSocket informa a mudança depois de gravada. Ao reconectar, o painel relê o estado persistido.
- Históricos relevantes preservam quem ou qual integração mudou o estado, quando e o estado anterior. Anexos e conteúdo pessoal não precisam ser copiados para cada evento.

## Conversa (proposta)

| Estado | Significado | Transições propostas |
| --- | --- | --- |
| Nova | Mensagem recebida, ainda sem atendimento assumido. | Em atendimento, Encerrada. |
| Em atendimento | Equipe está conduzindo a conversa. Responsável atribuído é um campo separado. | Encerrada; reatribuição não muda o estado. |
| Encerrada | Atendimento foi concluído ou descartado pela equipe. | Reaberta para Em atendimento se houver ação humana ou nova mensagem, conforme regra ainda a validar. |

**Em aberto:** quando criar uma nova conversa versus reabrir uma antiga; se encerramento exige motivo; se atendente vê toda a fila. Sem resposta, a implementação não deve apagar o histórico.

## Mensagem

| Direção | Estados observáveis propostos | Regra |
| --- | --- | --- |
| Recebida | Recebida; Processamento com falha. | A mesma entrega externa não cria duas mensagens lógicas. Uma falha de processamento não aparece como mensagem íntegra se o conteúdo não foi persistido. |
| Enviada pela clínica | Pendente → Aceita pelo provedor → Entregue → Lida, quando o provedor informar. Alternativas: Falhou ou Resultado desconhecido. | “Aceita pelo provedor” não equivale a “Entregue”. Resultado desconhecido não é apresentado como sucesso nem repetido automaticamente antes de reconciliação. Estados tardios não fazem a mensagem regredir indevidamente. |

Texto em edição antes do envio é estado da interface; não é mensagem enviada. Uma sugestão de IA também não é mensagem até que uma pessoa escolha e confirme o envio.

## Oportunidade no pipeline (proposta)

Etapas iniciais: **Novo contato → Em atendimento → Horário proposto → Agendado → Concluído**, com saída possível para **Perdido**. O agendamento confirmado pode sugerir a etapa “Agendado”, mas o vínculo com um agendamento real precisa existir; mudar a etapa manualmente não cria um compromisso. Cancelamento ou reagendamento não apaga etapas anteriores.

**Em aberto:** se o pipeline representa uma oportunidade por conversa, por serviço ou por ciclo de compra; se etapas podem ser puladas; quando uma oportunidade “Perdida” reabre; e o que “Concluído” significa para a clínica. Essas respostas bloqueiam a máquina de estados definitiva.

## Agendamento (proposta)

| Estado | Significado | Regra |
| --- | --- | --- |
| Confirmado | Horário reservado para o profissional e a sala/equipamento exigidos. | A confirmação verifica conflitos para todos os recursos necessários no mesmo intervalo. |
| Cancelado | Compromisso não ocupa mais recursos. | Preserva quem cancelou, quando, o motivo (obrigatório, DEC-008) e o vínculo com a conversa. Não há prazo mínimo. |
| Concluído | Serviço/atendimento ocorreu. | Validar se esta marcação é necessária no MVP e quem a faz. |

“Horário proposto” é uma etapa da negociação; **não reserva** recursos da agenda (Confirmado, DEC-008). Ao reagendar, o compromisso anterior permanece no histórico e o novo horário só é confirmado se estiver disponível. Duração e intervalo vêm do serviço (Confirmado); fuso horário da clínica, expediente e bloqueios ainda precisam de definição.

## Eventos de interface propostos

| Evento lógico | Quando ocorre | Visões afetadas |
| --- | --- | --- |
| Conversa criada/atribuída/encerrada | Após persistir a mudança. | Caixa de entrada e detalhe da conversa. |
| Mensagem recebida ou estado alterado | Após persistir a mensagem ou atualização do provedor. | Detalhe e lista de conversas. |
| Etapa da oportunidade alterada | Após persistir a mudança e o histórico. | Pipeline e detalhe do contato. |
| Agendamento confirmado/cancelado/reagendado | Após persistir a alteração sem conflito. | Agenda, conversa e oportunidade. |
| Acesso revogado | Quando uma associação ou sessão perde validade. | Conexões e telas afetadas deixam de receber dados; nova leitura exige autorização. |

O payload deve conter somente o necessário para identificar a mudança. O servidor verifica o tenant antes de publicar e antes de entregar. Eventos podem chegar repetidos ou deixar de chegar; o cliente reconcilia com a API ao conectar ou reconectar. Um Durable Object por clínica e WebSockets com hibernação estão **Confirmados** (DEC-004, DEC-005).

## Questões que bloqueiam estados finais

1. Quando encerrar ou reabrir conversa e oportunidade?
2. O que “Concluído” significa no pipeline e na agenda?
3. ~~Há reserva temporária de horário proposto?~~ Resolvida: não há (DEC-008).
4. Quais regras de expediente, bloqueios e fuso horário valem para a clínica piloto, e o intervalo após o atendimento ocupa o profissional?
5. Que estados de entrega do WhatsApp serão exibidos quando o provedor não enviar confirmação?
