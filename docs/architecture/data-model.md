# Modelo lógico de dados — D1 central e SQLite por clínica

**Estado:** distribuição de persistência confirmada em DEC-038 / [ADR-0012](../adr/0012-clinic-durable-object-sqlite.md); campos, índices e esquema finais continuam propostos, não migração executada. Orienta adaptação da persistência e testes do MVP. [Requisitos](../product/requirements.md) e [decisões abertas](../product/decisions.md) continuam a ser a fonte das regras de produto.

## Distribuição confirmada — DEC-038

- **D1 central:** tenants, tenant_memberships, convites, pedidos/sessões/pedidos de encerramento de suporte e auditoria administrativa/de suporte.
- **SQLite do DO de cada clínica:** contacts, conversations, messages, opportunities, opportunity_events, services, professionals, resources, service_requirements, availability_rules/time_off, appointments, appointment_allocations/events, inbound_events, outbox_events, outbound_messages, audit_log operacional e ai_suggestions.
- **R2 privado:** conteúdo de anexos; metadados operacionais no SQLite da clínica.
- Associação global WhatsApp→tenant exige índice verificado; localização/esquema de integração e credenciais serão especificados na F1/F3. Configuração/estado operacional do canal são da clínica.

Referências a memberships/owners em entidades locais são IDs lógicos: não há FK ou transação entre SQLite do DO e D1 central. Validar vigência pelo protocolo de autorização; tenant_id e correlação de actor/subject continuam nas fronteiras e eventos. Não duplicar autoridade de roles no SQLite.

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

## Concorrência da agenda no SQLite da clínica

DEC-038 coloca a escrita operacional no DO da clínica. Verificar profissional e salas/equipamentos e gravar agendamento, todas as alocações, histórico e outbox numa única transação SQLite local. transactionSync é uma API candidata; implementação final e proteção SQL exigem prova de conceito. Não usar D1 batch para reservas e não confiar apenas em SELECT seguido de INSERT ou no runtime single-threaded.

**Proposta SQL:** alocações por recurso; rejeitar sobreposição quando existing.occupied_from < incoming.occupied_until e existing.occupied_until > incoming.occupied_from, inclusive em updates e bloqueios. Gatilhos/restrições exatos seguem propostos até teste. Reagendamento substitui ocupações atomicamente e preserva a reserva original se falhar. Duração e buffers dependem do piloto. Nenhuma chamada externa ocorre na transação.

## Outbox e eventos

Alteração operacional e outbox_events entram na mesma transação SQLite do DO. Despachante reprocessável encaminha intenções às Queues; consumidores usam IDs estáveis e retornam resultados ao DO correto. Eventos WS somente após persistência; reconexão relê estado canônico pela API do DO. Outbox administrativa/de suporte pertence ao D1 central, junto à mutação administrativa correspondente. Não há transação distribuída D1/DO/Queue/R2; contratos idempotentes, recuperação e revogação ainda precisam de desenho/testes.

## Índices a planear

- messages(tenant_id, conversation_id, created_at), UNIQUE(channel_id, external_message_id) quando o ID existir;
- conversations(tenant_id, status, last_activity_at);
- opportunities(tenant_id, stage_id, updated_at);
- appointments(tenant_id, starts_at), appointment_allocations(tenant_id, resource_kind, resource_id, occupied_from, occupied_until);
- outbound_messages(tenant_id, client_request_id) único;
- outbox_events(processing_state, occurred_at), inbound_events(provider_event_key) único com escopo do canal.

## Entregáveis de implementação

Migrações SQL versionadas por DO e migrações D1 centrais (adaptador/Drizzle a validar), seeds **sintéticas** para duas clínicas, testes de integridade de chaves cruzadas, disputa por recursos, duplicação de webhook, filas e acesso por IDs adulterados. Não executar migrações remotas ou ligar bases de produção nesta fase.
