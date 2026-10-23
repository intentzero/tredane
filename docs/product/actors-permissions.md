# Atores e permissões do MVP

**Estado:** proposta para revisão, com perfis de acesso, administração e multi-clínica confirmados pelo responsável pelo produto em 23 de outubro de 2026 ([DEC-007, DEC-012, DEC-013](decisions.md)). **Fonte:** [escopo inicial](../MVP.md) e [épico #1](https://github.com/intentzero/tredane/issues/1). Esta matriz descreve o menor conjunto de ações necessário às jornadas; permissões definitivas dependem da clínica piloto.

## Atores

| ID | Ator | Estado | Objetivo e limite |
| --- | --- | --- | --- |
| ACT-01 | Contato da clínica | Confirmado | Conversar pelo WhatsApp e solicitar ou alterar um horário. Não acessa o painel do Tredane. “Contato” não implica paciente com prontuário. |
| ACT-02 | Atendente | Confirmado | Vê todas as conversas da própria clínica, conduz atendimentos, acompanha oportunidades e opera agendamentos. Não acessa dados de outras clínicas. |
| ACT-03 | Responsável pela clínica | Confirmado | Pode fazer tudo que o atendente faz, inclusive responder no WhatsApp e operar agendamentos da própria clínica. É o único que administra membros e configurações da clínica e conecta o número de WhatsApp pelo Embedded Signup (DEC-007, DEC-009). |
| ACT-04 | Profissional que presta o serviço | Confirmado fora do painel do MVP | É recurso de agenda; não recebe perfil de acesso ao painel nesta primeira entrega. |
| ACT-05 | Superadmin (equipe do Tredane) | Confirmado, fora do painel da clínica | Usa o app separado de superadmin para criar clínicas, provisionar o D1 da clínica, convidar o responsável, acompanhar a ativação do WhatsApp e a saúde técnica (DEC-012, [ADR-0006](../adr/0006-superadmin-control-plane.md)). Não tem associação a clínicas por ser superadmin. Acesso a conteúdo de clínica: **Em aberto** (Q-SA-01); até lá, nenhum. |
| ACT-06 | Serviços externos e automações | Proposto | WhatsApp, filas e workflows agem em nome da clínica após verificação da origem e associação ao tenant. Não são usuários humanos nem recebem acesso genérico a outros tenants. |

## Matriz de permissões proposta

**Legenda:** ✓ permissão prevista; — fora do papel; ? decisão pendente. Apenas atendente e responsável têm perfil de acesso ao painel da clínica no primeiro MVP. Ambos veem todas as conversas da própria clínica, e o responsável pode executar todas as ações do atendente. Administração da clínica é exclusiva do responsável (DEC-007). A coluna do superadmin refere-se ao app de superadmin, não ao painel. Toda permissão vale somente para o tenant autorizado; a tabela não substitui a autorização no servidor.

| Ação | Contato | Atendente | Responsável | Profissional | Superadmin |
| --- | :---: | :---: | :---: | :---: | :---: |
| Enviar/receber mensagens pelo próprio WhatsApp | ✓ | — | — | — | — |
| Ver todas as conversas e anexos da própria clínica | — | ✓ | ✓ | — | — |
| Responder em nome da clínica | — | ✓ | ✓ | — | — |
| Consultar sugestão de IA e decidir envio | — | ✓ | ✓ | — | — |
| Atribuir ou transferir conversa | — | ✓ | ✓ | — | — |
| Mover oportunidade no pipeline | — | ✓ | ✓ | — | — |
| Ver agenda da clínica | — | ✓ | ✓ | — | — |
| Criar, cancelar ou reagendar horário | solicitar via WhatsApp | ✓ | ✓ | — | — |
| Alterar disponibilidade, serviços e recursos | — | — | ✓ | — | — |
| Gerir membros e permissões da clínica | — | — | ✓ | — | convidar o primeiro responsável |
| Conectar ou trocar o número de WhatsApp | — | — | ✓ (Embedded Signup) | — | acompanhar o estado |
| Criar clínica e provisionar seu D1 | — | — | — | — | ✓ |
| Ver dados de todas as clínicas | — | — | — | — | — |

Operação e suporte devem partir de metadados e registros técnicos. Qualquer acesso excepcional a conteúdo de uma clínica requer política, autorização e auditoria específicas, ainda não definidas.

## Regras transversais propostas

1. O servidor resolve a clínica a partir de identidade autenticada e associação vigente; um ID de clínica enviado pelo navegador não concede acesso.
2. Uma sessão ativa opera em um tenant por vez. Um usuário pode pertencer a mais de uma clínica (Confirmado, DEC-007): escolhe a clínica ativa no seletor, e a troca revalida a associação, descarta o estado da clínica anterior na interface e reconecta o WebSocket ao Durable Object da nova clínica.
3. Webhook verificado é associado à clínica pelo número/conta conectada, nunca por um campo de tenant livre no payload.
4. A criação, alteração e exclusão de membro registram quem fez a ação. Ao revogar acesso, novas requisições são negadas e conexões WebSocket existentes deixam de receber eventos e são encerradas ou reautorizadas antes de continuar.
5. Arquivos, mensagens em fila e workflows carregam contexto de tenant verificável e só operam sobre dados desse tenant.
6. Nenhum ator humano tem acesso implícito aos dados de todas as clínicas.

## Questões para fechar com o responsável pelo produto e a clínica piloto

| ID | Questão | Bloqueia |
| --- | --- | --- |
| Q-SA-01 | O superadmin pode ver conteúdo de uma clínica e sob quais controles? | Suporte com dados reais. Ver [ADR-0006](../adr/0006-superadmin-control-plane.md). |
| Q-SA-02 | Como o superadmin se autentica (segundo fator, passkey, Cloudflare Access)? | Publicação do app de superadmin. |

**Q-ACT-04 a Q-ACT-06 resolvidas em 23/10/2026:** o responsável conecta a conta da clínica pelo Embedded Signup com apoio do Tredane (DEC-009); uma conta pode pertencer a várias clínicas com seletor (DEC-007); a configuração assistida é feita no app de superadmin (DEC-012), com acesso a conteúdo ainda em aberto (Q-SA-01).

**Q-ACT-01, Q-ACT-02 e Q-ACT-03 resolvidas:** atendente vê todas as conversas da própria clínica; responsável pode executar todas as ações do atendente, inclusive responder e operar agenda; só esses dois perfis acessam o painel. Profissional permanece como recurso de agenda sem login. Decisões do responsável pelo produto em 23 de outubro de 2026.

**Próximo passo:** revisar estas propostas com o responsável pelo produto e uma clínica piloto; então atualizar os estados e os requisitos vinculados sem apagar o histórico das decisões.
