# Registro de hipóteses e validações do MVP

**Estado:** hipóteses expressamente **não validadas**; nenhum item é afirmação de comportamento aprovado. **Data:** 23/10/2026. Registra *quem* deve resolver e *quando*, sem duplicar a fonte de verdade em [decisões](decisions.md). Ao resolver, atualizar o DEC/REQ/JRN relacionado e anotar evidência.

| ID | Hipótese / questão | Responsável | Gate / quando validar | Referências |
| --- | --- | --- | --- | --- |
| VAL-01 | O atendimento da clínica piloto começa principalmente pelo WhatsApp e pode ser operado por atendente e responsável; a visibilidade de todas as conversas é suficiente | Produto + clínica piloto | Entrevista e observação antes de aprovar UX da Inbox | JRN-01/02/04, REQ-020 |
| VAL-02 | Pipeline inicial (novo contato → em atendimento → horário proposto → agendado → concluído/perdido) corresponde ao ciclo real; um contato pode ter múltiplas oportunidades | Produto + clínica piloto | Antes de fixar estados e migrações de oportunidades | JRN-03, REQ-023, states.md |
| VAL-03 | Serviço tem duração, profissional e sala/equipamento; buffers, expediente, bloqueios e política de reagendamento serão suficientes para prevenir conflitos | Produto + clínica piloto | Antes de implementar confirmação final da agenda | DEC-008, REQ-030/031/032 |
| VAL-04 | Onboarding de WhatsApp da clínica poderá ser assistido pela equipe Tredane; autoridade sobre a conta Meta e número pertence ao fluxo acordado | Produto + clínica piloto / integração | Antes de associar números reais | DEC-009, REQ-050/051 |
| VAL-05 | A IA oferece benefício mesmo sem autonomia, com sugestões/revisão humana e resumo da conversa; não recebe dados desnecessários | Produto + clínica piloto / política de dados | Antes de enviar mensagens reais para provedor IA | DEC-006/011, REQ-022/060 |
| VAL-06 | **Topologia resolvida por DEC-038:** SQLite por DO/clínica + D1 central. **A validar:** capacidade, migrações, recuperação/reconciliação e revogação D1/DO; a hipótese anterior de D1 operacional compartilhado foi substituída. | Arquitetura + produto | Antes de migração remota ou dados reais | DEC-038, ADR-0012 |
| VAL-07 | **Decidido:** superadmin atribui primeiro owner, que convida/remove attendants. **A validar:** mecanismo, prova de posse do convite, expiração/reenvio e revogação imediata em HTTP/WS. | Produto + arquitetura | Antes da F1 de identidade real | DEC-007/020, REQ-003/004/005 |
| VAL-08 | **DEC-029 confirmada:** cada sessão de suporte exige aprovação de owner ativo do próprio tenant e auditoria de actor/subject/aprovador, inicialmente só leitura/diagnóstico. **DEC-030 confirmou painel em tempo real + e-mail informativo, decisão somente na Clinic App após Clerk login. DEC-031 fixa validade do pedido pendente em 24 horas. A validar:** continuação por nova solicitação, entregabilidade, UX, revogação e LGPD. | Produto + segurança + clínica piloto | Antes de dados reais | DEC-019/028/029, REQ-007, ADR-0007/0011 |
| VAL-09 | Campos mínimos de contato, mensagens e anexos satisfazem operação; políticas de retenção/exclusão e logs poderão ser acordadas com a clínica | Produto + responsável por privacidade + clínica piloto | Antes de recolher/guardar dados reais | DEC-011, REQ-010/011/070 |
| VAL-10 | React atende ao uso em desktop e mobile sem aplicativo nativo; condições de uso e dispositivos da recepção devem ser observados | Produto + clínica piloto | Antes de aprovar requisitos de usabilidade | REQ-020/034/042 |
| VAL-11 | Confirmação/cancelamento por WhatsApp manual após agendamento é aceitável; lembretes e bots não precisam ser autónomos no primeiro piloto | Produto + clínica piloto | Antes de ativar mensagens reais e lembretes | REQ-033, JRN-03/05 |
| VAL-12 | O suporte a mais de uma clínica por usuário precisa de seletor por aba/contexto e papéis distintos, sem copiar estado de sessão ou conteúdo entre tenants | Arquitetura + produto | Antes da F1 multi-tenant real; testes A/B | DEC-017, REQ-005, JRN-09 |

**Atualização DEC-021:** está confirmado o convite por e-mail de uso único para attendants, aceite por login Clerk com e-mail verificado, com dados no D1. Na hipótese VAL-07, a escolha do mecanismo deixa de estar em aberto; o prazo foi fixado em 7 dias (DEC-022); **DEC-023 confirmou reenvio com novo token e invalidação do anterior**; **DEC-024 fixou 10 minutos e 5 reenvios/24 horas** por tenant/e-mail; **DEC-025 confirmou cancelamento por qualquer owner do tenant**, com invalidação imediata do link; DEC-026 definiu a revogação imediata por tenant, sem logout Clerk; faltam canal de entrega, protocolo técnico seguro de WebSockets e testes de segurança.

**DEC-028 substitui DEC-027:** o MVP não terá MFA para nenhum perfil. Não exigir cadastro de fator, validação de MFA ou step-up nesta fase. Antes de operar dados reais, revisar segurança de Platform Admin e impersonação **sem MFA**, incluindo Clerk, autorização, proteção CSRF, handoff seguro, TTL, auditoria, revogação e acesso limitado ao suporte.

**DEC-030 confirmou notificação dupla do suporte:** pedido aparece em tempo real no painel dos owners e também é enviado aviso por e-mail, com link para autenticar e decidir dentro do Tredane. O e-mail não aprova por si. Validade do pedido pendente resolvida em DEC-031 (24 horas); implementação e testes com piloto continuam pendentes.

**DEC-032 aprovada:** sessão de suporte dura 30 minutos após ativação, com encerramento antecipado permitido e auditoria. A janela de aprovação do pedido pendente mantém 24 horas (DEC-031). DEC-033 exige novo pedido/aprovação; corte de WebSocket e testes seguem por validar.

**DEC-033 confirmada:** para continuar suporte, nova solicitação de 24 horas, nova aprovação de owner e nova sessão de 30 minutos; não há extensão. Testar replay, sessões anteriores, auditoria, autorização e WebSockets antes de operar dados reais.

**DEC-034 aprovada:** qualquer owner ativo da clínica pode encerrar sessão de suporte já autorizada (não apenas o aprovador original); o superadmin actor também pode encerrar voluntariamente. Confirmar implementação de corte imediato HTTP/WebSocket, visibilidade no painel e auditoria; notificações e UX final ainda por validar.

**DEC-035 confirmada:** owners da clínica recebem e-mail informativo **no início efetivo** da sessão, acompanham estados em tempo real e veem encerramento **somente no painel**, com auditoria e sem e-mail de fim. Validar conteúdo seguro das mensagens, privacidade, entregabilidade/idempotência e reidratação do painel no piloto; provedor de e-mail não escolhido.

**DEC-036 confirmada:** visibilidade de suporte ativo para todos os owners **e** aviso contextual ao utilizador representado na própria conta/tenant. Não avisar outros attendants; o e-mail de início continua restrito a owners (DEC-035). Validar conteúdo claro da mensagem, isolamento tenant + subject, WebSocket/reconexão e término sem estado obsoleto antes de operar dados reais.

**DEC-037 confirmada:** subject pode solicitar encerramento na Clinic App; a solicitação fica auditada e aparece em tempo real a owners, que decidem manter ou encerrar. Pedido não suspende a sessão nem muda seu TTL de 30 minutos. Validar UX, privacidade, visibilidade tenant+subject, comportamento de duas decisões concorrentes e eventual prazo de resposta de owner antes de dados reais.

## Evidência mínima a recolher com a clínica piloto

- Jornada real desde chegada da mensagem até agendamento e resposta de confirmação.
- Lista de serviços e durações; quais profissionais, salas/equipamentos podem coincidir; bloqueios, intervalos e cancelamentos.
- Quem precisa entrar no painel, em quais aparelhos, e quem pode configurar serviços/membros/número.
- Situações frequentes de conversa sem resposta, horário recusado, cancelamento, ausência e recontacto.
- Restrições da clínica ao acesso da equipe de suporte e processamento por IA.
- Regras de dados pessoais/anexos, consentimentos e prazos de conservação com revisão apropriada.

**Critério de saída:** cada hipótese passa a Confirmada ou Rejeitada com data/origem, ou permanece explicitamente Em aberto com motivo e gate. Não converter estas hipóteses em requisitos definitivos antes de revisão.
