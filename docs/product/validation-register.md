# Registro de hipóteses e validações do MVP

**Estado:** hipóteses expressamente **não validadas**; nenhum item é afirmação de comportamento aprovado. **Data:** 23/10/2026. Registra *quem* deve resolver e *quando*, sem duplicar a fonte de verdade em [decisões](decisions.md). Ao resolver, atualizar o DEC/REQ/JRN relacionado e anotar evidência.

| ID | Hipótese / questão | Responsável | Gate / quando validar | Referências |
| --- | --- | --- | --- | --- |
| VAL-01 | O atendimento da clínica piloto começa principalmente pelo WhatsApp e pode ser operado por atendente e responsável; a visibilidade de todas as conversas é suficiente | Produto + clínica piloto | Entrevista e observação antes de aprovar UX da Inbox | JRN-01/02/04, REQ-020 |
| VAL-02 | Pipeline inicial (novo contato → em atendimento → horário proposto → agendado → concluído/perdido) corresponde ao ciclo real; um contato pode ter múltiplas oportunidades | Produto + clínica piloto | Antes de fixar estados e migrações de oportunidades | JRN-03, REQ-023, states.md |
| VAL-03 | Serviço tem duração, profissional e sala/equipamento; buffers, expediente, bloqueios e política de reagendamento serão suficientes para prevenir conflitos | Produto + clínica piloto | Antes de implementar confirmação final da agenda | DEC-008, REQ-030/031/032 |
| VAL-04 | Onboarding de WhatsApp da clínica poderá ser assistido pela equipe Tredane; autoridade sobre a conta Meta e número pertence ao fluxo acordado | Produto + clínica piloto / integração | Antes de associar números reais | DEC-009, REQ-050/051 |
| VAL-05 | A IA oferece benefício mesmo sem autonomia, com sugestões/revisão humana e resumo da conversa; não recebe dados desnecessários | Produto + clínica piloto / política de dados | Antes de enviar mensagens reais para provedor IA | DEC-006/011, REQ-022/060 |
| VAL-06 | D1 compartilhado com `tenant_id` é suficiente no primeiro piloto; não há requisito de banco individual | Arquitetura + produto | Antes de migração remota ou dados reais; ADR-0002 aberto | DEC-010, ADR-0002 |
| VAL-07 | **Decidido:** superadmin atribui primeiro owner, que convida/remove attendants. **A validar:** mecanismo, prova de posse do convite, expiração/reenvio e revogação imediata em HTTP/WS. | Produto + arquitetura | Antes da F1 de identidade real | DEC-007/020, REQ-003/004/005 |
| VAL-08 | Para manutenção será permitido o modo suporte próprio: auditoria de actor/subject, prazo curto e primeiro incremento de leitura/diagnóstico | Produto + revisão de segurança + clínica piloto | Antes de impersonação sobre dados reais | DEC-019, REQ-007, ADR-0007 |
| VAL-09 | Campos mínimos de contato, mensagens e anexos satisfazem operação; políticas de retenção/exclusão e logs poderão ser acordadas com a clínica | Produto + responsável por privacidade + clínica piloto | Antes de recolher/guardar dados reais | DEC-011, REQ-010/011/070 |
| VAL-10 | React atende ao uso em desktop e mobile sem aplicativo nativo; condições de uso e dispositivos da recepção devem ser observados | Produto + clínica piloto | Antes de aprovar requisitos de usabilidade | REQ-020/034/042 |
| VAL-11 | Confirmação/cancelamento por WhatsApp manual após agendamento é aceitável; lembretes e bots não precisam ser autónomos no primeiro piloto | Produto + clínica piloto | Antes de ativar mensagens reais e lembretes | REQ-033, JRN-03/05 |
| VAL-12 | O suporte a mais de uma clínica por usuário precisa de seletor por aba/contexto e papéis distintos, sem copiar estado de sessão ou conteúdo entre tenants | Arquitetura + produto | Antes da F1 multi-tenant real; testes A/B | DEC-017, REQ-005, JRN-09 |

**Atualização DEC-021:** está confirmado o convite por e-mail de uso único para attendants, aceite por login Clerk com e-mail verificado, com dados no D1. Na hipótese VAL-07, a escolha do mecanismo deixa de estar em aberto; faltam prazo/reenvio, canal de entrega, revogação HTTP/WebSocket e testes de segurança.

## Evidência mínima a recolher com a clínica piloto

- Jornada real desde chegada da mensagem até agendamento e resposta de confirmação.
- Lista de serviços e durações; quais profissionais, salas/equipamentos podem coincidir; bloqueios, intervalos e cancelamentos.
- Quem precisa entrar no painel, em quais aparelhos, e quem pode configurar serviços/membros/número.
- Situações frequentes de conversa sem resposta, horário recusado, cancelamento, ausência e recontacto.
- Restrições da clínica ao acesso da equipe de suporte e processamento por IA.
- Regras de dados pessoais/anexos, consentimentos e prazos de conservação com revisão apropriada.

**Critério de saída:** cada hipótese passa a Confirmada ou Rejeitada com data/origem, ou permanece explicitamente Em aberto com motivo e gate. Não converter estas hipóteses em requisitos definitivos antes de revisão.
