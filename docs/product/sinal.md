# Sinal por Pix para confirmar agendamento

**Estado:** comportamento **Confirmado** pelo responsável pelo produto em 24/10/2026 ([DEC-047](decisions.md)), incluindo confirmação automática, prazo de 2 h e confirmar sem sinal; provedor de Pix **Confirmado: Woovi (OpenPix)** ([DEC-049](decisions.md), [ADR-0014](../adr/0014-pix-provider.md)); telas **Propostas** (TEL-11, M-31 a M-33). Muda a decisão anterior “pagamentos fora do MVP”: **o sinal por Pix entra no MVP**; qualquer outro pagamento continua fora. Dinheiro real continua bloqueado por DPA/jurídico e taxas contratuais; o adaptador simulado permanece até o adaptador real (#37+).

## Objetivo

Permitir que a clínica peça um sinal por Pix para garantir um horário e reduzir faltas, sem que o Tredane receba ou repasse dinheiro.

## Decisões (DEC-047, DEC-049)

| Item | Estado |
| --- | --- |
| Entra no MVP (antes: pagamentos fora do MVP) | **Confirmado** |
| O dinheiro vai direto para a conta da clínica no provedor; o Tredane só cria a cobrança, acompanha o pagamento e pede estorno pelo provedor | **Confirmado** |
| Meio de pagamento: **Pix**. Cartão e outros meios ficam fora do MVP | **Confirmado** |
| O horário **não é reservado** enquanto o sinal não é pago | **Confirmado** |
| Pago, mas o horário já foi ocupado: a cobrança fica **paga sem horário**, a equipe recebe alerta, oferece outro horário e, se a cliente recusar, a clínica devolve o Pix | **Confirmado** |
| Valor definido **por serviço**: a responsável liga “exige sinal” e escolhe valor fixo ou percentual do preço | **Confirmado** |
| Cancelamento depois do pagamento: a clínica escreve sua política; a equipe escolhe devolver ou reter, com motivo registrado; a política aparece para a cliente antes de pagar | **Confirmado** |
| Provedor escolhido por avaliação na F0 | **Confirmado** o método (DEC-047); escolha **Confirmado: Woovi (OpenPix)** (DEC-049 / [ADR-0014](../adr/0014-pix-provider.md)); Mercado Pago permanece alternativa documentada |
| Ao receber o pagamento, o Tredane confirma o compromisso **se o horário ainda estiver livre**, sem nova ação da equipe (regra do sistema, não da IA) | **Confirmado** (24/10/2026) |
| Prazo padrão para pagar: **2 horas**; a responsável pode mudá-lo em Recebimento de sinais (M-33) | **Confirmado** (24/10/2026) |
| A atendente pode **Confirmar sem sinal** um serviço que exige sinal, informando o motivo; o histórico guarda quem fez e o motivo | **Confirmado** (24/10/2026) |

## Fluxo principal (JRN-16)

1. A atendente escolhe serviço, profissional, sala e horário na tela Agendar (M-04). Se o serviço exige sinal, o botão principal passa a ser **Enviar sinal de R$ X**.
2. O Tredane cria a cobrança Pix no provedor, na conta da clínica, e envia na conversa uma mensagem com o valor, o horário pretendido, o prazo para pagar, a política de cancelamento e o link ou o código Pix copia-e-cola. Fora da janela de 24 h, o envio usa um modelo aprovado pela Meta (DEC-040).
3. A conversa e a etapa do contato mostram **Aguardando sinal**. O horário continua livre para outras pessoas.
4. O provedor avisa o pagamento (webhook). O Tredane valida o aviso, marca a cobrança como **Paga** e:
   - se o horário ainda estiver livre, confirma o compromisso (Confirmado, acima) e avisa a equipe em tempo real;
   - se o horário foi ocupado, marca **Pago sem horário** e mostra o alerta (M-32).
5. A atendente envia a confirmação à cliente pelo fluxo normal de mensagem.

## Alternativas e erros

- **Prazo vencido sem pagamento:** a cobrança passa a **Expirada** e não aceita mais pagamento; a etapa volta a Horário proposto. Um novo envio cria nova cobrança. Prazo padrão de 2 horas, ajustável pela responsável.
- **Cancelar a cobrança antes do pagamento:** a atendente cancela; a cobrança fica **Cancelada** no provedor e na conversa.
- **Pago sem horário:** alerta para a equipe, com **Escolher outro horário** e **Devolver sinal**.
- **Cancelamento depois de pago:** o diálogo de cancelamento (motivo obrigatório, DEC-008) pergunta **Devolver** ou **Reter sinal**, mostrando a política da clínica.
- **Estorno:** pedido ao provedor; estados **Estorno solicitado**, **Devolvido** ou **Estorno falhou** (com **Tentar de novo**).
- **Aviso duplicado ou fora de ordem do provedor:** processado uma única vez por identificador da cobrança (idempotência); um aviso de pago após expiração vira **Pago sem horário**.
- **Provedor fora do ar:** “Não foi possível criar a cobrança agora. Tente de novo ou marque sem sinal.” A atendente pode usar **Confirmar sem sinal**, com motivo registrado.
- **Clínica sem conta de recebimento conectada:** serviços com sinal ficam bloqueados para envio de cobrança, com aviso para a responsável.

## Isolamento entre clínicas

- Cada clínica conecta a própria conta no provedor (M-33); credenciais ficam cifradas e só são usadas pelo backend daquela clínica.
- Cada cobrança carrega o tenant e o compromisso; o webhook é validado pela assinatura do provedor e roteado ao Durable Object da clínica dona da cobrança. Aviso de cobrança desconhecida ou de outra clínica é recusado e registrado.
- Eventos em tempo real de pagamento vão só para membros ativos da clínica.

## Tempo real

Eventos: `cobranca.criada`, `cobranca.paga`, `cobranca.expirada`, `cobranca.cancelada`, `cobranca.sem_horario`, `estorno.atualizado`. Atualizam conversa, Acompanhamento e agenda. Ao reconectar, a interface busca o estado atual das cobranças abertas.

## IA

A IA **não cria, cancela nem devolve** cobranças. Pode mencionar na sugestão que o serviço exige sinal e o valor cadastrado (DEC-046); a cobrança só é criada pela atendente.

## Dados pessoais

Ficam no Tredane: valor, estado, identificador da cobrança no provedor, horários e quem fez cada ação. **Não** ficam: dados bancários ou chave Pix da cliente além do que o provedor devolver como necessário para estorno (a definir com o provedor). O provedor é um novo terceiro no [dossiê jurídico](legal-review-brief.md).

## Requisitos e aceite

REQ-076 a REQ-082; AC-44 a AC-51 ([requisitos](requirements.md), [aceite](acceptance.md)).

## Em aberto

| Pergunta | Quem decide | Bloqueia |
| --- | --- | --- |
| DPA, papel do Tredane e taxas contratuais finais com Woovi | Jurídico + produto; revalidar notas públicas de taxa antes do piloto ([ADR-0014](../adr/0014-pix-provider.md)) | Dinheiro real e adaptador real em produção; **não** bloqueia testes com `SimulatedPixAdapter` |
| Texto do modelo de WhatsApp com a cobrança e aprovação na Meta | Responsável pelo produto | Envio fora da janela de 24 h; rascunho TMPL-03 em [whatsapp-templates-draft.md](whatsapp-templates-draft.md); GATE-10 |
| Requisitos fiscais e contratuais do sinal (recibo, nota) e revisão jurídica | Advogado | Uso com clientes reais; GATE-11 em [pilot-gates.md](pilot-gates.md) |
