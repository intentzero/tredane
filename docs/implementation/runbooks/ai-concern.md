# Runbook — Preocupação com a IA

**Estado:** **Proposto** (30/10/2026). Canal para uma pessoa dizer que a IA fez algo errado. Não é o [incidente técnico](incidents.md): aqui o gatilho é uma preocupação, mesmo sem falha de fila ou de deploy.

## Quem pode reportar

- Atendente ou responsável, sobre uma sugestão, um resumo ou uma marcação.
- Cliente da clínica, pela atendente. A cliente não tem conta Tredane e não escreve neste canal direto.

## Caminho

1. A equipe descreve o caso com ids: clínica, conversa, sugestão ou proposta, horário do fato. Sem colar o corpo da mensagem, telefone, nome da cliente ou texto do modelo.
2. A responsável vê o caso. Se a preocupação for marcação nova indevida, ela pausa marcações novas em Clínica → Limites das automações. A pausa não apaga o compromisso já feito ([ai-autobook-kill-switch.md](ai-autobook-kill-switch.md)).
3. Se a clínica precisar do Tredane, o caminho é o pedido de suporte já existente: a responsável aprova, a sessão é temporária e auditada (DEC-029 a DEC-037).
4. Produto regista a preocupação no [registo do sistema de gestão](../../security/aims-register.md) como nota da NC relacionada, ou como NC nova se o caso não couber nas abertas. Engenharia só entra se o caso pedir correção de código já decidido.

## O que se regista

Ids, código do motivo, o que a equipe fez (pausou, corrigiu o horário à mão, descartou a sugestão). Não se regista o texto da conversa.

## Exemplos que entram aqui

- Sugestão com preço ou procedimento que não está no cadastro.
- Pergunta de saúde respondida no mérito.
- Marcação que a cliente diz não ter confirmado no botão.
- Resumo que a equipe não reconhece como a conversa.

Indisponibilidade da IA, fila e log do Gateway ficam no runbook de incidentes.
