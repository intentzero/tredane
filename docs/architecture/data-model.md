# Modelo lógico de dados D1 — Tredane

**Estado:** proposta técnica, não migração final. **Topologia aceita** ([ADR-0002](../adr/0002-d1-topology.md)): as tabelas abaixo se dividem entre o D1 central de controle e o D1 de cada clínica. Orienta Drizzle e testes do MVP. [Requisitos](../product/requirements.md) e [decisões abertas](../product/decisions.md) continuam a ser a fonte das regras de produto.

## D1 central de controle

| Entidade | Campos e relações essenciais (propostos) |
| --- | --- |
| tenants | id, nome, timezone (padrão America/Sao_Paulo), estado (provisionando, ativa, suspensa, encerrada), encerrada_em |
| tenant_databases | tenant_id, identificador do D1, versão de migração aplicada, estado |
| users | id, clerk_user_id único, e-mail (cópia para exibição), nome, estado; identidade e credenciais ficam no Clerk |
| sessions | id, clerk_session_id, user_id, active_tenant_id, criada_em, revogada_em (clínica ativa da sessão) |
| memberships | user_id, tenant_id, role (atendente, responsável), estado, revoked_at, expires_at opcional (suporte); um usuário pode ter várias |
| support_grants | id, tenant_id, superadmin_user_id, concedido_por (responsável), expires_at, revoked_at (acesso temporário de suporte, DEC-012) |
| whatsapp_channels | id, tenant_id, phone_number_id externo único, waba_id, estado da ativação (Embedded Signup) |
| platform_audit_log | id, actor_user_id, tenant_id opcional, action, occurred_at |

Nenhuma tabela do D1 central guarda contato, conversa, mensagem, oportunidade, agenda ou sugestão de IA.

## D1 da clínica (um por clínica)

| Entidade | Campos e relações essenciais (propostos) |
| --- | --- |
| contacts | id, tenant_id, identificador WhatsApp, nome mínimo |
| conversations | id, tenant_id, contact_id, assignee_user_id (validado contra memberships no D1 central), status, last_activity_at |
| messages | id, tenant_id, conversation_id, direction, external_message_id, delivery_state, body, created_at |
| opportunities | id, tenant_id, contact_id, conversation_id opcional, stage_id, assignee_id |
| opportunity_events | id, tenant_id, opportunity_id, actor_id, from_stage, to_stage, occurred_at |
| services | id, tenant_id, nome, duração, buffer, preço opcional, ativo |
| professionals | id, tenant_id, nome, ativo; sem login no MVP |
| resources | id, tenant_id, tipo (sala/equipamento), nome, ativo |
| service_requirements | tenant_id, service_id, resource_type e regras de seleção |
| availability_rules | tenant_id, professional_id ou resource_id, dia da semana, início, fim (expediente semanal, múltiplos de 15 min) |
| time_off | tenant_id, professional_id ou resource_id, início, fim, motivo (bloqueio pontual, sem recorrência no MVP) |
| appointments | id, tenant_id, contact_id (anulável após exclusão do contato), opportunity_id opcional, service_id, starts_at, ends_at, status, cancel_reason (obrigatório ao cancelar ou reagendar), version |
| appointment_allocations | id, tenant_id, appointment_id, resource_kind, resource_id, occupied_from, occupied_until |
| appointment_events | id, tenant_id, appointment_id, operação, actor_id, previous/new state, occurred_at |
| inbound_events | id, tenant_id, provider_event_key, processing_state, received_at |
| outbox_events | id, tenant_id, type, aggregate_id, version, processing_state, occurred_at |
| outbound_messages | id, tenant_id, conversation_id, client_request_id, provider_message_id, status, attempt_info |
| audit_log | id, tenant_id, actor, action, object_type, object_id, occurred_at |
| ai_suggestions | id, tenant_id, conversation_id, status, provider/model id, revised_by, timestamps |

**Não confirmado:** esquema exato, granularidade temporal, regras de unicidade por ciclo da conversa/oportunidade, campos pessoais de contacto e política de retenção. Os campos são indicativos e não devem ser tratados como recolha autorizada de dados reais.

## Invariantes estruturais

1. Todas as entidades operacionais do D1 da clínica mantêm tenant_id, como defesa em profundidade e para casar com mensagens de Queue/Workflow; chaves estrangeiras e índices compostos devem evitar referências a entidades de outra clínica (por exemplo, UNIQUE(tenant_id, id) e FOREIGN KEY (tenant_id, contact_id) quando aplicável).
2. A ligação WhatsApp usa identificador de número/conta verificado, com associação inequívoca a uma clínica ativa. Um mesmo número de contacto pode existir isoladamente em clínicas diferentes.
3. O webhook da Meta e a intenção de envio têm chaves de idempotência persistidas e índices únicos no contexto correto.
4. Alterações de estado de agendamentos, oportunidades e envios preservam histórico; eventos da UI nunca antecedem a persistência.
5. Mensagens não são excluídas por simples encerramento de conversa. Exclusão de contato pelo responsável apaga mensagens e anexos do contato e anonimiza seus agendamentos; encerramento da clínica remove o D1 da clínica e o prefixo R2 em até 30 dias (DEC-011).

## Concorrência da agenda: estratégia proposta

Precisamos evitar conflito tanto de profissional como de sala/equipamento. A API **não** deve fazer apenas SELECT de disponibilidade seguido de INSERT livre. A restrição final deve estar na camada de escrita do D1.

Uma opção a validar em teste com o D1/SQLite é usar linhas de ocupação por recurso em appointment_allocations, com gatilhos SQL BEFORE INSERT e BEFORE UPDATE que abortem quando existir outra ocupação ativa do mesmo (tenant, tipo, recurso) com intervalos sobrepostos:

- Sobreposição se existing.occupied_from < incoming.occupied_until **e** existing.occupied_until > incoming.occupied_from.
- Inserir agendamento + todas as ocupações de profissionais/salas/equipamentos por **lote transacional D1 batch**. Se qualquer ocupação conflitar, abortar o lote todo.
- Reagendamento atualiza o conjunto de ocupações no mesmo lote transacional, preservando o agendamento original em caso de erro. Cancelamento liberta ocupações apenas por operação auditada.
- Bloqueios/ausências que reservem recursos precisam passar pela mesma proteção de escrita.
- Duração e intervalo do serviço compõem occupied_from/until (DEC-008); o intervalo ocupa a sala/equipamento **e o profissional**. Início, duração e intervalo são múltiplos de 15 min, o que permite avaliar a alternativa de slots discretos do ADR-0005.
- Criar testes simultâneos e cenários de limites adjacentes, recursos distintos, cancelamento/reagendamento e cross-tenant antes de adotar a solução.

**A validar tecnicamente:** suporte e comportamento efetivo dos gatilhos usados, transação D1, limitações do runtime e desenho final do bloqueio. Se necessário, substituir por outra estratégia atómica com restrições únicas (por exemplo, slots discretizados), sem enfraquecer o critério REQ-031.

Referencia oficial: https://developers.cloudflare.com/d1/worker-api/d1-database/ (batch executa sequencialmente numa transação e faz rollback se uma instrução falhar).

## Outbox e eventos

Alteração de domínio e outbox_events entram na mesma transação D1. Um despachante reprocessável varre eventos pendentes e envia a Queue; evento tem ID estável para deduplicação no consumidor. Duplicação na entrega é normal; nenhuma ação deve assumir exactly-once da Queue ou da Meta. O Durable Object envia pequenas notificações (tenant, tipo, aggregate_id, version); os clientes buscam estado canónico pela API.

## Índices a planear

- messages(tenant_id, conversation_id, created_at), UNIQUE(channel_id, external_message_id) quando o ID existir;
- conversations(tenant_id, status, last_activity_at);
- opportunities(tenant_id, stage_id, updated_at);
- appointments(tenant_id, starts_at), appointment_allocations(tenant_id, resource_kind, resource_id, occupied_from, occupied_until);
- outbound_messages(tenant_id, client_request_id) único;
- outbox_events(processing_state, occurred_at), inbound_events(provider_event_key) único com escopo do canal.

## Entregáveis de implementação

Migrações Drizzle versionadas, seeds **sintéticas** para duas clínicas, testes de integridade de chaves cruzadas, disputa por recursos, duplicação de webhook, filas e acesso por IDs adulterados. Não executar migrações remotas ou ligar bases de produção nesta fase.
