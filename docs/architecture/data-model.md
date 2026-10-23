# Modelo lógico de dados D1 — Tredane

**Estado:** proposta técnica, não migração final. Orienta Drizzle e testes do MVP. [Requisitos](../product/requirements.md) e [decisões abertas](../product/decisions.md) continuam a ser a fonte das regras de produto.

## Entidades nucleares

| Entidade | Campos e relações essenciais (propostos) |
| --- | --- |
| tenants | id, nome, timezone, estado |
| identities / memberships | user_id, tenant_id, role, estado, revoked_at |
| whatsapp_channels | id, tenant_id, phone_number_id externo único, estado de ativação |
| contacts | id, tenant_id, identificador WhatsApp, nome mínimo |
| conversations | id, tenant_id, contact_id, assignee_membership_id, status, last_activity_at |
| messages | id, tenant_id, conversation_id, direction, external_message_id, delivery_state, body, created_at |
| opportunities | id, tenant_id, contact_id, conversation_id opcional, stage_id, assignee_id |
| opportunity_events | id, tenant_id, opportunity_id, actor_id, from_stage, to_stage, occurred_at |
| services | id, tenant_id, nome, duração, buffer, preço opcional, ativo |
| professionals | id, tenant_id, nome, ativo; sem login no MVP |
| resources | id, tenant_id, tipo (sala/equipamento), nome, ativo |
| service_requirements | tenant_id, service_id, resource_type e regras de seleção |
| availability_rules / time_off | tenant_id, professional_id ou resource_id, janela, recorrência/bloqueio |
| appointments | id, tenant_id, contact_id, opportunity_id opcional, service_id, starts_at, ends_at, status, version |
| appointment_allocations | id, tenant_id, appointment_id, resource_kind, resource_id, occupied_from, occupied_until |
| appointment_events | id, tenant_id, appointment_id, operação, actor_id, previous/new state, occurred_at |
| inbound_events | id, tenant_id, provider_event_key, processing_state, received_at |
| outbox_events | id, tenant_id, type, aggregate_id, version, processing_state, occurred_at |
| outbound_messages | id, tenant_id, conversation_id, client_request_id, provider_message_id, status, attempt_info |
| audit_log | id, tenant_id, actor, action, object_type, object_id, occurred_at |
| ai_suggestions | id, tenant_id, conversation_id, status, provider/model id, revised_by, timestamps |

**Não confirmado:** esquema exato, granularidade temporal, regras de unicidade por ciclo da conversa/oportunidade, campos pessoais de contacto e política de retenção. Os campos são indicativos e não devem ser tratados como recolha autorizada de dados reais.

## Entidades de identidade e suporte (proposta técnica)

- `tenant_memberships(tenant_id, clerk_user_id, role, status, created_at, revoked_at)`: N:N com role específica por tenant, sem Clerk Organizations.
- `platform_admin_events(id, actor_clerk_user_id, tenant_id, action, occurred_at)`: histórico da administração.
- `support_sessions(id, actor_clerk_user_id, actor_clerk_session_id, subject_clerk_user_id, tenant_id, token_verifier_hash, reason, scope, expires_at, revoked_at)`: sessões de manutenção **emitidas pelo Tredane**.
- `support_audit_events(id, support_session_id, actor_clerk_user_id, subject_clerk_user_id, tenant_id, operation, outcome, occurred_at)`: trilha que distingue quem executou de qual contexto funcional foi usado.

Os campos e índices exatos são **propostos**, sem migração executada. O backend revalida a identidade Clerk do administrador, a flag privada `superadmin`, a sessão própria ativa e o membership/role do usuário alvo; não existe sessão Clerk em nome do alvo. Ver [ADR-0007](../adr/0007-support-impersonation.md).

## Invariantes estruturais

1. Todas as entidades operacionais têm tenant_id; chaves estrangeiras e índices compostos devem evitar referências a entidades de outra clínica (por exemplo, UNIQUE(tenant_id, id) e FOREIGN KEY (tenant_id, contact_id) quando aplicável).
2. A ligação WhatsApp usa identificador de número/conta verificado, com associação inequívoca a uma clínica ativa. Um mesmo número de contacto pode existir isoladamente em clínicas diferentes.
3. O webhook da Meta e a intenção de envio têm chaves de idempotência persistidas e índices únicos no contexto correto.
4. Alterações de estado de agendamentos, oportunidades e envios preservam histórico; eventos da UI nunca antecedem a persistência.
5. Mensagens não são excluídas por simples encerramento de conversa; retenção e apagamento são processos próprios a definir.

## Concorrência da agenda: estratégia proposta

Precisamos evitar conflito tanto de profissional como de sala/equipamento. A API **não** deve fazer apenas SELECT de disponibilidade seguido de INSERT livre. A restrição final deve estar na camada de escrita do D1.

Uma opção a validar em teste com o D1/SQLite é usar linhas de ocupação por recurso em appointment_allocations, com gatilhos SQL BEFORE INSERT e BEFORE UPDATE que abortem quando existir outra ocupação ativa do mesmo (tenant, tipo, recurso) com intervalos sobrepostos:

- Sobreposição se existing.occupied_from < incoming.occupied_until **e** existing.occupied_until > incoming.occupied_from.
- Inserir agendamento + todas as ocupações de profissionais/salas/equipamentos por **lote transacional D1 batch**. Se qualquer ocupação conflitar, abortar o lote todo.
- Reagendamento atualiza o conjunto de ocupações no mesmo lote transacional, preservando o agendamento original em caso de erro. Cancelamento liberta ocupações apenas por operação auditada.
- Bloqueios/ausências que reservem recursos precisam passar pela mesma proteção de escrita.
- Duração e buffers compõem occupied_from/until e dependem de regras confirmadas com a clínica piloto.
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
