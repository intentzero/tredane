# Auditoria do Issue #1 — definição do MVP

**Data:** 23/10/2026. **Natureza:** fotografia de cobertura documental, não aprovação da clínica piloto e não confirmação de software implementado.

**Fonte de acompanhamento:** [Issue #1](https://github.com/intentzero/tredane/issues/1). **Fonte de decisões:** [MVP](../MVP.md) e [registro de decisões](decisions.md). Registos de hipóteses em [validação pendente](validation-register.md).

## Regra de contagem

- **Concluído documentalmente:** a tarefa pediu um documento, proposta ou descrição e a entrega verificável existe. **Não** implica que a hipótese ou solução já foi aprovada/testada.
- **Pendente de definição:** faltam política/regra final, especificação observável ou confirmação de decisão.
- **Pendente de validação:** a jornada existe, mas a aprovação final com a clínica ou evidência de pesquisa permanece ausente.
- Para decisões técnicas vinculantes, preservar a distinção entre **Confirmado, Proposto, Em aberto** e **Fora do MVP** dos documentos originais. Nenhum checkbox autoriza tratar dados reais ou fazer deploy.

## Auditoria de cada checkbox (28)

| ID | Tarefa da issue | Estado após auditoria | Evidência ou lacuna |
| --- | --- | --- | --- |
| A-01 | Descrever atores | Concluído | [ACT-01 a ACT-06](actors-permissions.md) |
| A-02 | Validar perfis de acesso ao painel | Concluído para recorte | Clinic App para attendant/owner, Platform Admin separada; [ADR-0006](../adr/0006-clerk-platform-admin.md) |
| A-03 | Matriz **proposta** de permissões | Concluído como proposta | [matriz](actors-permissions.md); permissões de integração/admin de clínica continuam em aberto |
| A-04 | Ciclo de membership e revogação até WebSocket | Parcial: delegação confirmada, convite e revogação pendentes | DEC-020: superadmin gere owners, owner gere attendants; especificar aceite/expiração e revogação em WS |
| J-01 | Primeira mensagem WhatsApp | **Documentado para revisão** | [JRN-01](journeys.md), exceções, REQ-010/011/050 |
| J-02 | Atendimento com IA e transferência | **Documentado para revisão** | [JRN-02](journeys.md), REQ-020/022 |
| J-03 | Oportunidade até reserva | **Documentado para revisão** | [JRN-03](journeys.md), regras da agenda ainda não fechadas |
| J-04 | Visão do responsável | **Documentado para revisão** | [JRN-04](journeys.md), permissões operacionais confirmadas |
| J-05 | Cancelamento/reagendamento | **Documentado para revisão** | [JRN-05](journeys.md); prazo, motivo e buffers pendentes |
| J-06 | Falhas/reentrega de webhook | **Documentado para revisão** | [JRN-06](journeys.md); política de retries pendente |
| J-07 | Tempo real/reconexão/isolamento | **Documentado para revisão** | [JRN-07](journeys.md), [REQ-040/041](requirements.md); implementação F1/F2 posterior |
| F-01 | Entidades e regras finais do domínio | Pendente de definição | [modelo lógico proposto](../architecture/data-model.md); relacionamentos e regras finais incompletos |
| F-02 | Transições completas e auditoria | Pendente de definição | [estados propostos](states.md); reabertura/etapas e lógica de concluído ainda abertas |
| F-03 | Disponibilidade e regras da agenda | Pendente de definição + piloto | [DEC-008](decisions.md); serviço, duração, buffer, cancelamento, disponibilidade e recursos |
| F-04 | WhatsApp: ativação/envio/anexos | Pendente de definição | Identificadores/estados/idempotência documentados; onboarding do número, anexos e respostas fora da janela faltam |
| F-05 | IA: contexto permitido e registro | Pendente de definição | Revisão humana confirmada como recorte; provedor, campos, limites, retenção e critérios de qualidade faltam |
| F-06 | Propor eventos e reconciliação | Concluído como proposta | [estados/eventos](states.md), [arquitetura](../architecture/overview.md) |
| Q-01 | Fronteira proposta de tenant | Concluído como proposta | [tenant-boundaries](tenant-boundaries.md) |
| Q-02 | Escolher D1 compartilhado/separado | Pendente de decisão | [ADR-0002](../adr/0002-d1-topology.md) permanece aberto |
| Q-03 | Fechar segurança, sessões e webhook | Pendente de especificação | Clerk e N:N confirmados; MFA, convites, revogação WebSocket, CSRF/impersonação e validação webhook ainda incompletos |
| Q-04 | Dados, retenção e exclusão | Pendente de definição | [DEC-011](decisions.md), LGPD, suporte, anexos e logs |
| Q-05 | Observabilidade **proposta** | Concluído como proposta | [REQ-070](requirements.md), [arquitetura](../architecture/overview.md) |
| Q-06 | Usabilidade e dispositivos piloto | Pendente de validação | Dispositivos e fluxos reais da clínica piloto não documentados |
| V-01 | Prioridades por requisito com justificativa | Proposta na auditoria, **pendente de aprovação** | [racional por REQ](requirements.md); confirmar redução de recorte com produto |
| V-02 | Primeira fatia ponta a ponta | Concluído como proposta | [MVP](../MVP.md), JRN-01 a JRN-03 |
| V-03 | Cenários de aceite observáveis | Concluído como proposta | [AC-01 a AC-20](acceptance.md) |
| V-04 | Piloto **ou** hipóteses registradas | Hipóteses documentadas; validação **pendente** | [register](validation-register.md). Não é sinal de aprovação da clínica |
| V-05 | MVP resumido com links | Concluído | [docs/MVP.md](../MVP.md) |

**Leitura do checklist:** 9/28 itens já estavam marcados em 23/10; as sete jornadas J-01 a J-07 estavam registradas e podem ser marcadas **como documentação produzida**, alcançando **16/28**. As tarefas V-01 e V-04 podem ser encerradas apenas após incorporar e revisar o racional e registo de hipóteses, mas a validação da clínica permanece necessária antes de dar o épico por concluído.

**Evolução após esta auditoria:** DEC-021 confirma convite por e-mail de uso único e aceite com e-mail verificado no Clerk (existente ou novo), preservando memberships em outros tenants. DEC-022 fixou a expiração em 7 dias; a tarefa A-04 segue parcialmente aberta por falta da política de reenvio e do mecanismo de revogação HTTP/WebSockets.

## Decisões fechadas

- Clerk sem Organizations; `privateMetadata.superadmin` estritamente booleano e validado pelo backend.
- Um usuário pode integrar vários tenants e roles diferentes; memberships no D1.
- Platform Admin para ciclo de vida dos tenants; impersonação **implementada pelo Tredane**, por sessões de suporte D1, sem impersonação do Clerk.
- Clinic App com perfis de atendente e responsável, profissional como recurso da agenda.
- Agenda própria, WhatsApp oficial, IA apenas assistiva no primeiro recorte; WebSockets hibernáveis em Durable Objects.

Referências: [DEC-013 a DEC-019](decisions.md), [ADR-0006](../adr/0006-clerk-platform-admin.md) e [ADR-0007](../adr/0007-support-impersonation.md).

## Próximas decisões, em ordem sugerida

1. **Engenharia F1**: delegação confirmada; especificar convite/aceite, saída de membros, autorização de acesso e revogação imediata em WebSockets, incluindo sessões de suporte. Rascunho e teste com duas clínicas fictícias primeiro.
2. **Agenda + piloto**: serviços, durações, recursos, buffers, expedientes, cancelamento e reagendamento — definir com a clínica antes de codificar algoritmo final.
3. **WhatsApp**: conta/número por clínica, operação assistida vs autosserviço, responsabilidades, anexos e estados de falha. Sem conectar número real antes disso.
4. **D1/retensão**: decisão A/B de banco, minimização e exclusão de dados/arquivos, políticas LGPD e acesso de suporte.
5. **IA**: contexto autorizado, provedor, retenção e testes de qualidade.
6. **Usabilidade**: observar aparelhos, equipe, frequência/ritmo de operação e cenários na clínica piloto.

## Gate para encerrar Issue #1

Os documentos têm de estar consistentes e revisados pelo responsável do produto, com cada decisão crítica **resolvida ou explicitamente tratada como hipótese não bloqueante** com responsável e momento de revisão. O piloto pode ainda não ter ocorrido se a issue registrar hipóteses claramente; porém o PR e o checklist **não substituem** aceite do produto nem autorizam dados reais. Critérios, estados e prioridades aprovados precisam apontar para os documentos oficiais.
