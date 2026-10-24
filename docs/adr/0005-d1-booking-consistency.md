# ADR-0005 — Consistência de reservas com recursos partilhados

- **Estado:** garantia de consistência mantida; backend D1 proposto anteriormente substituído pelo SQLite do DO em DEC-038 / [ADR-0012](0012-clinic-durable-object-sqlite.md). Esquema/gatilhos finais seguem propostos até prova de conceito.
- **Origem:** [DEC-014](../product/decisions.md), [REQ-030/031/032](../product/requirements.md).

## Problema

Um agendamento ocupa o profissional e a sala/equipamento requerido durante um intervalo. Se duas pessoas reservam o mesmo recurso ao mesmo tempo, apenas uma reserva pode ser confirmada. Uma verificação SELECT seguida de INSERT separado não é uma garantia suficiente.

## Abordagem candidata

Representar ocupações em linhas de alocação por recurso, com tenant_id, recurso, início/fim efetivos (incluindo buffers) e referência ao compromisso. Usar uma restrição atómica na camada de banco para impedir intervalos sobrepostos. A primeira opção de prova de conceito são gatilhos SQLite que fazem RAISE(ABORT) para overlaps, combinados com transação SQLite local via API do storage do DO (transactionSync quando aplicável) para gravar o agendamento, as ocupações, auditoria e outbox na mesma transação.

Proteger inserts **e updates**, não apenas criação inicial. Cancelamentos e remarcações libertam ou substituem ocupações de maneira atómica e auditada; se o novo horário falhar, manter o compromisso original.

## Alternativa

Alocação por intervalos discretos com índices UNIQUE(tenant_id, resource_id, slot_start), se os buffers e a granularidade da clínica piloto permitirem. Nunca discretizar silenciosamente tempos nem reduzir a duração solicitada.

## Condições para aceitação

Testes de concorrência real através do DO com SQLite local/ambiente de teste, sobreposição parcial, bordas adjacentes, vários recursos na mesma marcação, bloqueios, cancelamento, reagendamento e cruzamento de tenants. Confirmar comportamento de trigger e rollback da transação SQLite no ambiente escolhido. Nenhum evento de confirmação é enviado antes da transação ser concluída.

**Referências:** [modelo lógico](../architecture/data-model.md) e [API de storage SQLite do DO](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/).


**Histórico:** o desenho anterior usava D1 batch. DEC-038 substitui esse mecanismo, sem enfraquecer a prevenção de conflitos. Nenhuma chamada externa ocorre dentro da transação de reserva; single-threaded não substitui atomicidade.
