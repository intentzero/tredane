# Variantes do serviço — DEC-078 e DEC-079

**Confirmado** (Paulo, 29/10/2026, «implementa o epico», [issue #293](https://github.com/intentzero/tredane/issues/293)). A issue citava DEC-075; no repositório a DEC-075 é salas e audiência. Esta decisão é a DEC-078. Não revive a duração ajustável (DEC-076).

**Confirmado (DEC-079, Paulo, 30/10/2026).** O tipo não é «zona». O serviço tem um único nome de tipo, texto livre, e cada variante tem género masculino, feminino ou ambos. Na mesma visita, ambos combina com qualquer um; masculino e feminino juntos são recusados e nada é gravado. A audiência do serviço (DEC-075) e a ausência de sexo no contacto mantêm-se. Com variantes, o tipo é obrigatório; sem variantes, o tipo limpa. Variantes já gravadas ficam ambos. A cópia da visita inclui o género. As tabelas `service_zones` e `visit_zone_snapshots` não se renomeiam.

Exemplos fictícios. Nenhum dado de paciente ou clínica real.

## O que fica no serviço

Quem atende, sala, janela semanal, intervalo, explicação e regra de sinal (DEC-047) continuam no serviço. Cada zona tem nome único naquele serviço, duração múltipla de 15 minutos, preço opcional, ativo e ordem. Só a responsável grava (DEC-042). A atendente lê. Outra clínica não lê nem grava.

A primeira zona, com o catálogo vazio e duração ou preço omitidos, copia a linha do serviço. Preço explícito vazio fica sem preço. Com alguma zona gravada, marcação nova não usa a duração nem o preço da linha. Se todas as zonas estão inativas, não há marcação nova. Desativar não cancela o já marcado. Se nenhuma zona entrou em visita, proposta ou cobrança, a responsável pode removê-las e o serviço volta à linha. Zona já usada não se apaga: a cópia fica. Editar a zona não reescreve compromissos.

## A visita

Um compromisso, um bloco contínuo: soma das durações escolhidas mais o intervalo do serviço uma vez. A busca de horários recebe essa duração; o servidor recalcula na confirmação. O bloco inteiro cabe na profissional, na sala, na janela do serviço e na capacidade (DEC-008, DEC-014, DEC-059). Cada zona no máximo uma vez. Zona de outro serviço ou clínica é recusada e nada é gravado. Sem folga entre zonas, sem misturar serviços, sem profissional ou sala por zona, sem desconto de pacote e sem «a partir de».

O compromisso guarda nome, duração e preço de cada zona. A agenda mostra «Depilação · Axila, Meia perna», na ordem do catálogo. Reagendar mantém o conjunto. Trocar zonas revalida o bloco; o compromisso antigo só muda quando o novo é confirmado, na mesma transação.

A reserva por período («Por período») continua com a duração do bloco e sem zonas, nos serviços que não têm zonas. Serviço com zonas exige as zonas escolhidas.

## Preço e sinal

O preço da visita é a soma só quando todas as zonas escolhidas têm preço. Senão a visita não tem preço citável. Sinal fixo: o valor do serviço, uma vez. Sinal em porcentagem: porcentagem da soma; sem soma, o envio fica indisponível e o motivo aparece. Uma cobrança por visita. O texto lista as zonas e o total. O horário não fica reservado antes do pagamento. «Pago sem horário» oferece outro horário para o mesmo conjunto e o mesmo bloco. A cobrança guarda a cópia das zonas e do preço usado.

## IA e proposta

O contexto lista o serviço e cada zona ativa: nome, duração, preço ou «sem preço». A explicação é a do serviço, uma vez. Se a cliente cita só o serviço, a sugestão pergunta as zonas e não diz valor. Qualquer outro número que não seja a soma do backend não vale. A proposta versionada (DEC-061, REQ-083) mostra as zonas, o início e o fim do bloco e a soma ou a ausência de preço. Mudar o conjunto é mudança material: nova versão, a anterior deixa de valer. O clique confirma aquele conjunto. Uma visita conta como um compromisso e uma proposta nos limites de abuso já existentes.

Serviço sem zonas não muda: duração do cadastro (DEC-076), preço, sinal fixo e percentual, proposta e sugestão de preço (AC-41, AC-55).

## Requisitos

REQ-085 a REQ-088. Aceite AC-57 a AC-60. Migração do SQLite da clínica: `0034_service_zones`.
