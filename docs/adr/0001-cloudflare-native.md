# ADR-0001 — Plataforma Cloudflare-native para o MVP

- **Estado:** Aceito quanto à stack base (decisão do responsável pelo produto, 23/10/2026).
- **Contexto:** o Tredane começa como SaaS multi-tenant de atendimento, CRM leve e agenda para clínicas de estética. Pretendemos reduzir operação de infraestrutura sem sacrificar separação de dados, auditabilidade ou recuperação de falhas.
- **Decisão:** usar React no painel; Cloudflare Workers + Hono na API; D1 central para administração/memberships e SQLite nativo por DO/clínica para persistência operacional (DEC-038); Drizzle conforme adaptador do backend; Queues para processamento assíncrono; R2 para anexos; Workflows quando necessários; Durable Objects e WebSockets hibernáveis para atualização em tempo real.
- **O que não se decide aqui:** provedor de IA; onboarding WhatsApp; desenho do deployment; detalhes finais do modelo de dados.
- **Alternativas:** PostgreSQL externo via Hyperdrive; múltiplos microserviços; aplicações backend hospedadas fora da Cloudflare.
- **Razões:** uma base TypeScript integrada, baixa sobrecarga operacional para o piloto, integração nativa com recursos de fila e WebSockets.
- **Consequências:** responsabilidade explícita por consistência transacional da agenda, isolamento entre tenants, replay de webhooks, reentrega de filas e limites/custos dos serviços. A API oficial da Meta continua externa.
- **Revisitar quando:** testes de carga e requisitos da clínica piloto evidenciarem limites estruturais, necessidade de SQL mais complexo ou custo operacional maior que a alternativa.

**Origem:** [MVP](../MVP.md) e [DEC-001 a DEC-004](../product/decisions.md). Implementação proposta em [arquitetura](../architecture/overview.md).


**Complementos confirmados:** identidade Clerk definida em ADR-0006; topologia de persistência definida em DEC-038 / [ADR-0012](0012-clinic-durable-object-sqlite.md).
