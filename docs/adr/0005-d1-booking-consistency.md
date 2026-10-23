# ADR-0005 — Consistência de reservas com recursos partilhados em D1

- **Estado:** Proposta técnica sujeita a prova de conceito com runtime D1, não decisão de esquema aprovado.
- **Origem:** [DEC-014](../product/decisions.md), [REQ-030/031/032](../product/requirements.md).

## Problema

Um agendamento ocupa o profissional e a sala/equipamento requerido durante um intervalo. Se duas pessoas reservam o mesmo recurso ao mesmo tempo, apenas uma reserva pode ser confirmada. Uma verificação SELECT seguida de INSERT separado não é uma garantia suficiente.

## Abordagem candidata

Representar ocupações em linhas de alocação por recurso, no D1 da clínica ([ADR-0002](0002-d1-topology.md)), com tenant_id, recurso, início/fim efetivos (incluindo o intervalo após o atendimento definido pelo serviço, DEC-008) e referência ao compromisso. Usar uma restrição atómica na camada de banco para impedir intervalos sobrepostos. A primeira opção de prova de conceito são gatilhos SQLite que fazem RAISE(ABORT) para overlaps, combinados com D1 batch para gravar o agendamento, as ocupações, auditoria e outbox na mesma transação.

Proteger inserts **e updates**, não apenas criação inicial. Cancelamentos e remarcações libertam ou substituem ocupações de maneira atómica e auditada; se o novo horário falhar, manter o compromisso original.

## Alternativa

Alocação por intervalos discretos com índices UNIQUE(tenant_id, resource_id, slot_start), se os buffers e a granularidade da clínica piloto permitirem. Nunca discretizar silenciosamente tempos nem reduzir a duração solicitada.

## Condições para aceitação

Testes de concorrência real no D1 local/remoto de teste, sobreposição parcial, bordas adjacentes, vários recursos na mesma marcação, bloqueios, cancelamento, reagendamento e cruzamento de tenants. Confirmar comportamento de trigger e rollback de batch no ambiente escolhido. Nenhum evento de confirmação é enviado antes da transação ser concluída.

**Referências:** [modelo lógico](../architecture/data-model.md) e [API D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/).
