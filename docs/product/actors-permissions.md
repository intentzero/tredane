# Atores e permissões do MVP

**Estado:** proposta para revisão, com perfis de acesso confirmados pelo responsável pelo produto em 23 de outubro de 2026. **Fonte:** [escopo inicial](../MVP.md) e [épico #1](https://github.com/intentzero/tredane/issues/1). Esta matriz descreve o menor conjunto de ações necessário às jornadas; permissões definitivas dependem da clínica piloto.

## Atores

| ID | Ator | Estado | Objetivo e limite |
| --- | --- | --- | --- |
| ACT-01 | Contato da clínica | Confirmado | Conversar pelo WhatsApp e solicitar ou alterar um horário. Não acessa o painel do Tredane. “Contato” não implica paciente com prontuário. |
| ACT-02 | Atendente | Confirmado | Vê todas as conversas da própria clínica, conduz atendimentos, acompanha oportunidades e opera agendamentos. Não acessa dados de outras clínicas. |
| ACT-03 | Responsável pela clínica | Confirmado | Pode fazer tudo que o atendente faz, inclusive responder no WhatsApp e operar agendamentos da própria clínica. Administração de equipe e integração ainda precisa de validação específica. |
| ACT-04 | Profissional que presta o serviço | Confirmado fora do painel do MVP | É recurso de agenda; não recebe perfil de acesso ao painel nesta primeira entrega. |
| ACT-05 | Operador do Tredane | Confirmado fora do painel do MVP | Não recebe perfil de acesso ao painel. Operação assistida para configurar tenants ou tratar falhas segue em aberto; acesso rotineiro a conteúdo não está definido. |
| ACT-06 | Serviços externos e automações | Proposto | WhatsApp, filas e workflows agem em nome da clínica após verificação da origem e associação ao tenant. Não são usuários humanos nem recebem acesso genérico a outros tenants. |

## Matriz de permissões proposta

**Legenda:** ✓ permissão prevista; — fora do papel; ? decisão pendente. Apenas atendente e responsável têm perfil de acesso ao painel no primeiro MVP. Ambos veem todas as conversas da própria clínica, e o responsável pode executar todas as ações do atendente. Permissões de administração ainda são propostas. Toda permissão vale somente para o tenant autorizado; a tabela não substitui a autorização no servidor.

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
| Ver dados de todas as clínicas | — | — | — | — | — |

Operação e suporte devem partir de metadados e registros técnicos. Qualquer acesso excepcional a conteúdo de uma clínica requer política, autorização e auditoria específicas, ainda não definidas.

## Regras transversais propostas

1. O servidor resolve a clínica a partir de identidade autenticada e associação vigente; um ID de clínica enviado pelo navegador não concede acesso.
2. Uma sessão ativa opera em um tenant por vez. Se um usuário pertencer a mais de uma clínica, a troca exige nova seleção e verificação de associação; a necessidade desse caso no MVP está em aberto.
3. Webhook verificado é associado à clínica pelo número/conta conectada, nunca por um campo de tenant livre no payload.
4. A criação, alteração e exclusão de membro registram quem fez a ação. Ao revogar acesso, novas requisições são negadas e conexões WebSocket existentes deixam de receber eventos e são encerradas ou reautorizadas antes de continuar.
5. Arquivos, mensagens em fila e workflows carregam contexto de tenant verificável e só operam sobre dados desse tenant.
6. Nenhum ator humano tem acesso implícito aos dados de todas as clínicas.

## Questões para fechar com o responsável pelo produto e a clínica piloto

| ID | Questão | Bloqueia |
| --- | --- | --- |
| Q-ACT-04 | Quem conecta e administra a conta WhatsApp Business? | Onboarding real de clínicas. |
| Q-ACT-05 | Um usuário pode pertencer a várias clínicas? | Identidade, seleção de tenant e troca de sessão. |
| Q-ACT-06 | Sem painel de operador no MVP, qual processo assistido configura a clínica e qual acesso excepcional é permitido? | Suporte, segurança e auditoria. |

**Q-ACT-01, Q-ACT-02 e Q-ACT-03 resolvidas:** atendente vê todas as conversas da própria clínica; responsável pode executar todas as ações do atendente, inclusive responder e operar agenda; só esses dois perfis acessam o painel. Profissional permanece como recurso de agenda sem login. Decisões do responsável pelo produto em 23 de outubro de 2026.

**Próximo passo:** revisar estas propostas com o responsável pelo produto e uma clínica piloto; então atualizar os estados e os requisitos vinculados sem apagar o histórico das decisões.
