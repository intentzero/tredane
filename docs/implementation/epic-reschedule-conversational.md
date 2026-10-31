# Épico — Reagendamento conversacional (DEC-091)

**Estado:** Confirmado (Paulo, 31/10/2026). Evidência: pedido «Posso reagendar para quarta?» após horário já marcado caía em «qual zonas».

## Objectivo

Com compromisso confirmado futuro no contacto, detectar remarcação, manter serviço/variantes, oferecer disponibilidade e confirmar só pelo botão DEC-061, via `rescheduleAppointmentOp` (mesmo id).

## Fora

- Cancelar / desmarcar → handoff humano (DEC-083).
- Remarcar sem compromisso futuro → handoff humano.
- Segundo calendário ou cancel+create paralelo.

## Fatias

| Fatia | Conteúdo |
| --- | --- |
| Docs | DEC-091, REQ-101, resumo MVP |
| Detecção + copy | Regex + compromisso futuro; oferta de slots / sem vagas |
| Proposta replace | `replaces_appointment_id`; clique → reagendamento atómico |
| Testes | Turno do screenshot; sem pergunta de zonas |

## Aceite (AC-75)

1. Com depilação marcada e «Posso reagendar para quarta?», a resposta lista horários (ou pede outro dia) e **não** pergunta zonas.
2. Escolha de horário + Confirmar no botão move o compromisso existente; não cria segundo id.
3. «Quero cancelar» continua com frase de equipe e pausa da IA.
