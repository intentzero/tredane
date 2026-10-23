# ADR-0002 — Topologia multi-tenant no D1

- **Estado:** **Aceito** quanto à topologia: um D1 dedicado por clínica mais um D1 central de controle (decisão do responsável pelo produto, 23/10/2026, [DEC-010](../product/decisions.md)). **Em aberto** quanto ao mecanismo de roteamento, provisionamento e migração.
- **Substitui:** a recomendação provisória anterior deste ADR de prototipar com um D1 compartilhado usando `tenant_id`.

## Contexto

D1 suporta tanto um banco compartilhado com escopo por clínica quanto um banco por clínica. O Durable Object de cada clínica ([ADR-0003](0003-durable-objects-realtime.md)) não separa o D1 por si. Uma conta pode pertencer a várias clínicas ([DEC-007](../product/decisions.md)), então é preciso saber a qual clínica e a qual banco uma requisição se refere antes de abrir os dados de negócio.

## Decisão

| Banco | Conteúdo | Nunca contém |
| --- | --- | --- |
| **D1 central de controle** (um) | usuários, sessões e códigos de login, associações usuário ↔ clínica com papel, clínicas e estado, mapa clínica → D1, canais WhatsApp (phone_number_id → clínica), auditoria de plataforma e de superadmin. | contatos, conversas, mensagens, oportunidades, agenda, sugestões de IA. |
| **D1 da clínica** (um por clínica) | todas as entidades de negócio do [modelo lógico](../architecture/data-model.md): contatos, conversas, mensagens, oportunidades, serviços, recursos, agenda, ocupações, outbox, eventos recebidos, auditoria da clínica, sugestões de IA. | dados de outra clínica; credenciais. |

R2 continua um bucket privado, com prefixo por clínica e acesso somente pelo Worker após autorização.

Fluxo de uma requisição autenticada: sessão → D1 central valida a associação vigente com a clínica ativa → obtém o banco dessa clínica → domínio opera **somente** nesse banco. Webhook: `phone_number_id` verificado → D1 central → clínica → D1 da clínica. O contexto de tenant continua sendo checado na fronteira do backend; mesmo com bancos separados, as tabelas da clínica mantêm `tenant_id` para defesa em profundidade e para mensagens em Queue/Workflow.

## Motivo

Isolamento físico dos dados de cada clínica, exclusão e exportação por clínica mais simples (retenção de [DEC-011](../product/decisions.md)) e menor impacto de um erro de escopo em consulta.

## Em aberto: como o Worker abre o D1 da clínica

Um D1 é normalmente ligado ao Worker por binding estático declarado no deploy; criar uma clínica nova não pode exigir novo deploy manual. Opções a avaliar numa prova de conceito antes da fatia F1:

1. **Workers for Platforms:** um Worker de clínica com binding ao seu D1, chamado por um Worker de despacho. Roteamento nativo; exige o produto e o pipeline de deploy por tenant.
2. **API HTTP do D1** a partir do Worker: banco escolhido por ID em tempo de execução. Simples de provisionar; latência maior, token com escopo restrito e sem `batch` transacional nativo do binding (afeta [ADR-0005](0005-d1-booking-consistency.md)).
3. **Bindings gerados no deploy** a partir do D1 central: um binding por clínica, redeploy automatizado ao criar clínica. Simples para poucas clínicas; limite de bindings por Worker.

Critérios: garantia transacional para a agenda (ADR-0005), latência, limites e custo por clínica, automação pelo app de superadmin ([ADR-0006](0006-superadmin-control-plane.md)), migrações versionadas aplicadas a todos os bancos com registro de versão por clínica e recuperação de falha parcial de migração.

**Não decidido aqui e não deve ser presumido:** usar o armazenamento SQLite do Durable Object como banco da clínica. A decisão do produto é D1 dedicado; trocar o mecanismo exige nova decisão registrada.

## Consequências

- Provisionamento (criar D1, aplicar migrações, registrar no mapa) passa a ser uma operação do app de superadmin, auditada e idempotente.
- Testes de acesso cruzado passam a verificar também que a requisição nunca abre o banco de outra clínica.
- Consultas que cruzam clínicas (métricas de plataforma) não leem o D1 das clínicas; usam o D1 central ou dados técnicos agregados sem conteúdo.

**Origem:** [DEC-010](../product/decisions.md), [fronteiras](../product/tenant-boundaries.md), [modelo lógico](../architecture/data-model.md).
