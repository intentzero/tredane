# Acompanhamento do painel depois da conversa

**Estado:** a etapa depois de cancelar está **Confirmada** (DEC-092). O aviso de cancelamento no WhatsApp está **Confirmado** (DEC-095). Reagendar move o mesmo compromisso (**Confirmado**, DEC-096) e, dentro da janela de 24 h, avisa a cliente (**Confirmado**, DEC-097). Evidência: [sonda de 30/10](../security/staging-conversational-probe-2026-10-30.md) e [sonda de 31/10](../security/staging-conversational-probe-2026-10-31.md).

A sonda cancelou os dois horários de teste. A agenda ficou vazia. O resto do painel não acompanhou.

## Etapa depois de cancelar

Acompanhar permaneceu em **Agendado**, com o vínculo da segunda 15:00 já cancelada. O histórico de etapas parou em «Compromisso confirmado pelo botão do WhatsApp». [src/clinic/scheduling/booking.ts](../../src/clinic/scheduling/booking.ts) grava `appointment.cancelled` e não altera a oportunidade.

**Confirmado (DEC-092, Paulo, 31/10/2026; revisão no mesmo dia):** se ainda houver outro horário futuro confirmado, a etapa permanece **Agendado** e o próximo compromisso aponta para esse. Se o cancelado era o último, a etapa volta a **Em atendimento** e o próximo compromisso fica «Sem horário marcado», salvo o motivo **Não compareceu**: nesse caso o cartão vai para **Concluído** e mostra «Não compareceu» com a data. O histórico do compromisso cancelado permanece na agenda. Não nasce etapa «Cancelado». A DEC-040 (Agendado sem compromisso, por mudança manual, com aviso) mantém-se e não é o caminho do cancelamento.

## Aviso no WhatsApp

Na sonda, o cancelamento no painel não enviou nada. A cliente continuou a ler a confirmação das 10:00.

**Confirmado (DEC-095, Paulo, 31/10/2026):** ao cancelar no painel, dentro da janela de 24 h, sai sozinha uma frase fixa com o dia e que o horário foi cancelado, sem o motivo interno e sem falar de estorno. A falha da mensagem não desfaz o cancelamento. Fora da janela o texto livre não sai. O modelo da Meta para esse aviso continua **Em aberto** (Paulo, 31/10/2026, «ok»): não bloqueia o piloto e não se inventa o envio antes de um modelo aprovado.

## Reagendar que move

O botão Reagendar do compromisso abriu `/agenda/agendar` como marcação nova, sem contato. O Agendar da conversa, esse sim ligado ao Paulo, criou um segundo horário e deixou o primeiro no lugar. A revisão omitiu género da zona e preço. O cartão de sucesso omitiu a sala, que a revisão tinha mostrado.

**Confirmado (DEC-096, Paulo, 31/10/2026):** Reagendar move o mesmo compromisso. Abre o Agendar já preenchido com contacto, zona, preço, profissional e sala; a equipe pode trocar o que escolher. O bloco antigo só fica livre quando o novo cabe. Conflito não apaga o anterior (REQ-032).

**Confirmado (DEC-097, Paulo, 31/10/2026, «ok»):** quando esse reagendamento conclui, dentro da janela de 24 h sai sozinha «O horário passou de {dia antigo} às {hora} para {dia novo} às {hora}.» A falha não desfaz a mudança. Fora da janela o painel diz que o aviso não foi enviado. O modelo da Meta continua **Em aberto**, como no cancelamento. A confirmação de horário novo não ganha uma terceira mensagem.

## Cópia da IA

O bloco do resumo dizia «Gerado sob demanda — a IA não envia mensagens». O resumo continua sob demanda. As respostas de agendamento saem sozinhas. A frase do painel foi ajustada para não negar esse envio.
