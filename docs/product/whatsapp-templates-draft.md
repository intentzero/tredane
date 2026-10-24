# Rascunhos de modelos WhatsApp (piloto)

**Estado:** **Proposto**, 24/10/2026. Textos para submissão à Meta após GATE-01/02 ([pilot-gates.md](pilot-gates.md)). **Não aprovados** pela Meta nem pela clínica. Nomes e valores são fictícios.

**Confirmado (DEC-040 / Q-UX-06):** no piloto, cadastrar modelos de **retomada de contato** e **confirmação de horário**; lembrete de consulta fica **posterior** (fora deste recorte).

**Confirmado (DEC-047):** cobrança de sinal por Pix fora da janela de 24 h usa modelo aprovado; texto final e aprovação Meta estavam **Em aberto** — este documento propõe o rascunho.

Categoria Meta, custo por conversa e nome interno do modelo: **não inventar**. Preencher só após consulta à tabela vigente da Meta e decisão de produto.

## Variáveis (proposta)

Usar nomes estáveis na implementação F3; a prévia no painel (M-12) mostra o aviso de custo antes do envio.

| Variável | Uso |
| --- | --- |
| `{{nome_contato}}` | Primeiro nome ou tratamento acordado (sem telefone) |
| `{{nome_clinica}}` | Nome público da clínica |
| `{{servico}}` | Nome do serviço |
| `{{data_hora}}` | Data e hora no fuso da clínica |
| `{{profissional}}` | Nome do profissional (se aplicável) |
| `{{valor_sinal}}` | Valor do sinal formatado em BRL |
| `{{prazo_pagamento}}` | Prazo para pagar (ex.: 2 horas) |
| `{{link_ou_codigo_pix}}` | Link ou instrução de Pix copia-e-cola fornecida pelo provedor |

## TMPL-01 — Retomada de contato

**Objetivo:** retomar conversa após > 24 h sem mensagem do contato.  
**Estado:** Proposto · **Aprovação Meta:** Pendente

```text
Olá, {{nome_contato}}! Aqui é a {{nome_clinica}}.
Podemos continuar seu atendimento? Responda esta mensagem para falarmos sobre horários e serviços.
```

**Notas:** tom cordial; sem promessa de resultado; sem dados de saúde. Ajustar com a clínica piloto antes de submeter.

## TMPL-02 — Confirmação de horário

**Objetivo:** confirmar compromisso já marcado (após sinal pago ou confirmação sem sinal).  
**Estado:** Proposto · **Aprovação Meta:** Pendente

```text
Olá, {{nome_contato}}! Seu horário na {{nome_clinica}} está confirmado.
Serviço: {{servico}}
Quando: {{data_hora}}
Profissional: {{profissional}}
Se precisar remarcar, responda esta mensagem.
```

**Notas:** não incluir endereço ou dados clínicos neste rascunho; validar com a clínica se o profissional deve aparecer.

## TMPL-03 — Cobrança de sinal por Pix

**Objetivo:** enviar pedido de sinal quando a janela de 24 h está fechada (DEC-047).  
**Estado:** Proposto · **Aprovação Meta:** Pendente · **Revisão jurídica/fiscal:** Pendente (GATE-11)

```text
Olá, {{nome_contato}}! Para garantir o horário de {{servico}} em {{data_hora}} na {{nome_clinica}}, pedimos um sinal de {{valor_sinal}} por Pix.
O prazo para pagar é {{prazo_pagamento}}. O horário só é reservado após o pagamento.
Política de cancelamento: a clínica informa a regra antes de você pagar; em caso de cancelamento, a equipe pode devolver ou reter o sinal conforme essa política.
Pagamento: {{link_ou_codigo_pix}}
Dúvidas? Responda esta mensagem.
```

**Notas:** o texto da política específica da clínica substitui a frase genérica acima antes da submissão. Requisitos de recibo/nota fiscal: pergunta 10 do [dossiê jurídico](legal-review-brief.md) — **não afirmar conformidade** até o parecer.

## Fora deste recorte

- Lembrete automático de consulta (**posterior**, Q-UX-06).
- Modelos de marketing em massa (**Fora do MVP**).
- Envio autónomo pela IA (**Fora do MVP**; DEC-006/040).

## Próximos passos humanos

1. Produto + clínica: validar tom e variáveis.
2. Jurídico: política de cancelamento e menções fiscais do sinal.
3. Engenharia: submeter na conta Meta após GATE-01/02; registar ID/estado em GATE-10.
4. Não usar estes textos em produção sem estado **Aprovado** na Meta e evidência em [pilot-gates.md](pilot-gates.md).
