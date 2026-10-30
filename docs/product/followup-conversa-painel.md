# Acompanhamento do painel depois da conversa — Proposto

**Estado:** **Proposto** (30/10/2026). Evidência: [sonda de staging](../security/staging-conversational-probe-2026-10-30.md). Não entra no mesmo diff da pausa da IA (DEC-083). Nada disto está confirmado como comportamento obrigatório.

A sonda cancelou os dois horários de teste. A agenda ficou vazia. O resto do painel não acompanhou.

## Etapa depois de cancelar

Acompanhar permaneceu em **Agendado**, com o vínculo da segunda 15:00 já cancelada. O histórico de etapas parou em «Compromisso confirmado pelo botão do WhatsApp». [src/clinic/scheduling/booking.ts](../../src/clinic/scheduling/booking.ts) grava `appointment.cancelled` e não altera a oportunidade.

**Proposto:** ao cancelar o compromisso ligado, a etapa deixa de mostrar um horário futuro. O histórico do compromisso cancelado permanece. Falta decidir se a etapa volta a Em atendimento ou fica num estado próprio de cancelado. DEC-040 permite Agendado sem compromisso, com aviso; o cartão da sonda não mostrou esse aviso.

## Aviso no WhatsApp

REQ-033 ainda é **Proposto**: a equipe pode comunicar cancelamento ou mudança, e a falha da mensagem não reverte o horário. Na sonda, o cancelamento no painel não enviou nada. A cliente continuou a ler a confirmação das 10:00.

**Proposto:** o cancelamento com motivo oferece envio de uma frase fixa na janela de 24 h, com estado de envio separado do estado do compromisso. Sem sinal, não há estorno (DEC-047).

## Reagendar que move

O botão Reagendar do compromisso abriu `/agenda/agendar` como marcação nova, sem contato. O Agendar da conversa, esse sim ligado ao Paulo, criou um segundo horário e deixou o primeiro no lugar. A revisão omitiu género da zona e preço. O cartão de sucesso omitiu a sala, que a revisão tinha mostrado.

**Proposto:** Reagendar move o mesmo compromisso (zona, preço, profissional e sala, salvo escolha explícita), liberta o bloco antigo e só grava o novo se não houver conflito. Conflito não apaga o anterior (REQ-032).

## Cópia da IA

O bloco do resumo dizia «Gerado sob demanda — a IA não envia mensagens». O resumo continua sob demanda. As respostas de agendamento saem sozinhas. A frase do painel foi ajustada para não negar esse envio. O restante desta página continua **Proposto**.
