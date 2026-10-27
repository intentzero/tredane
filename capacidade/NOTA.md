# Capacidade compartilhada (sala de bronzeamento) — proposta de UI

Mocks: `c01-agenda-ocupacao.png`, `c02-agendar-vagas.png`, `c03-config-capacidade.png` (390×844 @2x, dados fictícios). Gerador: `gen.py`.

## FATOS do repo
- Existe entidade de recurso: `RESOURCE_KINDS = ['professional','room','equipment']` (`src/clinic/constants.ts`); salas e equipamentos são editados em `ResourcesScreen.tsx` ("Nome da sala ou equipamento").
- O agendamento aloca recursos por linha em `allocations` (`resource_kind`, `resource_id`); slots carregam `roomResourceId`.
- Hoje não há campo de capacidade (nenhum `capacity` em `src/`). Conflito de sala = 1 ocupante.
- `/workspace/cornelio/capacidade/PROPOSTA.md` não existe; nomes não alinhados com proposta técnica. `/workspace/tredane/agendar/src/gen.py` não existe; estilo refeito a partir dos tokens 0.3.0.

## Decisões de UX
- Capacidade mora **na sala** (recurso `room`), campo «Atende ao mesmo tempo: N pessoas», stepper com alvos de 44 px, padrão 1.
- Agenda: cada horário mostra «3/5» + barra segmentada; toque expande a lista de clientes. Cheio = «Lotado 5/5» em tom de alerta (âmbar), não erro.
- Agendar: grade de 4 colunas mantida; célula mostra «N vagas» / «Última vaga» (âmbar); cheio fica desabilitado com «Lotado».
- Corrida (lotou entre ver e confirmar): banner «Esse horário lotou. Nada foi reservado.» + próximos horários com vaga como atalhos.

## Regra do horário cheio
Bloquear no piloto. Encaixe acima da capacidade com confirmação fica para depois (risco de sala superlotada e de regra ambígua na IA do WhatsApp).

## Capacidade 1 = hoje
Com N=1 nada muda: sem «1/1», sem barra, sem «vagas»; slot ocupado some/indisponível como hoje. Os novos elementos só aparecem com N≥2.

## Perguntas para o Paulo
1. Capacidade fica na sala ou no serviço? (proposta: sala)
2. A profissional também limita? (ex.: 5 na sala, mas 1 aplicadora atende 2 por vez)
3. A mensagem de WhatsApp menciona que a sala é compartilhada / as vagas restantes?
