# Estados e eventos do MVP

**Estado:** mistura de regras **Confirmadas** (DEC-008/015/038/040/047) e máquinas de estado ainda **Propostas**. Este documento transforma as [jornadas](journeys.md) em regras observáveis; não define tabelas nem formato de API. Não tratar etapas «em aberto» como comportamento obrigatório. Execução: [épico #14](https://github.com/intentzero/tredane/issues/14).

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

**Confirmado (DEC-015):** atendente vê todas as conversas da própria clínica. **Em aberto:** quando criar nova conversa versus reabrir a antiga e se encerramento exige motivo. Sem resposta, a implementação não deve apagar o histórico.

## Mensagem

| Direção | Estados observáveis propostos | Regra |
| --- | --- | --- |
| Recebida | Recebida; Processamento com falha. | A mesma entrega externa não cria duas mensagens lógicas. Uma falha de processamento não aparece como mensagem íntegra se o conteúdo não foi persistido. |
| Enviada pela clínica | Pendente → Aceita pelo provedor → Entregue → Lida, quando o provedor informar. Alternativas: Falhou ou Resultado desconhecido. | “Aceita pelo provedor” não equivale a “Entregue”. Resultado desconhecido não é apresentado como sucesso nem repetido automaticamente antes de reconciliação. Estados tardios não fazem a mensagem regredir indevidamente. |

Texto em edição antes do envio é estado da interface; não é mensagem enviada. Uma sugestão de IA também não é mensagem até que uma pessoa escolha e confirme o envio.

## Oportunidade no pipeline (proposta)

Etapas iniciais: **Novo contato → Em atendimento → Horário proposto → Agendado → Concluído**, com saída possível para **Perdido**. Mover manualmente para “Agendado” **pode ocorrer sem compromisso vinculado** (DEC-040), exibindo “Sem compromisso vinculado” e a ação “Agendar horário”; a mudança de etapa nunca cria um compromisso. Cancelamento ou reagendamento não apaga etapas anteriores.

**Em aberto:** se o pipeline representa uma oportunidade por conversa, por serviço ou por ciclo de compra; se etapas podem ser puladas; quando uma oportunidade “Perdida” reabre; e o que “Concluído” significa para a clínica. Essas respostas bloqueiam a máquina de estados definitiva.

## Agendamento (proposta)

| Estado | Significado | Regra |
| --- | --- | --- |
| Confirmado | Horário reservado para a profissional e a sala dela (DEC-075), mais o equipamento exigido se houver. | A confirmação verifica capacidade, modo de atendimento e mesmo sexo nesse bloco. O bloco Tempo (DEC-077) não cancela este estado se a previsão mudar. |
| Cancelado | Compromisso não ocupa mais recursos. | Preserva quem cancelou, quando, o motivo (obrigatório, DEC-008) e o vínculo com a conversa. Não há prazo mínimo. |
| Concluído | Serviço/atendimento ocorreu. | Validar se esta marcação é necessária no MVP e quem a faz. |

“Horário proposto” é uma etapa da negociação; **não reserva** recursos da agenda (Confirmado, DEC-008). Ao reagendar, o compromisso anterior permanece no histórico e o novo horário só é confirmado se estiver disponível. Duração e intervalo vêm do serviço e o intervalo ocupa sala/equipamento **e** profissional; expediente semanal, bloqueios pontuais, fuso por clínica e grade de 15 min estão confirmados (DEC-008). Valores reais vêm da clínica piloto.

## Sinal por Pix (DEC-047)

| Estado | Significado | Regra |
| --- | --- | --- |
| Aguardando sinal | Cobrança criada e enviada; horário **não** reservado. | Expira no prazo (padrão 2 horas, ajustável pela responsável). |
| Paga | Provedor confirmou o pagamento. | Confirma automaticamente o compromisso se o horário ainda estiver livre (Confirmado, DEC-047); se estiver ocupado, passa a Pago sem horário. |
| Pago sem horário | Pago, mas o horário foi ocupado antes. | Alerta até a equipe escolher outro horário ou devolver. |
| Expirada | Prazo venceu sem pagamento. | Não aceita pagamento; aviso posterior vira Pago sem horário. |
| Cancelada | Atendente cancelou antes do pagamento. | Nova tentativa cria nova cobrança. |
| Estorno solicitado / Devolvido / Estorno falhou | Devolução pedida ao provedor e seu resultado. | Falha mostra Tentar de novo. |
| Retido | Cancelamento com sinal retido pela clínica. | Registra quem decidiu e o motivo. |

## Proposta de agendamento por botão (Decidido, DEC-061)

`enviada` → `confirmada` (clique válido → compromisso criado, ou autorização consumida ao abrir Pix se houver sinal) · `substituída` (nova versão) · `expirada` (30 min) · `recusada_vaga` (horário já não livre: sala, profissional ou capacidade) · `recusada_tempo` (DEC-077: a previsão na hora de início não serve ou não deu para confirmar; frases próprias, sem percentagem e sem número de vagas; não reutiliza `recusada_vaga`) · `encaminhada` (Alterar detalhes/dúvida/mudança material, inclusive céu, temperatura ou graus do serviço alterados depois do envio → atendente). Só `enviada` aceita clique; transições são idempotentes por proposta/versão. Proposta não reserva horário (DEC-008 / DEC-047).

**Extensão de engenharia (S3 #174 / S4 #175 / S5 #176):** antes de `enviada`, a proposta pode estar `preparada` → `envio_pendente` → `envio_incerto` (envio WhatsApp interactive). Vigência de 30 min conta a partir de `enviada` (relógio do backend; expiração preguiçosa sem job). Persistência: `appointment_proposals` + ligação `send_*` / `result_*` e `pending_communications` (H7, alerta 5 min) no SQLite do Clinic DO. Corpo e botões **Confirmar** / **Alterar detalhes** são montados só a partir do snapshot; clique Confirmar (S5) corre primeiro o avaliador do tempo (DEC-077; `recusada_tempo` se falhar) e só depois executa `confirmAppointmentOp` ou Pix sem hold com chaves `proposal.book:` / `proposal.pix:`. Janela 24 h fechada → handoff à equipe sem envio irregular (template de proposta com botões: **Em aberto** — gate Meta staging).

## Eventos de interface propostos

| Evento lógico | Quando ocorre | Visões afetadas |
| --- | --- | --- |
| Conversa criada/atribuída/encerrada | Após persistir a mudança. | Caixa de entrada e detalhe da conversa. |
| Mensagem recebida ou estado alterado | Após persistir a mensagem ou atualização do provedor. | Detalhe e lista de conversas. |
| Etapa da oportunidade alterada | Após persistir a mudança e o histórico. | Pipeline e detalhe do contato. |
| Agendamento confirmado/cancelado/reagendado | Após persistir a alteração sem conflito. | Agenda, conversa e oportunidade. |
| Acesso revogado | Quando uma associação ou sessão perde validade. | Conexões e telas afetadas deixam de receber dados; nova leitura exige autorização. |

O payload deve conter somente o necessário para identificar a mudança. O servidor verifica o tenant antes de publicar e antes de entregar. Eventos podem chegar repetidos ou deixar de chegar; o cliente reconcilia com a API ao conectar ou reconectar. Um Durable Object por clínica com SQLite operacional está **Confirmado em DEC-038**; WebSockets com hibernação permanecem confirmados. Eventos operacionais saem após commit SQLite; eventos administrativos/de suporte partem do D1 e exigem propagação idempotente. Ver [ADR-0012](../adr/0012-clinic-durable-object-sqlite.md).

## Questões que bloqueiam estados finais

1. Quando encerrar ou reabrir conversa e oportunidade?
2. O que “Concluído” significa no pipeline e na agenda?
3. ~~Reserva temporária de horário proposto~~ Resolvida: não há (DEC-008).
4. ~~Regras de duração, buffers, expediente, bloqueios e fuso~~ Resolvida em DEC-008; falta carregar os valores reais da clínica piloto.
5. Que estados de entrega do WhatsApp serão exibidos quando o provedor não enviar confirmação?
