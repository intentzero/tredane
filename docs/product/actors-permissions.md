# Atores e permissões do MVP

**Estado:** proposta para revisão, com perfis de acesso confirmados pelo responsável pelo produto em 23 de outubro de 2026. **Fonte:** [escopo inicial](../MVP.md) e [épico #1](https://github.com/intentzero/tredane/issues/1). Esta matriz descreve o menor conjunto de ações necessário às jornadas; permissões definitivas dependem da clínica piloto.

## Atores

| ID | Ator | Estado | Objetivo e limite |
| --- | --- | --- | --- |
| ACT-01 | Contato da clínica | Confirmado | Conversar pelo WhatsApp e solicitar ou alterar um horário. Não acessa o painel do Tredane. “Contato” não implica paciente com prontuário. |
| ACT-02 | Atendente | Confirmado | Vê todas as conversas da própria clínica, conduz atendimentos, acompanha oportunidades e opera agendamentos. Não acessa dados de outras clínicas. |
| ACT-03 | Responsável pela clínica | Confirmado | Pode fazer tudo que o atendente faz, inclusive responder no WhatsApp e operar agendamentos da própria clínica. Administração de equipe e integração ainda precisa de validação específica. |
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
| Alterar disponibilidade, serviços e recursos | — | ? | ✓ | — | — |
| Gerir membros e permissões da clínica | — | — | ✓ | — | — |
| Conectar ou trocar o número de WhatsApp | — | — | ? | — | — |
| Ver conteúdo de todos os tenants sem contexto autorizado | — | — | — | — | — |
| Administrar cadastro e ciclo de vida de tenants | — | — | — | — | ✓ |
| Impersonar usuário membro de um tenant para suporte, com auditoria e TTL | — | — | — | — | ✓ |

Operação e suporte devem partir de metadados e registros técnicos. Qualquer acesso excepcional a conteúdo de uma clínica requer política, autorização e auditoria específicas, ainda não definidas.

## Regras transversais propostas

1. O servidor resolve a clínica a partir de identidade autenticada e associação vigente; um ID de clínica enviado pelo navegador não concede acesso.
2. Um usuário pode pertencer a **vários** tenants com papéis distintos; cada aba/requisição opera num tenant explicitamente selecionado e revalidado contra memberships ativos no D1. Não existe tenant global no Clerk.
3. Webhook verificado é associado à clínica pelo número/conta conectada, nunca por um campo de tenant livre no payload.
4. A criação, alteração e exclusão de membro registram quem fez a ação. Ao revogar acesso, novas requisições são negadas e conexões WebSocket existentes deixam de receber eventos e são encerradas ou reautorizadas antes de continuar.
5. Arquivos, mensagens em fila e workflows carregam contexto de tenant verificável e só operam sobre dados desse tenant.
6. Nenhum ator humano tem acesso implícito aos dados de todas as clínicas. A impersonação do superadmin opera segundo a role efetiva do usuário alvo, com ator, alvo, tenant, motivo, prazo e ações auditadas. A sessão de suporte não deve conferir privilégios superiores à role do alvo.

## Questões para fechar com o responsável pelo produto e a clínica piloto

| ID | Questão | Bloqueia |
| --- | --- | --- |
| Q-ACT-04 | Quem conecta e administra a conta WhatsApp Business? | Onboarding real de clínicas. |
| Q-ACT-05 | **Resolvido:** um usuário pode pertencer a várias clínicas; memberships e roles por tenant no D1, sem Organizations do Clerk. | Implementar seletor de tenant e revogação por membership. |
| Q-ACT-06 | **Resolvido em parte:** Platform Admin gerencia tenants e superadmin pode iniciar impersonação auditável de usuário membro para suporte. Mecanismo de sessão própria do Tredane confirmado; detalhes de segurança, limites e política de acesso a dados reais em aberto. | Suporte e auditoria; [ADR-0007](../adr/0007-support-impersonation.md). |

**Q-ACT-01, Q-ACT-02 e Q-ACT-03 resolvidas:** atendente vê todas as conversas da própria clínica; responsável pode executar todas as ações do atendente, inclusive responder e operar agenda; só esses dois perfis acessam o painel. Profissional permanece como recurso de agenda sem login. Decisões do responsável pelo produto em 23 de outubro de 2026.

**Nova decisão de 23/10/2026:** Clerk sem Organizations; `privateMetadata.superadmin`; memberships multi-tenant no D1; Platform Admin separada e impersonação de suporte auditável. Conferir [ADR-0006](../adr/0006-clerk-platform-admin.md) e [ADR-0007](../adr/0007-support-impersonation.md).

**Próximo passo:** implementar/validar o mecanismo **próprio** de impersonação do Tredane (handoff, revogação e auditoria), o onboarding de membros e a política de dados de suporte antes de usar dados reais.
