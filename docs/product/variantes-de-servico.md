# Variantes do serviço — DEC-078 e DEC-079

**Confirmado** (Paulo, 29/10/2026, «implementa o epico», [issue #293](https://github.com/intentzero/tredane/issues/293)). A issue citava DEC-075; no repositório a DEC-075 é salas e audiência. Esta decisão é a DEC-078. Não revive a duração ajustável (DEC-076).

**Confirmado (DEC-079, Paulo, 30/10/2026).** O tipo não é «zona». O serviço define o tipo no singular e no plural, texto livre, e cada variante tem género masculino, feminino ou ambos. Uma variante usa o singular; várias usam o plural. Na mesma visita, ambos combina com qualquer um; masculino e feminino juntos são recusados e nada é gravado. A audiência do serviço (DEC-075) e a ausência de sexo no contacto mantêm-se. Com variantes, o singular e o plural são obrigatórios; sem variantes, os dois limpam. Variantes já gravadas ficam ambos. A cópia da visita inclui o género. As tabelas `service_zones` e `visit_zone_snapshots` não se renomeiam.

**Confirmado (Paulo, 30/10/2026, pedido para publicar o catálogo).** A ficha alterna Opção única e Com variantes. Com variantes, a duração e o preço da linha saem da tela. O plural começa sugerido na ficha e fica gravado quando a responsável salva; sem variantes, singular e plural limpam. «Em uso» e «Fora de uso» não dependem do género da palavra. A audiência do serviço não esconde variantes. Combos de variantes continuam **Em aberto**.

Exemplos fictícios. Nenhum dado de paciente ou clínica real.

## O que fica no serviço

Quem atende, sala, janela semanal, intervalo, explicação e regra de sinal (DEC-047) continuam no serviço. Cada zona tem duração em minutos inteiros de 1 a 24 h (Paulo, 30/10/2026), preço opcional, ativo e ordem. **Revisão (Paulo, 30/10/2026):** o nome pode repetir. Duas variantes só são a mesma quando coincidem nome, género, duração e preço; qualquer diferença nesses três grava as duas. A grade de início do horário continua de 15 em 15 minutos. Só a responsável grava (DEC-042). A atendente lê. Outra clínica não lê nem grava.

A primeira zona, com o catálogo vazio e duração ou preço omitidos, copia a linha do serviço. Preço explícito vazio fica sem preço. Com alguma zona gravada, marcação nova não usa a duração nem o preço da linha. Se todas as zonas estão inativas, não há marcação nova. Desativar não cancela o já marcado. Se nenhuma zona entrou em visita, proposta ou cobrança, a responsável pode removê-las e o serviço volta à linha. Zona já usada não se apaga: a cópia fica. Editar a zona não reescreve compromissos.

## A visita

Um compromisso, um bloco contínuo: soma das durações escolhidas mais o intervalo do serviço uma vez. A busca de horários recebe essa duração; o servidor recalcula na confirmação. O bloco inteiro cabe na profissional, na sala, na janela do serviço e na capacidade (DEC-008, DEC-014, DEC-059). Cada zona no máximo uma vez. Zona de outro serviço ou clínica é recusada e nada é gravado. Sem folga entre zonas, sem misturar serviços, sem profissional ou sala por zona, sem desconto de pacote além dos combos (DEC-080) e sem «a partir de».

O compromisso guarda nome, duração e preço de cada zona. A agenda mostra «Depilação · Axila, Meia perna», na ordem do catálogo. Reagendar mantém o conjunto. Trocar zonas revalida o bloco; o compromisso antigo só muda quando o novo é confirmado, na mesma transação.

A reserva por período («Por período») continua com a duração do bloco e sem zonas, nos serviços que não têm zonas. Serviço com zonas exige as zonas escolhidas.

## Preço e sinal

O preço da visita é a soma só quando todas as zonas escolhidas têm preço. Senão a visita não tem preço citável. Sinal fixo: o valor do serviço, uma vez. Sinal em porcentagem: porcentagem da soma; sem soma, o envio fica indisponível e o motivo aparece. Uma cobrança por visita. O texto lista as zonas e o total. O horário não fica reservado antes do pagamento. «Pago sem horário» oferece outro horário para o mesmo conjunto e o mesmo bloco. A cobrança guarda a cópia das zonas e do preço usado.

## IA e proposta

O contexto lista o serviço e cada zona ativa: nome, duração, preço ou «sem preço». A explicação é a do serviço, uma vez. Se a cliente cita só o serviço, a sugestão pergunta as zonas e não diz valor. Qualquer outro número que não seja a soma do backend não vale.

**Confirmado (Paulo, 31/10/2026, detalhe de DEC-078 e DEC-075).** Se as variantes ativas têm audiência feminina e masculina, a primeira pergunta determinística no WhatsApp é a linha, com o nome do serviço: «Depilação feminina ou masculina?». Só depois de a pessoa escolher a linha se listam as zonas dessa audiência (e as de ambos), cada nome uma vez. O mesmo nome na mesma audiência aparece uma vez por variante, com rótulo estável (género, duração e, se ainda coincidir, o preço). Uma só audiência salta a pergunta e lista as zonas únicas. A pergunta usa o singular em minúsculas («qual zona», não «qual Zonas»). A linha só vale se a pessoa escreveu feminina, feminino, masculina ou masculino neste turno, ou se essa escolha já está na sessão de agendamento da conversa. Não se infere pelo nome do contacto, pelo histórico nem por marcações antigas, e não se grava sexo na ficha. A mesma sessão guarda o dia e o período já ditos (manhã, tarde ou noite). «Quero depilação na segunda à tarde.» responde «Depilação feminina ou masculina?» e segue com Depilação, segunda e tarde. A pergunta da linha só aparece quando é isso que falta para continuar, e não no início da conversa antes de um serviço. O botão «Falar com a equipe» mantém-se. Texto livre não marca (DEC-061). Sem re-cumprimentar se a clínica já falou (REQ-022). A proposta versionada (DEC-061, REQ-083) mostra as zonas, o início e o fim do bloco e a soma ou a ausência de preço. Mudar o conjunto é mudança material: nova versão, a anterior deixa de valer. O clique confirma aquele conjunto. Uma visita conta como um compromisso e uma proposta nos limites de abuso já existentes.

Serviço sem zonas não muda: duração do cadastro (DEC-076), preço, sinal fixo e percentual, proposta e sugestão de preço (AC-41, AC-55).

## Combos (DEC-080)

**Confirmado (Paulo, 30/10/2026, «concordo»).** Um combo é um conjunto de 2 ou mais variantes do mesmo serviço, sem misturar masculino e feminino, com nome, preço próprio e ativo/inativo. Só a responsável grava. O combo **entra sozinho** quando a cliente escolhe todas as variantes dele; vale **um por visita** (o de maior desconto) e as outras variantes saem pelo preço normal. O combo **só vale** se todas as suas variantes estão em uso e têm preço e se ele sai **mais barato** que a soma atual; se o preço de uma variante muda e deixa de compensar, o combo deixa de se aplicar e o painel avisa.

O total da visita é o do servidor (`quoteVisit`). O sinal em porcentagem usa esse total; o fixo não muda. A proposta mostra «Preço: R$ 70,00 (combo Buço + axila, economia de R$ 15,00)». A visita, a proposta e a cobrança guardam o nome, o preço do combo e a soma sem desconto; editar o combo não reescreve compromissos, e uma proposta aberta cujo total mudou fica desatualizada (nova versão). O contexto da IA lista os combos que valem hoje, e o valor final continua o do servidor. Combo usado não se apaga, só se desativa; tirar uma variante do catálogo tira-a dos combos, e o combo com menos de 2 variantes é apagado (ou desativado, se já foi usado).

Fora: pacotes de sessões, combos entre serviços, desconto percentual, combos que se somam, «a partir de».

## Requisitos

REQ-085 a REQ-088 e REQ-095 (combos). Aceite AC-57 a AC-60 e AC-69. Migrações do SQLite da clínica: `0034_service_zones` e `0040_service_combos` (combos).
