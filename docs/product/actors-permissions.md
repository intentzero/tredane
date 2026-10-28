# Atores e permissões do MVP

**Estado:** proposta para revisão, com perfis de acesso confirmados pelo responsável pelo produto em 23 de outubro de 2026. **Fonte:** [escopo inicial](../MVP.md) e [épico #1](https://github.com/intentzero/tredane/issues/1). Esta matriz descreve o menor conjunto de ações necessário às jornadas; permissões definitivas dependem da clínica piloto.

## Atores

| ID | Ator | Estado | Objetivo e limite |
| --- | --- | --- | --- |
| ACT-01 | Contato da clínica | Confirmado | Conversar pelo WhatsApp e solicitar ou alterar um horário. Não acessa o painel do Tredane. “Contato” não implica paciente com prontuário. |
| ACT-02 | Atendente | Confirmado | Vê todas as conversas da própria clínica, conduz atendimentos, acompanha oportunidades e opera agendamentos. Não acessa dados de outras clínicas. |
| ACT-03 | Responsável pela clínica | Confirmado | Pode fazer tudo que o atendente faz, inclusive responder no WhatsApp e operar agendamentos da própria clínica. Pode convidar e remover attendants do próprio tenant. Não pode criar, promover ou remover owners. Conecta ou troca o número de WhatsApp pelo Embedded Signup (DEC-009/042). Detalhes externos da ativação Meta continuam como gate. |
| ACT-04 | Profissional que presta o serviço | Confirmado fora do painel do MVP | É recurso de agenda; não recebe perfil de acesso ao painel nesta primeira entrega. |
| ACT-05 | Superadmin Tredane | Confirmado na Platform Admin App | Administrador com `privateMetadata.superadmin === true` validada no backend; cria/edita/suspende/inicia exclusão de tenants, e pode iniciar impersonação temporária de membro de tenant para manutenção, com auditoria. Não recebe acesso implícito irrestrito ao conteúdo da clínica. |
| ACT-06 | Serviços externos e automações | Proposto | WhatsApp, filas e workflows agem em nome da clínica após verificação da origem e associação ao tenant. Não são usuários humanos nem recebem acesso genérico a outros tenants. |

## Matriz de permissões proposta

**Legenda:** ✓ permissão prevista; — fora do papel; ? decisão pendente. Apenas atendente e responsável têm perfil no painel **operacional** da clínica; superadmin usa uma **Platform Admin App** separada. Ambos veem todas as conversas da própria clínica, e o responsável pode executar todas as ações do atendente. Permissões de administração ainda são propostas. Toda permissão vale somente para o tenant autorizado; a tabela não substitui a autorização no servidor.

| Ação | Contato | Atendente | Responsável | Profissional | Operador Tredane |
| --- | :---: | :---: | :---: | :---: | :---: |
| Enviar/receber mensagens pelo próprio WhatsApp | ✓ | — | — | — | — |
| Ver todas as conversas e anexos da própria clínica | — | ✓ | ✓ | — | — |
| Responder em nome da clínica | — | ✓ | ✓ | — | — |
| Consultar sugestão de IA e decidir envio | — | ✓ | ✓ | — | — |
| Atribuir ou transferir conversa | — | ✓ | ✓ | — | — |
| Mover oportunidade no pipeline | — | ✓ | ✓ | — | — |
| Ver agenda da clínica | — | ✓ | ✓ | — | — |
| Criar, cancelar ou reagendar horário | solicitar via WhatsApp | ✓ | ✓ | — | — |
| Alterar disponibilidade, serviços, profissionais, salas/equipamentos e bloqueios (DEC-042) | — | — | ✓ | — | — |
| Sinalizar, ocultar e pausar automações (DEC-062, P-1) | — | ✓ | ✓ | — | — |
| Retomar automações, desbloquear e marcar falso positivo (DEC-062, P-1) | — | — | ✓ | — | — |
| Convidar e remover attendants do próprio tenant | — | — | ✓ | — | ✓ |
| Atribuir, promover, substituir ou remover owners | — | — | — | — | ✓ |
| Conectar ou trocar o número de WhatsApp (Embedded Signup, DEC-009, DEC-042) | — | — | ✓ | — | acompanhar o estado |
| Ver conteúdo de todos os tenants sem contexto autorizado | — | — | — | — | — |
| Administrar cadastro e ciclo de vida de tenants | — | — | — | — | ✓ |
| Aprovar/rejeitar pedido de suporte do próprio tenant | — | — | ✓ | — | — |
| Encerrar qualquer sessão ativa de suporte no próprio tenant (DEC-034) | — | — | ✓ | — | — |
| Solicitar encerramento de suporte quando for o próprio utilizador representado (DEC-037) | — | ✓* | ✓* | — | — |
| Decidir manter/encerrar suporte após pedido do subject da própria clínica (DEC-037) | — | — | ✓ | — | — |
| Encerrar voluntariamente a própria sessão de suporte como actor | — | — | — | — | ✓ |

| Solicitar suporte e iniciar impersonação somente após aprovação do owner | — | — | — | — | ✓ |

\* Somente quando o utilizador autenticado é o **subject** da sessão ativa naquele tenant; a solicitação não revoga o suporte nem concede acesso administrativo.

Operação e suporte devem partir de metadados e registros técnicos. Qualquer acesso excepcional a conteúdo de uma clínica requer política, autorização e auditoria específicas, ainda não definidas.

## MFA fora do MVP — DEC-028

**Confirmado:** nenhum perfil, incluindo superadmin ou owner, precisa configurar ou validar MFA no MVP. O Clerk autentica e o backend continua a conferir roles de tenant, flag global superadmin e regras de suporte. DEC-027 foi substituída. Rever MFA numa futura fase.

## Regras transversais propostas

1. O servidor resolve a clínica a partir de identidade autenticada e associação vigente; um ID de clínica enviado pelo navegador não concede acesso.
2. Um usuário pode pertencer a **vários** tenants com papéis distintos; cada aba/requisição opera num tenant explicitamente selecionado e revalidado contra memberships ativos no D1. Não existe tenant global no Clerk.
3. Webhook verificado é associado à clínica pelo número/conta conectada, nunca por um campo de tenant livre no payload.
4. Superadmin provisiona o primeiro owner e gere owners; owner gere apenas attendants de seu tenant, sem alterar membros de outra clínica. Remover um membership em A preserva B. A criação, alteração e exclusão de membro registram quem fez a ação. Ao revogar acesso, novas requisições são negadas e conexões WebSocket existentes deixam de receber eventos e são encerradas ou reautorizadas antes de continuar.
5. Arquivos, mensagens em fila e workflows carregam contexto de tenant verificável e só operam sobre dados desse tenant.
6. Nenhum ator humano tem acesso implícito aos dados de todas as clínicas. A impersonação do superadmin opera segundo a role efetiva do usuário alvo, com ator, alvo, tenant, motivo, prazo e ações auditadas. A sessão de suporte não deve conferir privilégios superiores à role do alvo.

## Questões para fechar com o responsável pelo produto e a clínica piloto

| ID | Questão | Bloqueia |
| --- | --- | --- |
| Q-ACT-04 | **Resolvido (DEC-009):** o responsável (owner) conecta a conta da clínica pelo Embedded Signup, com apoio do Tredane no piloto. Falta o registro do Tredane como Tech Provider na Meta. | Onboarding real de clínicas. |
| Q-ACT-05 | **Resolvido:** um usuário pode pertencer a várias clínicas; memberships e roles por tenant no D1, sem Organizations do Clerk. A seleção e a troca de clínica são explícitas. | Implementar seletor, revalidar o tenant ao trocar e preservar os outros memberships na revogação. |
| Q-ACT-06 | **Resolvido em parte:** Platform Admin gerencia tenants e superadmin pode iniciar impersonação auditável de usuário membro para suporte. Mecanismo de sessão própria do Tredane confirmado; detalhes de segurança, limites e política de acesso a dados reais em aberto. | Suporte e auditoria; [ADR-0007](../adr/0007-support-impersonation.md). |

**Q-ACT-01, Q-ACT-02 e Q-ACT-03 resolvidas:** atendente vê todas as conversas da própria clínica; responsável pode executar todas as ações do atendente, inclusive responder e operar agenda; só esses dois perfis acessam o painel. Profissional permanece como recurso de agenda sem login. Decisões do responsável pelo produto em 23 de outubro de 2026.

**Nova decisão de 23/10/2026:** Clerk sem Organizations; `privateMetadata.superadmin`; memberships multi-tenant no D1; Platform Admin separada e impersonação de suporte auditável. Conferir [ADR-0006](../adr/0006-clerk-platform-admin.md) e [ADR-0007](../adr/0007-support-impersonation.md).

**Decisão B confirmada:** gestão delegada de attendants pelo owner e gestão de owners exclusiva do superadmin. Fluxo do convite permanece em aberto.

**Próximo passo:** implementar/validar o mecanismo **próprio** de impersonação do Tredane (handoff, revogação e auditoria), o onboarding de membros e a política de dados de suporte antes de usar dados reais.
