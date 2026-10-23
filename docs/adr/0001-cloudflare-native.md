# ADR-0001 — Plataforma Cloudflare-native para o MVP

- **Estado:** Aceito quanto à stack base (decisão do responsável pelo produto, 23/10/2026).
- **Contexto:** o Tredane começa como SaaS multi-tenant de atendimento, CRM leve e agenda para clínicas de estética. Pretendemos reduzir operação de infraestrutura sem sacrificar separação de dados, auditabilidade ou recuperação de falhas.
- **Decisão:** usar React no painel; Cloudflare Workers + Hono na API; D1 + Drizzle para persistência relacional; Queues para processamento assíncrono; R2 para anexos; Workflows quando necessários; Durable Objects e WebSockets hibernáveis para atualização em tempo real.
- **O que não se decide aqui:** desenho do deployment e detalhes finais do modelo de dados. Decididos depois, em 23/10/2026: identidade por código por e-mail no Worker (DEC-007), IA Claude via AI Gateway (DEC-011, [ADR-0004](0004-ai-human-in-loop.md)), um D1 por clínica + D1 central ([ADR-0002](0002-d1-topology.md)), Embedded Signup do WhatsApp (DEC-009) e app de superadmin ([ADR-0006](0006-superadmin-control-plane.md)).
- **Alternativas:** PostgreSQL externo via Hyperdrive; múltiplos microserviços; aplicações backend hospedadas fora da Cloudflare.
- **Razões:** uma base TypeScript integrada, baixa sobrecarga operacional para o piloto, integração nativa com recursos de fila e WebSockets.
- **Consequências:** responsabilidade explícita por consistência transacional da agenda, isolamento entre tenants, replay de webhooks, reentrega de filas e limites/custos dos serviços. A API oficial da Meta continua externa.
- **Revisitar quando:** testes de carga e requisitos da clínica piloto evidenciarem limites estruturais, necessidade de SQL mais complexo ou custo operacional maior que a alternativa.

**Origem:** [MVP](../MVP.md) e [DEC-001 a DEC-004](../product/decisions.md). Implementação proposta em [arquitetura](../architecture/overview.md).
