# ADR-0002 — Topologia multi-tenant no D1

- **Estado:** **Aceito** quanto à topologia: um D1 dedicado por clínica mais um D1 central de controle (decisão do responsável pelo produto, 23/10/2026, [DEC-010](../product/decisions.md)). **Aceito para o piloto** o mecanismo de bindings gerados no deploy (opção 3 abaixo), sujeito às medições da F1. **Em aberto** o provisionamento e a migração em escala.
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

## Como o Worker abre o D1 da clínica

Um D1 é ligado ao Worker por um *binding* declarado na configuração no momento do deploy. Opções consideradas:

1. **Workers for Platforms:** um Worker por clínica com binding só ao seu D1, chamado por um Worker de despacho. Isolamento por construção e `batch` transacional preservado; exige plano próprio (valor a confirmar na página de preços atual), um script por clínica e publicação de cada versão do código em todos os scripts.
2. **API HTTP do D1** a partir do Worker: banco escolhido por ID em tempo de execução. Simples de provisionar, mas sem o `batch` transacional do binding (afeta [ADR-0005](0005-d1-booking-consistency.md)), com mais latência e um token que enxerga todos os bancos. **Descartada** para o caminho principal das requisições.
3. **Bindings gerados no deploy** a partir do D1 central: um binding por clínica no mesmo Worker, com redeploy automatizado ao criar clínica. Um código só e sem custo além do plano Workers pago; limite de bindings por Worker e deploy a cada clínica nova.

**Decisão do piloto (23/10/2026, responsável pelo produto):** opção 3, por ser a mais econômica e manter o `batch` transacional. Opção 1 fica como caminho de migração; opção 2 descartada.

**A medir na F1 (prova de conceito):**
- limite real de bindings por Worker e quantas clínicas ele comporta;
- tempo entre criar a clínica e ela poder ser atendida (deploy incluído);
- teste de acesso cruzado: nenhuma requisição de A abre o banco de B, inclusive com ID forjado e sessão trocada;
- confirmação de que o `batch` do binding mantém a atomicidade exigida pelo ADR-0005.

**Gatilho de migração para a opção 1:** o número de clínicas se aproxima do limite de bindings medido, o redeploy por clínica nova passa a ser inviável, ou o risco de o código escolher o banco errado deixar de ser aceitável com os testes de acesso cruzado.

**Risco aceito na opção 3:** o Worker enxerga todos os bancos e a escolha do banco é feita pelo código. Um erro de roteamento vazaria dados entre clínicas. Mitigação: resolução da clínica concentrada num único ponto do backend, testes de acesso cruzado obrigatórios no CI e revisão específica desse trecho.

Critérios de avaliação: garantia transacional para a agenda (ADR-0005), latência, limites e custo por clínica, automação pelo app de superadmin ([ADR-0006](0006-superadmin-control-plane.md)), migrações versionadas aplicadas a todos os bancos com registro de versão por clínica e recuperação de falha parcial de migração.

**Não decidido aqui e não deve ser presumido:** usar o armazenamento SQLite do Durable Object como banco da clínica. A decisão do produto é D1 dedicado; trocar o mecanismo exige nova decisão registrada.

## Consequências

- Provisionamento (criar D1, aplicar migrações, registrar no mapa) passa a ser uma operação do app de superadmin, auditada e idempotente.
- Testes de acesso cruzado passam a verificar também que a requisição nunca abre o banco de outra clínica.
- Consultas que cruzam clínicas (métricas de plataforma) não leem o D1 das clínicas; usam o D1 central ou dados técnicos agregados sem conteúdo.

**Origem:** [DEC-010](../product/decisions.md), [fronteiras](../product/tenant-boundaries.md), [modelo lógico](../architecture/data-model.md).
